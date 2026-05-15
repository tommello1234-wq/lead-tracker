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
  // Timeout 15s — date_preset=maximum em conta grande pode travar pra sempre,
  // sem timeout o handler espera até o function timeout do Vercel (60s) e o
  // user vê "Carregando..." infinito.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API ${path}: ${res.status} ${body.substring(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
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
  frequency: number; // impressions / reach
  purchases: number;
  initiateCheckout: number;
  landingPageViews: number;
  viewContent: number;
  addToCart: number;
  purchaseValue: number; // R$ atribuído (Pixel)
  roas: number; // purchaseValue / spend
  cpa: number; // spend / purchases
  cpic: number; // spend / initiate checkout
};

export type CampaignStatus =
  | "ACTIVE"
  | "PAUSED"
  | "DELETED"
  | "ARCHIVED"
  | "PENDING_REVIEW"
  | "DISAPPROVED"
  | "PREAPPROVED"
  | "PENDING_BILLING_INFO"
  | "CAMPAIGN_PAUSED"
  | "ARCHIVED_BY_USER"
  | "IN_PROCESS"
  | "WITH_ISSUES"
  | "UNKNOWN";

export type MetaCampaign = {
  campaignId: string;
  campaignName: string;
  status: CampaignStatus;
  spend: number;
  purchases: number;
  initiateCheckout: number;
  clicks: number;
  cpa: number | null;
  cpc: number;
  ctr: number;
  purchaseValue: number;
  roas: number;
  /** URL da LP (do primeiro ad ativo da campanha) — pra abrir e conferir destino */
  landingPageUrl: string | null;
  /** ID de um ad da campanha — pra montar URL do Ads Manager e ver o criativo */
  sampleAdId: string | null;
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

/**
 * Soma valores de uma action (pra pegar revenue total atribuído).
 * Diferente de pickAction (que pega contagem), usa action_values com o valor R$.
 */
function pickActionValue(
  actionValues: Array<{ action_type: string; value: string }> | undefined,
  type: string,
): number {
  if (!actionValues) return 0;
  const a = actionValues.find((x) => x.action_type === type);
  return a ? Number(a.value) : 0;
}

/**
 * Extrai URL de destino de um creative Meta. Cobre múltiplos formatos:
 * - link_data (single image/video standard)
 * - template_data (carousel)
 * - video_data com CTA
 * - asset_feed_spec (Advantage+ creative — formato novo da Meta)
 * - photo_data (foto com link)
 * - object_url no nível do creative (dark posts e ads de post existente)
 */
function extractLpUrl(creative: AnyObject | undefined): string | null {
  if (!creative) return null;

  // Primeiro: object_url direto no creative (dark posts, post boost)
  const directUrl = creative.object_url as string | undefined;
  if (directUrl) return directUrl;

  const oss = creative.object_story_spec as AnyObject | undefined;
  if (oss) {
    const linkData = oss.link_data as { link?: string } | undefined;
    if (linkData?.link) return linkData.link;
    const templateData = oss.template_data as { link?: string } | undefined;
    if (templateData?.link) return templateData.link;
    const videoData = oss.video_data as
      | { call_to_action?: { value?: { link?: string } } }
      | undefined;
    if (videoData?.call_to_action?.value?.link) return videoData.call_to_action.value.link;
    const photoData = oss.photo_data as { url?: string } | undefined;
    if (photoData?.url) return photoData.url;
  }

  // Advantage+ creative (asset_feed_spec) — formato novo da Meta
  const afs = creative.asset_feed_spec as AnyObject | undefined;
  if (afs) {
    const links = afs.link_urls as Array<{ website_url?: string }> | undefined;
    if (links?.[0]?.website_url) return links[0].website_url;
  }

  return null;
}

/**
 * Pra dark posts (vídeo/imagem que é um post existente do Facebook/Instagram),
 * o creative só traz `effective_object_story_id` no formato "page_id_post_id".
 * Pra achar a LP real, fazemos uma chamada extra ao post pegando o link
 * via attachments ou call_to_action.
 */
async function fetchDarkPostLink(storyId: string): Promise<string | null> {
  try {
    const url = new URL(`${BASE_URL}/${storyId}`);
    url.searchParams.set("access_token", getToken());
    url.searchParams.set(
      "fields",
      "attachments{target,unshimmed_url},call_to_action,permalink_url",
    );
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) return null;
      const data = (await res.json()) as AnyObject;
      // attachments[0].target.url é o link de destino mais comum em dark posts
      const attachments = data.attachments as
        | { data?: Array<{ target?: { url?: string }; unshimmed_url?: string }> }
        | undefined;
      const att = attachments?.data?.[0];
      if (att?.unshimmed_url) return att.unshimmed_url;
      if (att?.target?.url) return att.target.url;
      // call_to_action também pode ter link
      const cta = data.call_to_action as { value?: { link?: string } } | undefined;
      if (cta?.value?.link) return cta.value.link;
      return null;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
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
      "spend,impressions,inline_link_clicks,reach,cost_per_inline_link_click,cpm,inline_link_click_ctr,frequency,actions,action_values",
  };
  if (since && until) {
    params.time_range = buildTimeRange(since, until);
  } else {
    params.date_preset = "maximum";
  }

  const resp = await metaFetch<{ data: AnyObject[] }>(`/${account}/insights`, params);
  const d = resp.data?.[0] ?? {};
  const actions = d.actions as Array<{ action_type: string; value: string }> | undefined;
  const actionValues = d.action_values as Array<{ action_type: string; value: string }> | undefined;

  const spend = Number(d.spend ?? 0);
  const impressions = Number(d.impressions ?? 0);
  const reach = Number(d.reach ?? 0);
  const purchases = pickAction(actions, "omni_purchase");
  const initiateCheckout = pickAction(actions, "initiate_checkout");
  const landingPageViews = pickAction(actions, "landing_page_view");
  const viewContent = pickAction(actions, "view_content");
  const addToCart = pickAction(actions, "add_to_cart");
  const purchaseValue = pickActionValue(actionValues, "omni_purchase");

  return {
    spend,
    impressions,
    clicks: Number(d.inline_link_clicks ?? 0),
    reach,
    cpc: Number(d.cost_per_inline_link_click ?? 0),
    cpm: Number(d.cpm ?? 0),
    ctr: Number(d.inline_link_click_ctr ?? 0),
    frequency: Number(d.frequency ?? (reach > 0 ? impressions / reach : 0)),
    purchases,
    initiateCheckout,
    landingPageViews,
    viewContent,
    addToCart,
    purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : 0,
    cpa: purchases > 0 ? spend / purchases : 0,
    cpic: initiateCheckout > 0 ? spend / initiateCheckout : 0,
  };
}

/* ========================================================
 * Gasto Meta por dia (pra gráfico de lucro diário)
 * Retorna 1 row por dia no período. Days zerados (sem gasto)
 * NÃO aparecem na resposta — frontend preenche com zero.
 * ======================================================== */
export async function getDailyAdSpend(
  since: Date,
  until: Date,
): Promise<Array<{ date: string; spend: number }>> {
  const account = getAdAccountId();
  const params: Record<string, string> = {
    fields: "spend",
    time_range: buildTimeRange(since, until),
    time_increment: "1", // 1 dia
    limit: "100",
  };
  try {
    const resp = await metaFetch<{
      data: Array<{ date_start: string; spend: string }>;
    }>(`/${account}/insights`, params);
    return (resp.data ?? []).map((d) => ({
      date: d.date_start,
      spend: Number(d.spend ?? 0),
    }));
  } catch {
    return [];
  }
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
      "campaign_id,campaign_name,spend,inline_link_clicks,inline_link_click_ctr,cost_per_inline_link_click,actions,action_values",
    level: "campaign",
    limit: "50",
  };
  if (since && until) {
    params.time_range = buildTimeRange(since, until);
  } else {
    params.date_preset = "maximum";
  }

  // 3 chamadas em paralelo: insights (métricas), status das campanhas, e ads
  // (pra extrair LP URL + sample ad ID por campanha — atalho na tabela).
  const [insightsResp, statusResp, adsResp] = await Promise.all([
    metaFetch<{ data: AnyObject[] }>(`/${account}/insights`, params),
    metaFetch<{ data: AnyObject[] }>(`/${account}/campaigns`, {
      fields: "id,effective_status",
      limit: "200",
    }),
    metaFetch<{ data: AnyObject[] }>(`/${account}/ads`, {
      fields:
        "id,campaign_id,effective_status,creative{object_url,effective_object_story_id,object_story_spec{link_data{link},template_data{link},video_data{call_to_action{value{link}}},photo_data{url}},asset_feed_spec{link_urls}}",
      limit: "500",
    }),
  ]);

  const statusById = new Map<string, CampaignStatus>();
  for (const c of statusResp.data ?? []) {
    statusById.set(String(c.id ?? ""), (c.effective_status as CampaignStatus) ?? "UNKNOWN");
  }

  // Pra cada campanha, pega 1 ad (preferindo ACTIVE) com sua LP URL.
  type AdInfo = {
    adId: string;
    lpUrl: string | null;
    storyId: string | null;
    isActive: boolean;
  };
  const adsByCampaign = new Map<string, AdInfo>();
  for (const ad of adsResp.data ?? []) {
    const campId = String(ad.campaign_id ?? "");
    if (!campId) continue;
    const creative = ad.creative as AnyObject | undefined;
    const info: AdInfo = {
      adId: String(ad.id ?? ""),
      lpUrl: extractLpUrl(creative),
      storyId: (creative?.effective_object_story_id as string | undefined) ?? null,
      isActive: String(ad.effective_status ?? "") === "ACTIVE",
    };
    const existing = adsByCampaign.get(campId);
    if (!existing || (!existing.isActive && info.isActive)) {
      adsByCampaign.set(campId, info);
    }
  }

  // Fallback: pra ads sem LP detectada mas que têm storyId (dark posts),
  // busca o link no post. Em paralelo pra não atrasar.
  const darkPostFetches = Array.from(adsByCampaign.entries())
    .filter(([, info]) => !info.lpUrl && info.storyId)
    .map(async ([campId, info]) => {
      const link = await fetchDarkPostLink(info.storyId!);
      if (link) {
        adsByCampaign.set(campId, { ...info, lpUrl: link });
      }
    });
  await Promise.all(darkPostFetches);

  return (insightsResp.data ?? []).map((c) => {
    const actions = c.actions as Array<{ action_type: string; value: string }> | undefined;
    const actionValues = c.action_values as Array<{ action_type: string; value: string }> | undefined;
    const spend = Number(c.spend ?? 0);
    const purchases = pickAction(actions, "omni_purchase");
    const ic = pickAction(actions, "initiate_checkout");
    const purchaseValue = pickActionValue(actionValues, "omni_purchase");
    const id = String(c.campaign_id ?? "");
    const adInfo = adsByCampaign.get(id);
    return {
      campaignId: id,
      campaignName: String(c.campaign_name ?? "—"),
      status: statusById.get(id) ?? "UNKNOWN",
      spend,
      purchases,
      initiateCheckout: ic,
      clicks: Number(c.inline_link_clicks ?? 0),
      cpa: purchases > 0 ? spend / purchases : null,
      cpc: Number(c.cost_per_inline_link_click ?? 0),
      ctr: Number(c.inline_link_click_ctr ?? 0),
      purchaseValue,
      roas: spend > 0 ? purchaseValue / spend : 0,
      landingPageUrl: adInfo?.lpUrl ?? null,
      sampleAdId: adInfo?.adId ?? null,
    };
  });
}

/* ========================================================
 * Ads (nível mais granular — pra importar como ângulos)
 * ======================================================== */
export type MetaAd = {
  adId: string;
  adName: string;
  status: CampaignStatus;
  campaignId: string;
  campaignName: string;
  /** URL da imagem ou frame do vídeo do criativo */
  thumbnailUrl: string | null;
  /** URL da imagem (se ad de imagem) ou null pra vídeo puro */
  imageUrl: string | null;
  /** ID do vídeo no Meta (se ad de vídeo) */
  videoId: string | null;
  /** Headline / título do ad */
  headline: string | null;
  /** Body / mensagem do ad */
  body: string | null;
  /** URL de destino (LP) */
  landingPageUrl: string | null;
  // Métricas
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number; // %
  cpa: number | null;
  roas: number;
  purchases: number;
  initiateCheckout: number;
  landingPageViews: number;
};

/**
 * Extrai headline/body/imageUrl de um creative.
 */
function extractCreativeMeta(creative: AnyObject | undefined): {
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
  headline: string | null;
  body: string | null;
} {
  if (!creative) {
    return {
      thumbnailUrl: null,
      imageUrl: null,
      videoId: null,
      headline: null,
      body: null,
    };
  }

  const directThumb = (creative.thumbnail_url as string | undefined) ?? null;
  const directImage = (creative.image_url as string | undefined) ?? null;
  const directVideoId = (creative.video_id as string | undefined) ?? null;

  let headline: string | null = null;
  let body: string | null = null;
  let imageUrl: string | null = directImage;
  let videoId: string | null = directVideoId;

  const oss = creative.object_story_spec as AnyObject | undefined;
  if (oss) {
    const linkData = oss.link_data as
      | { name?: string; message?: string; description?: string; picture?: string }
      | undefined;
    if (linkData) {
      headline = linkData.name ?? linkData.description ?? null;
      body = linkData.message ?? null;
      if (!imageUrl && linkData.picture) imageUrl = linkData.picture;
    }
    const videoData = oss.video_data as
      | {
          title?: string;
          message?: string;
          link_description?: string;
          image_url?: string;
          video_id?: string;
        }
      | undefined;
    if (videoData) {
      headline = headline ?? videoData.title ?? videoData.link_description ?? null;
      body = body ?? videoData.message ?? null;
      if (!videoId && videoData.video_id) videoId = videoData.video_id;
      if (!imageUrl && videoData.image_url) imageUrl = videoData.image_url;
    }
  }

  // Advantage+ creative
  const afs = creative.asset_feed_spec as AnyObject | undefined;
  if (afs) {
    const titles = afs.titles as Array<{ text?: string }> | undefined;
    if (!headline && titles?.[0]?.text) headline = titles[0].text;
    const bodies = afs.bodies as Array<{ text?: string }> | undefined;
    if (!body && bodies?.[0]?.text) body = bodies[0].text;
    const images = afs.images as Array<{ url?: string }> | undefined;
    if (!imageUrl && images?.[0]?.url) imageUrl = images[0].url;
    const videos = afs.videos as Array<{ video_id?: string; thumbnail_url?: string }> | undefined;
    if (!videoId && videos?.[0]?.video_id) videoId = videos[0].video_id;
    if (!directThumb && videos?.[0]?.thumbnail_url) {
      // só usa se não tinha thumb direto
      return {
        thumbnailUrl: videos[0].thumbnail_url ?? null,
        imageUrl,
        videoId,
        headline,
        body,
      };
    }
  }

  return {
    thumbnailUrl: directThumb ?? imageUrl,
    imageUrl,
    videoId,
    headline,
    body,
  };
}

/**
 * Lista ads do ad account com criativo + LP + insights.
 *
 * Filtra por status: por default só ACTIVE/PAUSED (esconde DELETED/ARCHIVED).
 */
export async function getAds(
  since: Date | null,
  until: Date | null,
  options?: { onlyWithSpend?: boolean; limit?: number },
): Promise<MetaAd[]> {
  const account = getAdAccountId();
  const adsLimit = String(options?.limit ?? 200);

  // 2 chamadas em paralelo: ads (com criativo) e insights (com métricas).
  const params: Record<string, string> = {
    fields:
      "spend,impressions,inline_link_clicks,inline_link_click_ctr,actions,action_values,ad_id,ad_name,campaign_id,campaign_name",
    level: "ad",
    limit: adsLimit,
  };
  if (since && until) {
    params.time_range = buildTimeRange(since, until);
  } else {
    params.date_preset = "last_90d";
  }

  const [insightsResp, adsResp] = await Promise.all([
    metaFetch<{ data: AnyObject[] }>(`/${account}/insights`, params),
    metaFetch<{ data: AnyObject[] }>(`/${account}/ads`, {
      fields:
        "id,name,effective_status,campaign_id,creative{id,object_url,effective_object_story_id,thumbnail_url,image_url,video_id,object_story_spec{link_data{name,message,description,picture,link},template_data{link},video_data{title,message,link_description,image_url,video_id,call_to_action{value{link}}},photo_data{url}},asset_feed_spec{link_urls,titles,bodies,images,videos}}",
      limit: adsLimit,
    }),
  ]);

  // Map ad meta (creative + status) por ad ID
  type AdCreativeMeta = ReturnType<typeof extractCreativeMeta> & {
    status: CampaignStatus;
    lpUrl: string | null;
    storyId: string | null;
    name: string;
    campaignId: string;
  };
  const metaById = new Map<string, AdCreativeMeta>();
  for (const ad of adsResp.data ?? []) {
    const id = String(ad.id ?? "");
    if (!id) continue;
    const creative = ad.creative as AnyObject | undefined;
    const cmeta = extractCreativeMeta(creative);
    metaById.set(id, {
      ...cmeta,
      status: (ad.effective_status as CampaignStatus) ?? "UNKNOWN",
      lpUrl: extractLpUrl(creative),
      storyId: (creative?.effective_object_story_id as string | undefined) ?? null,
      name: String(ad.name ?? "—"),
      campaignId: String(ad.campaign_id ?? ""),
    });
  }

  // Dark post fallback pra LPs vazias
  const darkPostFetches = Array.from(metaById.entries())
    .filter(([, m]) => !m.lpUrl && m.storyId)
    .map(async ([id, m]) => {
      const link = await fetchDarkPostLink(m.storyId!);
      if (link) metaById.set(id, { ...m, lpUrl: link });
    });
  await Promise.all(darkPostFetches);

  // Combina insights + meta
  const out: MetaAd[] = [];
  for (const ins of insightsResp.data ?? []) {
    const adId = String(ins.ad_id ?? "");
    if (!adId) continue;
    const meta = metaById.get(adId);
    const actions = ins.actions as
      | Array<{ action_type: string; value: string }>
      | undefined;
    const actionValues = ins.action_values as
      | Array<{ action_type: string; value: string }>
      | undefined;
    const spend = Number(ins.spend ?? 0);
    const purchases = pickAction(actions, "omni_purchase");
    const purchaseValue = pickActionValue(actionValues, "omni_purchase");
    if (options?.onlyWithSpend && spend === 0) continue;
    out.push({
      adId,
      adName: meta?.name ?? String(ins.ad_name ?? "—"),
      status: meta?.status ?? "UNKNOWN",
      campaignId: meta?.campaignId ?? String(ins.campaign_id ?? ""),
      campaignName: String(ins.campaign_name ?? "—"),
      thumbnailUrl: meta?.thumbnailUrl ?? null,
      imageUrl: meta?.imageUrl ?? null,
      videoId: meta?.videoId ?? null,
      headline: meta?.headline ?? null,
      body: meta?.body ?? null,
      landingPageUrl: meta?.lpUrl ?? null,
      spend,
      impressions: Number(ins.impressions ?? 0),
      clicks: Number(ins.inline_link_clicks ?? 0),
      ctr: Number(ins.inline_link_click_ctr ?? 0),
      cpa: purchases > 0 ? spend / purchases : null,
      roas: spend > 0 ? purchaseValue / spend : 0,
      purchases,
      initiateCheckout: pickAction(actions, "initiate_checkout"),
      landingPageViews: pickAction(actions, "landing_page_view"),
    });
  }
  // Sort por spend desc (maior gasto primeiro)
  out.sort((a, b) => b.spend - a.spend);
  return out;
}
