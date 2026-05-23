/**
 * Adaptador Stripe -> formato interno (GatewayEvent).
 *
 * Eventos cobertos:
 *   - checkout.session.completed       -> compra_aprovada
 *   - checkout.session.expired         -> carrinho_abandonado
 *   - checkout.session.async_payment_failed -> compra_recusada
 *   - invoice.payment_succeeded        -> assinatura_renovada (apenas em renovacao;
 *                                          primeira fatura ja vem como checkout.session.completed)
 *   - invoice.payment_failed           -> assinatura_atrasada
 *   - customer.subscription.deleted    -> assinatura_cancelada
 *   - charge.refunded                  -> reembolso
 *
 * Ignorados (registrados como unmapped):
 *   - customer.subscription.created/updated (ciclo coberto pelos outros eventos)
 *   - charge.dispute.created (sem fluxo definido ainda)
 */

import type { EventInput, GatewayEvent } from "./flows.js";
import crypto from "node:crypto";

type AnyObject = Record<string, unknown>;

function pick<T = unknown>(obj: AnyObject, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>(
      (acc, part) => (acc && typeof acc === "object" ? (acc as AnyObject)[part] : undefined),
      obj,
    );
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

/**
 * Stripe Checkout coleta phone como string normal (formato E.164: "+5511999998888").
 * Tambem aceita variantes sem "+", com espacos, etc.
 */
function parsePhone(raw: unknown): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/**
 * Stripe sempre envia valores em CENTAVOS na menor unidade da moeda
 * (ex: BRL em centavos, USD em cents, JPY ja eh inteiro).
 * Pra BRL/USD/EUR (que e o uso esperado), divide por 100.
 */
function parseStripeAmount(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw / 100;
}

/**
 * Decide qual GatewayEvent representar baseado em event.type + dados do objeto.
 * Stripe pode mandar varios eventos pro mesmo flow (ex: checkout.session.completed
 * tambem dispara invoice.payment_succeeded com billing_reason=subscription_create).
 * Pra evitar dupla criacao de lead, ignoramos invoice em primeira cobranca.
 */
function detectEventType(event: AnyObject): GatewayEvent | null {
  const type = String(event.type ?? "");
  const obj = ((event.data as AnyObject)?.object as AnyObject | undefined) ?? undefined;

  switch (type) {
    case "checkout.session.completed":
      return "compra_aprovada";
    case "checkout.session.expired":
      return "carrinho_abandonado";
    case "checkout.session.async_payment_failed":
      return "compra_recusada";
    case "invoice.payment_succeeded": {
      // Stripe dispara essa pra primeira fatura tambem (com billing_reason="subscription_create")
      // Ignoramos pra nao duplicar com checkout.session.completed.
      const reason = obj ? pick<string>(obj, "billing_reason") : undefined;
      if (reason === "subscription_cycle") return "assinatura_renovada";
      return null;
    }
    case "invoice.payment_failed": {
      // Diferencia 1ª compra falhada (cliente novo, cartão recusado) de
      // renovação falhada (cliente existente, problema na cobrança recorrente).
      // Sem isso, cliente NOVO recebia mensagem "sua renovação não passou hoje"
      // — mas ele nem é cliente ainda, é uma compra recusada.
      const reason = obj ? pick<string>(obj, "billing_reason") : undefined;
      if (reason === "subscription_create" || reason === "manual") {
        return "compra_recusada";
      }
      // subscription_cycle, subscription_update, subscription_threshold → é renovação
      return "assinatura_atrasada";
    }
    case "customer.subscription.deleted":
      return "assinatura_cancelada";
    case "charge.refunded":
      return "reembolso";
    default:
      return null;
  }
}

/**
 * Extrai customer info dependendo do tipo de objeto.
 * - checkout.session: customer_details.{name,email,phone}
 * - invoice: customer_email/customer_phone/customer_name (legacy) ou customer_address
 * - subscription: precisa expand (nao temos sem chamada API). Usamos metadata se disponivel.
 * - charge: billing_details.{name,email,phone}
 */
function extractCustomer(obj: AnyObject): {
  nome: string;
  email: string | null;
  contato: string | null;
} {
  const nome =
    pick<string>(
      obj,
      "customer_details.name",
      "billing_details.name",
      "customer_name",
      "shipping_details.name",
      "metadata.customer_name",
    ) ?? "Cliente Stripe";

  const email =
    pick<string>(
      obj,
      "customer_details.email",
      "billing_details.email",
      "customer_email",
      "metadata.customer_email",
    ) ?? null;

  const phoneRaw = pick(
    obj,
    "customer_details.phone",
    "billing_details.phone",
    "customer_phone",
    "shipping_details.phone",
    "metadata.customer_phone",
  );
  const contato = parsePhone(phoneRaw);

  return { nome, email, contato };
}

export function parseStripeWebhook(event: AnyObject): EventInput | null {
  const eventType = detectEventType(event);
  if (!eventType) return null;

  const obj = (event.data as AnyObject)?.object as AnyObject | undefined;
  if (!obj) return null;

  const { nome, email, contato } = extractCustomer(obj);

  // Skip: carrinho abandonado SEM contato é lixo total — Stripe Checkout
  // session.expired chega quando alguém abriu a tela mas nem digitou email.
  // Não dá pra contactar, e gera ruído ("Cliente Stripe · sem email · sem phone").
  // Sem isso, em poucos dias o banco enche de leads-fantasma sem como aproveitar.
  if (eventType === "carrinho_abandonado" && !email && !contato) {
    return null;
  }

  const valor =
    parseStripeAmount(
      pick(obj, "amount_total", "amount_paid", "amount_due", "amount"),
    ) ?? null;

  const gatewayCustomerId = pick<string>(obj, "customer", "customer_id") ?? null;

  // Stripe tem multiplos IDs.
  // CRÍTICO: prioriza `subscription` (sub_XXX — ID ESTÁVEL da assinatura) antes
  // de `id` (que em checkout.session.completed é cs_live_XXX, ÚNICO por checkout).
  // Sem essa ordem, webhook de cancelamento (que manda sub_XXX) nunca acha o
  // gateway_subscription_id no banco e silenciosamente falha em atualizar status.
  const gatewayLastOrderId =
    pick<string>(obj, "subscription", "payment_intent", "invoice", "id") ?? null;

  // Plano/produto: line items vem com expand. Stripe webhook NÃO expande
  // line_items por default — só vem se você chama o webhook com expand[]=line_items.
  // Fallback: metadata.gravyx_tier ('creator'|'starter'|'studio'|'premium'|'custom')
  // mapeado pra nome amigável. Sem isso, 40+ subs ficaram sem plano_nome.
  const tier = String(pick<string>(obj, "metadata.gravyx_tier", "metadata.tier") ?? "").toLowerCase();
  const TIER_TO_NAME: Record<string, string> = {
    creator: "Gravyx Creator",
    starter: "Gravyx Starter",
    studio: "Gravyx Studio",
    premium: "Gravyx Premium",
    enterprise: "Gravyx Enterprise",
    custom: "Gravyx Custom",
  };
  const planoNome =
    pick<string>(
      obj,
      "metadata.plano_nome",
      "metadata.product_name",
      "lines.data.0.description",
      "items.data.0.description",
    ) ?? (tier && TIER_TO_NAME[tier]) ?? null;

  // Periodicidade — Stripe oferece vários sinais:
  //  - mode: 'subscription' (recorrente) vs 'payment' (one-time = vitalicio)
  //  - metadata.gravyx_slug: 'studio_monthly', 'creator_yearly', etc
  //  - lines.data[0].price.recurring.interval: 'month' | 'year'
  const slug = String(pick<string>(obj, "metadata.gravyx_slug", "metadata.slug") ?? "").toLowerCase();
  const interval = String(
    pick<string>(
      obj,
      "lines.data.0.price.recurring.interval",
      "items.data.0.price.recurring.interval",
      "subscription_details.interval",
    ) ?? "",
  ).toLowerCase();
  const mode = String(pick<string>(obj, "mode") ?? "").toLowerCase();
  let periodicidade: "mensal" | "anual" | "vitalicio" | "gratis" = "mensal";
  if (/year|annual/.test(slug) || /year/.test(interval)) periodicidade = "anual";
  else if (/lifetime|vital/.test(slug)) periodicidade = "vitalicio";
  else if (mode === "payment") periodicidade = "vitalicio"; // one-time
  else if (/free|gratis|trial/.test(slug)) periodicidade = "gratis";

  return {
    source: "stripe",
    eventType,
    rawPayload: event,
    nome,
    contato,
    email,
    gatewayCustomerId,
    gatewayLastOrderId,
    valor,
    planoNome,
    periodicidade,
    pixExpiraEm: null, // Stripe nao tem PIX expiration nativo no payload
    extras: {
      // Link util pra mensagens (cliente acessa fatura/checkout)
      hosted_invoice_url:
        pick<string>(obj, "hosted_invoice_url", "invoice_pdf") ?? "",
      checkout_url: pick<string>(obj, "url") ?? "",
      // Atribuição: client_reference_id traz fbc/fbp/UTMs serializados das LPs.
      // Formato: "fbp:XXX|fbc:YYY|src:facebook|cmp:CAMP|adset:ADSET|ad:AD|plan:byok-mensal"
      // Usado pro CAPI Meta deduplicar com Pixel da /obrigado e linkar venda → campanha.
      client_reference_id: pick<string>(obj, "client_reference_id") ?? "",
      session_id: pick<string>(obj, "id") ?? "",
    },
  };
}

/**
 * Decodifica client_reference_id no formato "k:v|k:v|..." (encoded com -- em vez de |
 * pra evitar problemas com URL, e -col- em vez de :).
 * Stripe limita client_reference_id a 200 chars + apenas alphanumeric + dash + underscore.
 */
export function decodeAttribution(cri: string): Record<string, string> {
  if (!cri) return {};
  // Aceita tanto "k:v|k:v" (cru) quanto "k-col-v--k-col-v" (encoded pra Stripe)
  const normalized = cri.replace(/--/g, "|").replace(/-col-/g, ":");
  const out: Record<string, string> = {};
  for (const pair of normalized.split("|")) {
    const idx = pair.indexOf(":");
    if (idx === -1) continue;
    const k = pair.substring(0, idx).trim();
    const v = pair.substring(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

/**
 * Validacao do webhook Stripe.
 *
 * Stripe assina o payload com HMAC-SHA256 e envia no header `stripe-signature`
 * no formato: `t=<timestamp>,v1=<sig>[,v0=<sig>]`.
 *
 * Validamos:
 *  1. v1 = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *  2. timestamp nao mais antigo que 5 minutos (replay protection)
 *
 * Se STRIPE_WEBHOOK_SIGNING_SECRET nao estiver setado, pulamos validacao (modo dev).
 */
export function verifyStripeSignature(
  rawBody: string,
  headers: Headers,
): { valid: boolean; reason?: string } {
  const secret = process.env.STRIPE_WEBHOOK_SIGNING_SECRET;
  if (!secret) return { valid: true, reason: "no-secret-configured" };

  const sigHeader = headers.get("stripe-signature");
  if (!sigHeader) return { valid: false, reason: "missing-stripe-signature-header" };

  // Parse "t=...,v1=...,v1=..." (multiplos v1 sao validos durante rotacao de secret)
  const parts: Record<string, string[]> = {};
  for (const item of sigHeader.split(",")) {
    const eq = item.indexOf("=");
    if (eq === -1) continue;
    const key = item.substring(0, eq).trim();
    const val = item.substring(eq + 1).trim();
    if (!parts[key]) parts[key] = [];
    parts[key].push(val);
  }

  const timestamp = parts.t?.[0];
  const v1Sigs = parts.v1 ?? [];
  if (!timestamp || v1Sigs.length === 0) {
    return { valid: false, reason: "invalid-signature-header" };
  }

  // Replay protection: rejeita timestamps mais antigos que 5min
  const tsAge = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(tsAge) || tsAge > 300) {
    return { valid: false, reason: "timestamp-too-old-or-invalid" };
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");

  for (const sig of v1Sigs) {
    const sigBuf = Buffer.from(sig, "utf8");
    if (sigBuf.length !== expectedBuf.length) continue;
    if (crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { valid: true };
    }
  }
  return { valid: false, reason: "signature-mismatch" };
}
