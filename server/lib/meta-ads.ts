/**
 * Cliente Meta Marketing API (read-only).
 * Usa META_ACCESS_TOKEN (gerado no Graph Explorer com escopo ads_read).
 *
 * Token temporário expira em ~2h. Pra produção contínua, gerar System User
 * Token permanente no Business Manager.
 */
const BASE_URL = "https://graph.facebook.com/v21.0";

function getToken(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error("META_ACCESS_TOKEN não configurado");
  return t;
}

function getAdAccountId(): string {
  // act_918344584462338 (CT 01 - Gravyx)
  return process.env.META_AD_ACCOUNT_ID
    ? `act_${process.env.META_AD_ACCOUNT_ID.replace(/^act_/, "")}`
    : "act_918344584462338";
}

type AnyObject = Record<string, unknown>;

async function metaFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("access_token", getToken());
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta API ${path}: ${res.status} ${body.substring(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/* ========================================================
 * Tipos
 * ======================================================== */
export type MetaInsights = {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  cpc: number;
  cpm: number;
  ctr: number;
  purchases: number;
  initiateCheckout: number;
  cpa: number; // spend / purchases
  cpic: number; // spend / initiate checkout
};

export type MetaCampaign = {
  campaignId: string;
  campaignName: string;
  spend: number;
  purchases: number;
  initiateCheckout: number;
  clicks: number;
  cpa: number | null;
  ctr: number;
};

/* ========================================================
 * Helpers
 * ======================================================== */
function buildTimeRange(since: Date | null, until: Date | null): string {
  if (since && until) {
    // Format as YYYY-MM-DD in São Paulo timezone (Meta ad account timezone).
    // Plain .toISOString() would shift dates after 21h BRT into the next UTC day.
    const fmtIso = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    return JSON.stringify({ since: fmtIso(since), until: fmtIso(until) });
  }
  return "";
}

function pickAction(actions: Array<{ action_type: string; value: string }> | undefined, type: string): number {
  if (!actions) return 0;
  const a = actions.find((x) => x.action_type === type);
  return a ? Number(a.value) : 0;
}

/* ========================================================
 * Insights agregados da conta
 * ======================================================== */
export async function getInsights(
  since: Date | null,
  until: Date | null,
): Promise<MetaInsights> {
  const account = getAdAccountId();
  // inline_link_clicks + cost_per_inline_link_click + ctr=link_click_through_rate
  // alinham com o default da Meta UI (custo/clique no link, não em qualquer click).
  const params: Record<string, string> = {
    fields:
      "spend,impressions,inline_link_clicks,reach,cost_per_inline_link_click,cpm,inline_link_click_ctr,actions",
  };
  if (since && until) {
    params.time_range = buildTimeRange(since, until);
  } else {
    params.date_preset = "maximum";
  }

  const resp = await metaFetch<{ data: AnyObject[] }>(`/${account}/insights`, params);
  const d = resp.data?.[0] ?? {};
  const actions = d.actions as Array<{ action_type: string; value: string }> | undefined;

  const spend = Number(d.spend ?? 0);
  const purchases = pickAction(actions, "omni_purchase");
  const initiateCheckout = pickAction(actions, "initiate_checkout");

  return {
    spend,
    impressions: Number(d.impressions ?? 0),
    clicks: Number(d.inline_link_clicks ?? 0),
    reach: Number(d.reach ?? 0),
    cpc: Number(d.cost_per_inline_link_click ?? 0),
    cpm: Number(d.cpm ?? 0),
    ctr: Number(d.inline_link_click_ctr ?? 0),
    purchases,
    initiateCheckout,
    cpa: purchases > 0 ? spend / purchases : 0,
    cpic: initiateCheckout > 0 ? spend / initiateCheckout : 0,
  };
}

/* ========================================================
 * Performance por campanha
 * ======================================================== */
export async function getCampaigns(
  since: Date | null,
  until: Date | null,
): Promise<MetaCampaign[]> {
  const account = getAdAccountId();
  const params: Record<string, string> = {
    fields:
      "campaign_id,campaign_name,spend,inline_link_clicks,inline_link_click_ctr,actions",
    level: "campaign",
    limit: "50",
  };
  if (since && until) {
    params.time_range = buildTimeRange(since, until);
  } else {
    params.date_preset = "maximum";
  }

  const resp = await metaFetch<{ data: AnyObject[] }>(`/${account}/insights`, params);
  return (resp.data ?? []).map((c) => {
    const actions = c.actions as Array<{ action_type: string; value: string }> | undefined;
    const spend = Number(c.spend ?? 0);
    const purchases = pickAction(actions, "omni_purchase");
    const ic = pickAction(actions, "initiate_checkout");
    return {
      campaignId: String(c.campaign_id ?? ""),
      campaignName: String(c.campaign_name ?? "—"),
      spend,
      purchases,
      initiateCheckout: ic,
      clicks: Number(c.inline_link_clicks ?? 0),
      cpa: purchases > 0 ? spend / purchases : null,
      ctr: Number(c.inline_link_click_ctr ?? 0),
    };
  });
}
