/**
 * Adaptador Pagar.me v5 → formato interno (GatewayEvent).
 *
 * Docs: https://docs.pagar.me/v5/reference/webhooks
 *
 * Eventos relevantes:
 *   - order.paid                       → compra_aprovada
 *   - order.payment_failed             → compra_recusada
 *   - subscription.created             → compra_aprovada (1ª)
 *   - subscription.charges_paid        → assinatura_renovada
 *   - subscription.charges_unpaid      → assinatura_atrasada
 *   - subscription.canceled            → assinatura_cancelada
 *   - charge.paid                      → compra_aprovada (geralmente já coberto por order/subscription)
 *   - charge.refunded                  → reembolso
 *   - charge.payment_failed            → compra_recusada
 *
 * Auth: Pagar.me v5 envia o webhook com Basic Auth — `Authorization: Basic
 * base64(username:password)`. Configurado no painel Pagar.me. Validamos a
 * SENHA contra `PAGARME_WEBHOOK_TOKEN` no env (username pode ser qualquer
 * coisa, geralmente "pagarme").
 *
 * Valor: vem em centavos (igual Stripe/Ticto v2, diferente do Asaas).
 *
 * Customer: já vem inline no payload (não precisa de pull extra, diferente
 * do Asaas que manda só o ID).
 */
import type { EventInput, GatewayEvent } from "./flows.js";
import type { Periodicidade } from "../../db/schema.js";

type AnyObject = Record<string, unknown>;

function pick<T = unknown>(obj: AnyObject, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object" ? (acc as AnyObject)[part] : undefined,
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

/**
 * Pagar.me v5 manda telefone como objeto:
 * `phones.mobile_phone = { country_code: "55", area_code: "11", number: "999998888" }`
 * Concatena tudo em E.164 (sem +).
 */
function parsePagarmePhone(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "object" && raw !== null) {
    const p = raw as { country_code?: unknown; area_code?: unknown; number?: unknown };
    const cc = String(p.country_code ?? "55").replace(/\D/g, "") || "55";
    const ddd = String(p.area_code ?? "").replace(/\D/g, "");
    const num = String(p.number ?? "").replace(/\D/g, "");
    if (!ddd || !num) return null;
    return `${cc}${ddd}${num}`;
  }
  // Fallback: string raw
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function parsePagarmeValor(raw: unknown): number | null {
  // Pagar.me v5: amount em centavos (integer)
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw / 100;
  if (typeof raw === "string") {
    const n = Number(raw);
    return isNaN(n) ? null : n / 100;
  }
  return null;
}

function detectEventType(payload: AnyObject): GatewayEvent | null {
  const type = String(pick<string>(payload, "type") ?? "").toLowerCase();

  // Order events (compra única)
  if (type === "order.paid") return "compra_aprovada";
  if (type === "order.payment_failed") return "compra_recusada";

  // Subscription events
  if (type === "subscription.created") return "compra_aprovada";
  if (type === "subscription.charges_paid") return "assinatura_renovada";
  if (type === "subscription.charges_unpaid") return "assinatura_atrasada";
  if (type === "subscription.canceled" || type === "subscription.cancelled") {
    return "assinatura_cancelada";
  }

  // Charge events (cobrança individual — geralmente já vem via order/subscription
  // mas mantém pra dupla cobertura)
  if (type === "charge.refunded") return "reembolso";
  if (type === "charge.payment_failed") return "compra_recusada";
  // charge.paid sozinho não vira evento — vem combinado com order.paid

  return null;
}

function detectPeriodicidade(payload: AnyObject): Periodicidade {
  // Pagar.me v5 subscription tem `interval` ("month"|"year"|"week"|"day") +
  // `interval_count` (1..N). Pra simplificar: month → mensal, year → anual.
  const interval = String(
    pick<string>(payload, "data.interval", "data.subscription.interval") ?? "",
  ).toLowerCase();
  if (interval === "year") return "anual";
  if (interval === "month") return "mensal";

  // Sem interval = order avulsa = vitalício
  const isSub =
    String(pick<string>(payload, "type") ?? "").startsWith("subscription.") ||
    pick(payload, "data.subscription_id") != null;
  if (!isSub) return "vitalicio";
  return "mensal";
}

/**
 * Parser principal — converte payload Pagar.me em EventInput interno.
 */
export function parsePagarmeWebhook(payload: AnyObject): EventInput | null {
  const eventType = detectEventType(payload);
  if (!eventType) return null;

  // Root data muda por evento:
  //  - order.* → data = Order
  //  - subscription.* → data = Subscription
  //  - charge.* → data = Charge (tem charge.order ou charge.subscription_id)
  const data = (pick(payload, "data") ?? {}) as AnyObject;

  // Customer: vem inline em data.customer (objeto completo)
  const customer = (pick(data, "customer", "charge.customer") ?? {}) as AnyObject;
  const customerId = pick<string>(customer, "id") ?? null;

  const nome = String(pick<string>(customer, "name") ?? "Cliente Pagar.me");
  const email = sanitizeEmail(pick<string>(customer, "email"));
  const phone = parsePagarmePhone(
    pick(customer, "phones.mobile_phone", "phones.home_phone", "phone"),
  );

  // Valor: tenta amount do nível raiz, depois itens, depois charge
  const valor = parsePagarmeValor(
    pick(data, "amount", "items.0.amount", "charges.0.amount", "charge.amount"),
  );

  // Plano: nome do item ou plano da subscription
  const planoNome =
    (pick<string>(data, "items.0.name") ??
      pick<string>(data, "plan.name") ??
      pick<string>(data, "code") ??
      null);

  // Order/Subscription ID (pra dedup posterior)
  const orderId = pick<string>(data, "id") ?? null;

  // pix_qr_code se vier (Pagar.me retorna pra pagamentos PIX)
  const pixQrCode =
    pick<string>(data, "charges.0.last_transaction.qr_code") ??
    pick<string>(data, "last_transaction.qr_code") ??
    "";

  // Link da fatura (boleto/PIX)
  const invoiceUrl =
    pick<string>(data, "charges.0.last_transaction.url") ??
    pick<string>(data, "last_transaction.url") ??
    pick<string>(data, "checkout_url") ??
    "";

  return {
    source: "pagarme",
    eventType,
    rawPayload: payload,
    nome,
    contato: phone,
    email,
    gatewayCustomerId: customerId,
    gatewayLastOrderId: orderId,
    valor,
    planoNome: planoNome?.trim() || null,
    periodicidade: detectPeriodicidade(payload),
    pixExpiraEm: null,
    extras: {
      invoice_url: invoiceUrl,
      pix_qr_code: pixQrCode,
    },
  };
}

/**
 * Validação Basic Auth do webhook Pagar.me.
 * Pagar.me envia header `Authorization: Basic base64(username:password)` —
 * usuário e senha são configurados no painel Pagar.me ao criar o endpoint.
 *
 * Env vars (ambos obrigatórios em prod):
 *   - PAGARME_WEBHOOK_USER  → username configurado no painel
 *   - PAGARME_WEBHOOK_TOKEN → senha configurada no painel
 *
 * Sem env vars = aceita tudo (dev mode).
 */
export function verifyPagarmeSignature(
  headers: Headers,
): { valid: boolean; reason?: string } {
  const expectedUser = process.env.PAGARME_WEBHOOK_USER;
  const expectedPass = process.env.PAGARME_WEBHOOK_TOKEN;
  if (!expectedUser || !expectedPass) {
    return { valid: true, reason: "no-credentials-configured" };
  }

  const authHeader = headers.get("authorization") ?? headers.get("Authorization");
  if (!authHeader) return { valid: false, reason: "missing-authorization" };

  const m = authHeader.match(/^Basic\s+(.+)$/i);
  if (!m) return { valid: false, reason: "not-basic-auth" };

  let decoded: string;
  try {
    decoded = Buffer.from(m[1], "base64").toString("utf-8");
  } catch {
    return { valid: false, reason: "invalid-base64" };
  }

  // Formato: "username:password"
  const colonIdx = decoded.indexOf(":");
  if (colonIdx < 0) return { valid: false, reason: "malformed-auth" };
  const user = decoded.slice(0, colonIdx);
  const pass = decoded.slice(colonIdx + 1);

  // Timing-safe compare pra ambos (user + password)
  if (!safeEqual(user, expectedUser)) {
    return { valid: false, reason: "user-mismatch" };
  }
  if (!safeEqual(pass, expectedPass)) {
    return { valid: false, reason: "password-mismatch" };
  }
  return { valid: true };
}

/** Compara duas strings sem leakar timing — usado pra credenciais. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
