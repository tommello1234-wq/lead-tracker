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

import type { EventInput, GatewayEvent } from "./flows.js";

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
 * Mapa de status -> evento interno.
 *
 * Ticto v2 manda `status` em ingles snake_case. Algumas situacoes precisam
 * combinar com `payment_method` pra desambiguar (ex.: waiting_payment serve
 * tanto pra PIX quanto pra boleto).
 */
function detectEventType(payload: AnyObject): GatewayEvent | null {
  const status = String(pick<string>(payload, "status") ?? "").toLowerCase().trim();
  const method = String(pick<string>(payload, "payment_method") ?? "").toLowerCase().trim();
  const subStatus = String(pick<string>(payload, "subscription.status") ?? "").toLowerCase().trim();

  // 1) Eventos de assinatura
  if (subStatus) {
    if (/cancel/.test(subStatus)) return "assinatura_cancelada";
    if (/renew|active|ativ/.test(subStatus)) return "assinatura_renovada";
  }

  // 2) Statuses Ticto v2 (ingles snake_case)
  if (status === "authorized") return "compra_aprovada";
  if (status === "refunded") return "reembolso";
  if (status === "refused" || status === "declined") return "compra_recusada";
  if (status === "abandoned_cart") return "carrinho_abandonado";
  if (status === "waiting_payment" && method === "pix") return "pix_gerado";
  if ((status === "expired" || status === "pix_expired") && method === "pix") return "pix_expirado";
  // subscription_delayed: precisa desambiguar entre primeira compra ou renovacao falhada.
  //   - successful_charges == 0 -> nunca pagou (= primeira compra com PIX recurring)
  //                                 trata como pix_gerado (mesma intencao: cobrar pra completar)
  //   - successful_charges  > 0 -> ja era cliente, renovacao falhou (= assinatura atrasada de fato)
  if (status === "subscription_delayed") {
    const successful = pick<number>(payload, "subscriptions.0.successful_charges");
    if (typeof successful === "number" && successful > 0) return "assinatura_atrasada";
    return "pix_gerado";
  }
  if (/^subscription_(canceled|cancelled)$/.test(status)) return "assinatura_cancelada";
  if (/^subscription_(renewed|reactivated|created)$/.test(status)) return "assinatura_renovada";

  // 3) Fallback PT-BR (caso Ticto mande labels em portugues em alguma config)
  const probe = `${status} ${pick<string>(payload, "event", "event_name", "type") ?? ""}`.toLowerCase();
  if (/abandon/.test(probe)) return "carrinho_abandonado";
  if (/pix.*gerad|pix.*generated|pix.*created/.test(probe)) return "pix_gerado";
  if (/pix.*expirad|pix.*expired/.test(probe)) return "pix_expirado";
  if (/aprovad|approved|paid|pago/.test(probe)) return "compra_aprovada";
  if (/recusad|rejected/.test(probe)) return "compra_recusada";
  if (/reembols|refund/.test(probe)) return "reembolso";
  if (/cancel/.test(probe)) return "assinatura_cancelada";
  if (/renovad|renewed|recurring/.test(probe)) return "assinatura_renovada";

  // Eventos da Ticto que ainda nao temos fluxo (boleto_*, chargeback, claimed) caem como null
  return null;
}

/**
 * Telefone na Ticto v2 vem como objeto: { ddi: "+55", ddd: "11", number: "999998888" }.
 * Versoes mais antigas mandavam string. Aceitamos os dois.
 */
function parsePhone(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "object" && raw !== null) {
    const p = raw as { ddi?: unknown; ddd?: unknown; number?: unknown };
    const ddi = String(p.ddi ?? "").replace(/\D/g, "");
    const ddd = String(p.ddd ?? "").replace(/\D/g, "");
    const num = String(p.number ?? "").replace(/\D/g, "");
    if (!num) return null;
    if (ddi && ddd) return `${ddi}${ddd}${num}`;
    if (ddd) return `55${ddd}${num}`;
    return num;
  }
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/**
 * Ticto v2 manda valores como inteiro em centavos (50000 = R$ 500,00).
 * Versoes antigas / outras configs podem mandar string formatada ("R$ 47,00").
 */
function parseTictoAmount(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw / 100;
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
  const email =
    pick<string>(payload, "customer.email", "buyer.email", "client.email", "email") ?? null;

  // phone: Ticto v2 manda objeto, antigas mandavam string. parsePhone aceita os dois.
  const phoneRaw = pick(
    payload,
    "customer.phone",
    "customer.whatsapp",
    "buyer.phone",
    "client.phone",
    "phone",
    "whatsapp",
  );
  const contato = parsePhone(phoneRaw);

  // valor: Ticto v2 usa item.amount / order.paid_amount em CENTAVOS (inteiro)
  const valor =
    parseTictoAmount(
      pick(
        payload,
        "item.amount",
        "order.paid_amount",
        "order.amount",
        "amount",
        "total",
        "price",
        "transaction.amount",
      ),
    ) ?? null;

  // produto: Ticto v2 usa item.product_name + item.offer_name
  const planoNome =
    pick<string>(
      payload,
      "item.product_name",
      "item.offer_name",
      "product.name",
      "plan.name",
      "offer.name",
      "product_name",
    ) ?? null;

  // Ticto v2 nao tem customer.id — usamos cpf/cnpj como identificador estavel do cliente
  const gatewayCustomerId =
    pick<string>(
      payload,
      "customer.id",
      "buyer.id",
      "customer_id",
      "client.id",
      "customer.cpf",
      "customer.cnpj",
    ) ?? null;

  const gatewayLastOrderId =
    pick<string>(
      payload,
      "order.hash",
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
      link_boleto: pick<string>(payload, "transaction.bank_slip_url", "bank_slip_url") ?? "",
      // change_card_url: link unico pra cliente retomar pagamento da assinatura sem refazer checkout
      change_card_url: pick<string>(payload, "subscriptions.0.change_card_url") ?? "",
    },
  };
}

/**
 * Validacao do postback Ticto.
 *
 * A Ticto NAO usa HMAC. Ela manda um campo `token` dentro do JSON do postback
 * (o "token de seguranca" que o painel mostra ao criar a webhook). A gente compara
 * esse token, em tempo constante, contra TICTO_WEBHOOK_SECRET.
 *
 * Se TICTO_WEBHOOK_SECRET nao estiver setado, pulamos validacao (modo dev).
 */
export function verifyTictoSignature(
  payload: AnyObject,
): { valid: boolean; reason?: string } {
  const secret = process.env.TICTO_WEBHOOK_SECRET;
  if (!secret) return { valid: true, reason: "no-secret-configured" };

  const received = pick<string>(payload, "token", "security_token", "webhook_token");
  if (!received) return { valid: false, reason: "missing-token-in-payload" };

  const a = Buffer.from(String(received));
  const b = Buffer.from(secret);
  if (a.length !== b.length) return { valid: false, reason: "token-mismatch" };

  // timing-safe compare via XOR — nao precisamos importar crypto so pra isso
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? { valid: true } : { valid: false, reason: "token-mismatch" };
}
