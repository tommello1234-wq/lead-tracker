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

import type { EventInput, GatewayEvent } from "@server/lib/flows";
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
    case "invoice.payment_failed":
      return "assinatura_atrasada";
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

  const valor =
    parseStripeAmount(
      pick(obj, "amount_total", "amount_paid", "amount_due", "amount"),
    ) ?? null;

  const gatewayCustomerId = pick<string>(obj, "customer", "customer_id") ?? null;

  // Stripe tem multiplos IDs: session.id, payment_intent, subscription, charge.id
  const gatewayLastOrderId =
    pick<string>(obj, "id", "payment_intent", "subscription", "invoice") ?? null;

  // Plano/produto: line items vem com expand. Usamos metadata customizada se disponivel,
  // senao tentamos description (em invoice.lines).
  const planoNome =
    pick<string>(
      obj,
      "metadata.plano_nome",
      "metadata.product_name",
      "lines.data.0.description",
      "items.data.0.description",
    ) ?? null;

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
    pixExpiraEm: null, // Stripe nao tem PIX expiration nativo no payload
    extras: {
      // Link util pra mensagens (cliente acessa fatura/checkout)
      hosted_invoice_url:
        pick<string>(obj, "hosted_invoice_url", "invoice_pdf") ?? "",
      checkout_url: pick<string>(obj, "url") ?? "",
    },
  };
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
