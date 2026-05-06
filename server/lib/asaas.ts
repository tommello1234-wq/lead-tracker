/**
 * Adaptador Asaas → formato interno (GatewayEvent).
 *
 * Eventos do Asaas relevantes (baseado na docs https://docs.asaas.com):
 *   - PAYMENT_RECEIVED / PAYMENT_CONFIRMED        → compra_aprovada
 *   - PAYMENT_REFUNDED                            → reembolso
 *   - PAYMENT_OVERDUE                             → pix_expirado / atrasada
 *   - PAYMENT_DELETED / PAYMENT_RESTORED          → unknown (audit only)
 *   - PAYMENT_CHARGEBACK_REQUESTED                → unknown (claimed-like)
 *   - SUBSCRIPTION_CREATED                        → compra_aprovada (1ª)
 *   - SUBSCRIPTION_RENEWED                        → assinatura_renovada
 *   - SUBSCRIPTION_DELETED / CANCELED             → assinatura_cancelada
 *
 * Auth: Asaas envia o webhook com header `asaas-access-token` que casa
 * com o `accessToken` configurado no painel. Validamos contra
 * ASAAS_WEBHOOK_TOKEN no env.
 *
 * Pra enriquecer dados do customer (email/phone/name), o webhook traz
 * só o `customer` ID — fazemos GET /v3/customers/{id} via API.
 */

import type { EventInput, GatewayEvent } from "./flows.js";
import type { Periodicidade } from "../../db/schema.js";
import { getAsaasCustomer } from "./asaas-api.js";

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

function sanitizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (!t || !t.includes("@") || !t.includes(".")) return null;
  return t;
}

function parsePhone(raw: unknown): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/**
 * Asaas envia value como número decimal (ex: 47.00 = R$ 47,00),
 * diferente de Stripe (centavos) e Ticto v2 (centavos).
 */
function parseAsaasValor(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(",", "."));
    return isNaN(n) ? null : n;
  }
  return null;
}

function detectEventType(payload: AnyObject): GatewayEvent | null {
  const event = String(pick<string>(payload, "event") ?? "").toUpperCase();

  // Pagamento confirmado/recebido
  if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
    // Se já é renovação de subscription, vira assinatura_renovada
    // (parser principal abaixo decide via flag)
    return "compra_aprovada";
  }
  if (event === "PAYMENT_REFUNDED") return "reembolso";
  if (event === "PAYMENT_OVERDUE") return "pix_expirado";
  if (event === "SUBSCRIPTION_RENEWED") return "assinatura_renovada";
  if (event === "SUBSCRIPTION_CANCELED" || event === "SUBSCRIPTION_DELETED") {
    return "assinatura_cancelada";
  }
  if (event === "SUBSCRIPTION_CREATED") return "compra_aprovada";

  // PAYMENT_CHARGEBACK_REQUESTED, PAYMENT_DELETED, etc — não temos fluxo
  return null;
}

function detectPeriodicidade(payload: AnyObject): Periodicidade {
  // Asaas: subscription.cycle = "MONTHLY" | "YEARLY" | "WEEKLY" | etc
  const cycle = String(pick<string>(payload, "subscription.cycle", "payment.subscription.cycle") ?? "").toUpperCase();
  if (cycle === "YEARLY" || cycle === "ANNUALLY") return "anual";
  if (cycle === "MONTHLY") return "mensal";
  // Sem subscription = pagamento único = vitalício
  const hasSub = pick(payload, "subscription") || pick(payload, "payment.subscription");
  if (!hasSub) return "vitalicio";
  return "mensal";
}

export async function parseAsaasWebhook(payload: AnyObject): Promise<EventInput | null> {
  const eventType = detectEventType(payload);
  if (!eventType) return null;

  // Asaas pode ter `payment` ou `subscription` como root depending no evento
  const payment = (pick(payload, "payment") ?? {}) as AnyObject;
  const subscription = (pick(payload, "subscription") ?? {}) as AnyObject;

  // Customer pode vir como objeto (raro) ou string (ID — caso comum).
  const customerRaw = pick(payment, "customer") ?? pick(subscription, "customer");
  let customer = (typeof customerRaw === "object" ? customerRaw : {}) as AnyObject;
  const customerId = typeof customerRaw === "string"
    ? customerRaw
    : (pick<string>(customer, "id") ?? null);

  // Se customer veio só como ID, faz pull na API pra enriquecer (cache 10min).
  // Se ASAAS_API_KEY não estiver configurada, getAsaasCustomer retorna null
  // e seguimos com placeholders.
  if (typeof customerRaw === "string" && customerId) {
    const fetched = await getAsaasCustomer(customerId);
    if (fetched) customer = fetched as unknown as AnyObject;
  }

  const nome = String(pick<string>(customer, "name") ?? "Cliente Asaas");
  const email = sanitizeEmail(pick<string>(customer, "email"));
  const phone = parsePhone(
    pick(customer, "mobilePhone", "phone", "celular", "telefone"),
  );

  const valor = parseAsaasValor(
    pick(payment, "value", "netValue") ?? pick(subscription, "value"),
  );

  const planoNome = String(
    pick<string>(payment, "description") ??
      pick<string>(subscription, "description") ??
      "",
  ).trim() || null;

  const orderId =
    pick<string>(payment, "id") ??
    pick<string>(subscription, "id") ??
    null;

  return {
    source: "asaas",
    eventType,
    rawPayload: payload,
    nome,
    contato: phone,
    email,
    gatewayCustomerId: customerId?.toString() ?? null,
    gatewayLastOrderId: orderId?.toString() ?? null,
    valor,
    planoNome,
    periodicidade: detectPeriodicidade(payload),
    pixExpiraEm: null,
    extras: {
      // Link da fatura/cobrança Asaas pra mensagens
      invoice_url: pick<string>(payment, "invoiceUrl") ?? "",
      bank_slip_url: pick<string>(payment, "bankSlipUrl") ?? "",
      pix_qr_code: pick<string>(payment, "pixQrCode") ?? "",
    },
  };
}

/**
 * Validação do webhook Asaas — header `asaas-access-token`.
 * Sem token configurado = aceita tudo (dev mode).
 */
export function verifyAsaasSignature(
  headers: Headers,
): { valid: boolean; reason?: string } {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expected) return { valid: true, reason: "no-token-configured" };

  const received = headers.get("asaas-access-token") ?? headers.get("Asaas-Access-Token");
  if (!received) return { valid: false, reason: "missing-asaas-access-token" };

  // Compare timing-safe via length + xor
  if (received.length !== expected.length) return { valid: false, reason: "token-mismatch" };
  let diff = 0;
  for (let i = 0; i < received.length; i++) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0 ? { valid: true } : { valid: false, reason: "token-mismatch" };
}
