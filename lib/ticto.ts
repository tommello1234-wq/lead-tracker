/**
 * Adaptador Ticto -> formato interno (GatewayEvent).
 *
 * Como a Ticto pode evoluir o payload, esse parser e flexivel:
 * tenta ler campos em varios formatos comuns. Se algum payload nao bater,
 * cai no audit log com erro pra a gente investigar.
 *
 * Eventos cobertos:
 *   - Compra Aprovada     -> compra_aprovada
 *   - Compra Recusada     -> compra_recusada
 *   - PIX Gerado          -> pix_gerado
 *   - PIX Expirado        -> pix_expirado
 *   - Carrinho Abandonado -> carrinho_abandonado
 *   - Reembolso           -> reembolso
 *   - Assinatura Renovada -> assinatura_renovada
 *   - Assinatura Cancelada-> assinatura_cancelada
 */

import type { EventInput, GatewayEvent } from "@/lib/flows";
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

const EVENT_MAP: Array<{ patterns: RegExp[]; type: GatewayEvent }> = [
  { patterns: [/abandono|abandoned/i], type: "carrinho_abandonado" },
  { patterns: [/pix.*gerado|pix.*generated|pix.*created/i], type: "pix_gerado" },
  { patterns: [/pix.*expirad|pix.*expired/i], type: "pix_expirado" },
  { patterns: [/aprovad|approved|paid|pago/i], type: "compra_aprovada" },
  { patterns: [/recusad|refused|declined|rejected|expirad|expired/i], type: "compra_recusada" },
  { patterns: [/reembols|refund/i], type: "reembolso" },
  { patterns: [/cancel/i], type: "assinatura_cancelada" },
  { patterns: [/renovad|renewed|recurring/i], type: "assinatura_renovada" },
];

function detectEventType(payload: AnyObject): GatewayEvent | null {
  // Ticto pode mandar em campos como: status, event, type, name, status_name
  const sources = [
    pick<string>(payload, "status", "event", "event_name", "type", "status_name"),
    pick<string>(payload, "order.status", "transaction.status"),
    pick<string>(payload, "subscription.status"),
  ].filter(Boolean) as string[];

  for (const source of sources) {
    for (const map of EVENT_MAP) {
      if (map.patterns.some((p) => p.test(source))) return map.type;
    }
  }
  return null;
}

function parsePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.toString().replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function parsePrice(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return isNaN(n) ? null : n;
  }
  return null;
}

function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  const d = new Date(raw as string);
  return isNaN(d.getTime()) ? null : d;
}

export function parseTictoWebhook(payload: AnyObject): EventInput | null {
  const eventType = detectEventType(payload);
  if (!eventType) return null;

  const nome =
    pick<string>(payload, "customer.name", "buyer.name", "client.name", "name") ?? "Cliente Ticto";
  const email = pick<string>(payload, "customer.email", "buyer.email", "client.email", "email") ?? null;
  const phoneRaw =
    pick<string>(
      payload,
      "customer.phone",
      "customer.whatsapp",
      "buyer.phone",
      "client.phone",
      "phone",
      "whatsapp",
    ) ?? null;
  const contato = parsePhone(phoneRaw);

  const valor =
    parsePrice(pick(payload, "amount", "total", "price", "order.amount", "transaction.amount")) ??
    null;

  const planoNome =
    pick<string>(payload, "product.name", "plan.name", "offer.name", "product_name") ?? null;

  const gatewayCustomerId =
    pick<string>(payload, "customer.id", "buyer.id", "customer_id", "client.id") ?? null;

  const gatewayLastOrderId =
    pick<string>(
      payload,
      "order.id",
      "transaction.id",
      "transaction_id",
      "order_id",
      "hash",
      "code",
    ) ?? null;

  const pixExpiraEm =
    parseDate(pick(payload, "pix.expires_at", "pix_expires_at", "expires_at")) ?? null;

  return {
    source: "ticto",
    eventType,
    rawPayload: payload,
    nome,
    contato,
    email,
    gatewayCustomerId: gatewayCustomerId?.toString() ?? null,
    gatewayLastOrderId: gatewayLastOrderId?.toString() ?? null,
    valor,
    planoNome,
    pixExpiraEm,
    extras: {
      // valores que voce queira usar em templates
      link_checkout: pick<string>(payload, "checkout_url", "order.checkout_url") ?? "",
      link_pix: pick<string>(payload, "pix.qrcode", "pix_qrcode") ?? "",
    },
  };
}

/**
 * Validacao de signature da Ticto.
 *
 * A Ticto envia tipicamente um header tipo `X-Ticto-Signature` ou `X-Hub-Signature`
 * com HMAC-SHA256 do body usando o secret. Se o usuario nao configurou
 * TICTO_WEBHOOK_SECRET, pulamos validacao (modo dev). Em prod recomendamos definir.
 *
 * NOTA: confirme o nome exato do header no painel da Ticto. Hoje cobrimos:
 *   x-ticto-signature, x-hub-signature, x-hub-signature-256
 */
export function verifyTictoSignature(
  rawBody: string,
  headers: Headers,
): { valid: boolean; reason?: string } {
  const secret = process.env.TICTO_WEBHOOK_SECRET;
  if (!secret) return { valid: true, reason: "no-secret-configured" };

  const candidates = [
    headers.get("x-ticto-signature"),
    headers.get("x-hub-signature-256"),
    headers.get("x-hub-signature"),
    headers.get("x-signature"),
  ].filter(Boolean) as string[];

  if (candidates.length === 0) {
    return { valid: false, reason: "missing-signature-header" };
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  for (const sig of candidates) {
    // Suporte a formato "sha256=abc..."
    const hex = sig.replace(/^sha256=/, "");
    if (
      hex.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(hex), Buffer.from(expected))
    ) {
      return { valid: true };
    }
  }
  return { valid: false, reason: "signature-mismatch" };
}
