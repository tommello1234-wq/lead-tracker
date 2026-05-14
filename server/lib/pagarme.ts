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

  // ========================================================================
  // INVOICE EVENTS — modelo de assinatura via fatura recorrente (Pagar.me v5)
  // É o modelo que a maioria das contas usa. Cada renovação gera 1 invoice.
  // ========================================================================
  if (type === "invoice.paid") return "assinatura_renovada";
  if (type === "invoice.canceled" || type === "invoice.cancelled") {
    return "assinatura_cancelada";
  }
  if (type === "invoice.payment_failed") return "assinatura_atrasada";
  // invoice.created — fatura gerada mas não paga ainda. Ignora — flows.ts
  // não tem "fatura_gerada" como evento útil pra pós-venda.

  // ========================================================================
  // ORDER EVENTS — compras avulsas (não-recorrente) ou 1ª compra de sub
  // ========================================================================
  if (type === "order.paid") return "compra_aprovada";
  if (type === "order.payment_failed") return "compra_recusada";

  // ========================================================================
  // SUBSCRIPTION EVENTS — eventos diretos da assinatura
  // ========================================================================
  if (type === "subscription.created") return "compra_aprovada";
  if (type === "subscription.charges_paid") return "assinatura_renovada";
  if (type === "subscription.charges_unpaid") return "assinatura_atrasada";
  if (type === "subscription.canceled" || type === "subscription.cancelled") {
    return "assinatura_cancelada";
  }
  // subscription_item.created — adição de item à sub. Sem fluxo útil. Ignora.

  // ========================================================================
  // CHARGE EVENTS — cobrança individual
  // charge.paid duplica invoice.paid/order.paid → IGNORA pra evitar contar
  // faturamento 2x. Só processamos refund + failed que NÃO vem em duplicata.
  // ========================================================================
  if (type === "charge.refunded") return "reembolso";
  if (type === "charge.payment_failed") return "compra_recusada";
  // charge.paid → IGNORA (duplicate de invoice.paid ou order.paid)
  // charge.created → IGNORA (cobrança gerada, ainda não paga)

  return null;
}

function detectPeriodicidade(payload: AnyObject): Periodicidade {
  // Pagar.me v5 subscription tem `interval` ("month"|"year"|"week"|"day") +
  // `interval_count` (1..N). Pra simplificar: month → mensal, year → anual.
  const interval = String(
    pick<string>(
      payload,
      "data.interval",
      "data.subscription.interval",
      "data.plan.interval",
    ) ?? "",
  ).toLowerCase();
  if (interval === "year") return "anual";
  if (interval === "month") return "mensal";

  // Detecta se é assinatura (recorrente) baseado no tipo OU presença de subscription
  const type = String(pick<string>(payload, "type") ?? "");
  const isSub =
    type.startsWith("subscription.") ||
    type.startsWith("invoice.") ||
    pick(payload, "data.subscription_id") != null ||
    pick(payload, "data.subscription") != null;
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
  //  - order.* → data = Order { customer, items, amount, ... }
  //  - subscription.* → data = Subscription { customer, plan, ... }
  //  - invoice.* → data = Invoice { subscription{customer, plan}, amount, ... }
  //  - charge.* → data = Charge { customer, amount, ... }
  const data = (pick(payload, "data") ?? {}) as AnyObject;

  // Customer: pode estar em vários lugares dependendo do evento. Em
  // invoice.* o customer fica aninhado dentro de subscription. Tenta na
  // ordem mais específica → mais genérica.
  const customer = (pick(
    data,
    "customer",
    "subscription.customer",
    "charge.customer",
    "order.customer",
  ) ?? {}) as AnyObject;
  const customerId = pick<string>(customer, "id") ?? null;

  const nome = String(pick<string>(customer, "name") ?? "Cliente Pagar.me");
  const email = sanitizeEmail(pick<string>(customer, "email"));
  const phone = parsePagarmePhone(
    pick(customer, "phones.mobile_phone", "phones.home_phone", "phone"),
  );

  // Valor: tenta no nível raiz, depois subscription (invoice), depois items
  const valor = parsePagarmeValor(
    pick(
      data,
      "amount",
      "total",
      "subscription.amount",
      "items.0.amount",
      "charges.0.amount",
      "charge.amount",
    ),
  );

  // Plano: nome do item, plano da subscription, ou code da fatura
  const planoNome =
    pick<string>(data, "items.0.name") ??
    pick<string>(data, "subscription.plan.name") ??
    pick<string>(data, "subscription.items.0.name") ??
    pick<string>(data, "plan.name") ??
    pick<string>(data, "code") ??
    null;

  // ID pra dedup: prefere subscription_id (estável), senão usa data.id
  const orderId =
    pick<string>(data, "subscription.id", "subscription_id") ??
    pick<string>(data, "id") ??
    null;

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
