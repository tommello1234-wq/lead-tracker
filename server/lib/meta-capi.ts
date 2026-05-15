/**
 * Meta Conversions API (CAPI) — envia eventos server-side pro Meta Pixel.
 *
 * Por quê:
 *  - Pixel browser perde ~20-30% (adblocker, fechamento de aba, iOS ITP)
 *  - CAPI server-side garante captura — combinado com `event_id` deduplica
 *    com o evento browser (Pixel da /obrigado), evitando dupla contagem.
 *
 * Envs necessárias:
 *  - META_PIXEL_ID (mesmo da /obrigado: 1302855225063645)
 *  - META_CAPI_ACCESS_TOKEN (gerado em Events Manager → Configurações → Conversões API)
 *  - META_TEST_EVENT_CODE (opcional, pra testar antes de ir live)
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
 */

import crypto from "node:crypto";

const GRAPH_VERSION = "v21.0";

type CapiUserData = {
  em?: string[]; // emails (SHA-256)
  ph?: string[]; // phones (SHA-256, E.164 sem +)
  fbp?: string; // _fbp cookie cru
  fbc?: string; // _fbc cookie cru
  client_ip_address?: string;
  client_user_agent?: string;
  fn?: string[]; // first name (SHA-256)
};

type CapiCustomData = {
  value: number;
  currency: string;
  content_ids?: string[];
  content_name?: string;
  content_type?: string;
  num_items?: number;
};

export type CapiPurchaseInput = {
  eventId: string; // mesmo ID do Pixel browser (= stripe session_id) — chave de dedup
  eventTime: number; // unix seconds
  eventSourceUrl?: string; // ex: "https://gravyx.com.br/obrigado"
  email?: string | null;
  phone?: string | null; // formato qualquer; será normalizado pra dígitos
  firstName?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  value: number;
  currency?: string; // default "BRL"
  plan?: string | null;
  // Atribuição opcional — Meta usa pra correlacionar com campanha (não vai no evento,
  // só log local; o `fbc` é o que liga ao click do ad).
  campaign?: string | null;
  adset?: string | null;
  ad?: string | null;
};

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input.trim().toLowerCase()).digest("hex");
}

function normalizePhoneForHash(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Envia evento Purchase pro Meta CAPI.
 * Retorna { ok, response } — log do response field é útil pra debug
 * (Events Manager mostra eventos com event_id pra confirmar dedup).
 */
export async function sendPurchaseToMeta(
  input: CapiPurchaseInput,
): Promise<{ ok: boolean; response?: unknown; error?: string }> {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  const testCode = process.env.META_TEST_EVENT_CODE; // opcional

  if (!pixelId || !token) {
    return { ok: false, error: "META_PIXEL_ID ou META_CAPI_ACCESS_TOKEN ausente" };
  }

  const user_data: CapiUserData = {};
  if (input.email) user_data.em = [sha256(input.email)];
  if (input.phone) {
    const digits = normalizePhoneForHash(input.phone);
    if (digits) user_data.ph = [sha256(digits)];
  }
  if (input.firstName) user_data.fn = [sha256(input.firstName.split(" ")[0])];
  if (input.fbp) user_data.fbp = input.fbp;
  if (input.fbc) user_data.fbc = input.fbc;
  if (input.ip) user_data.client_ip_address = input.ip;
  if (input.userAgent) user_data.client_user_agent = input.userAgent;

  const custom_data: CapiCustomData = {
    value: input.value,
    currency: input.currency ?? "BRL",
    content_type: "product",
    num_items: 1,
  };
  if (input.plan) {
    custom_data.content_ids = [`gravyx-${input.plan}`];
    custom_data.content_name = `GRAVYX ${input.plan}`;
  }

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: "Purchase",
        event_time: input.eventTime,
        event_id: input.eventId,
        event_source_url: input.eventSourceUrl ?? "https://gravyx.com.br/obrigado",
        action_source: "website",
        user_data,
        custom_data,
      },
    ],
  };
  if (testCode) body.test_event_code = testCode;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, response: json };
    }
    return { ok: true, response: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}
