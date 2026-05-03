import { Hono } from "hono";
import { getInsights, getCampaigns } from "../lib/meta-ads.js";

const META_BASE = "https://graph.facebook.com/v21.0";

export const metaAdsRoutes = new Hono();

function parseRange(c: { req: { query: (k: string) => string | undefined } }) {
  const sinceParam = c.req.query("since");
  const untilParam = c.req.query("until");
  const since = sinceParam ? new Date(sinceParam) : null;
  const until = untilParam ? new Date(untilParam) : new Date();
  return {
    since: since && !Number.isNaN(since.getTime()) ? since : null,
    until: until && !Number.isNaN(until.getTime()) ? until : new Date(),
  };
}

/* GET /api/meta-ads/insights?since=...&until=... */
metaAdsRoutes.get("/insights", async (c) => {
  try {
    const { since, until } = parseRange(c);
    const data = await getInsights(since, until);
    return c.json(data);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Erro Meta API" },
      500,
    );
  }
});

/* GET /api/meta-ads/campaigns?since=...&until=... */
metaAdsRoutes.get("/campaigns", async (c) => {
  try {
    const { since, until } = parseRange(c);
    const data = await getCampaigns(since, until);
    return c.json(data);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Erro Meta API" },
      500,
    );
  }
});

/* GET /api/meta-ads/debug-ad?adId=XXX
   Endpoint temporário pra inspecionar creative completo de uma ad
   específica. Útil pra debugar quando extractLpUrl não encontra LP. */
metaAdsRoutes.get("/debug-ad", async (c) => {
  const adId = c.req.query("adId");
  if (!adId) return c.json({ error: "adId obrigatório" }, 400);
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return c.json({ error: "META_ACCESS_TOKEN ausente" }, 500);
  const url = new URL(`${META_BASE}/${adId}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set(
    "fields",
    "id,name,creative{id,name,object_url,object_story_id,effective_object_story_id,thumbnail_url,object_story_spec,asset_feed_spec,template_url}",
  );
  try {
    const res = await fetch(url.toString());
    const adData = JSON.parse(await res.text());
    const result: Record<string, unknown> = {
      status: res.status,
      raw: adData,
    };
    // Se tem story_id, tentar buscar o post tambem
    const storyId = adData?.creative?.effective_object_story_id;
    if (storyId) {
      const postUrl = new URL(`${META_BASE}/${storyId}`);
      postUrl.searchParams.set("access_token", token);
      postUrl.searchParams.set(
        "fields",
        "id,permalink_url,attachments{target,unshimmed_url,url,type,description},call_to_action,message",
      );
      const postRes = await fetch(postUrl.toString());
      const postBody = await postRes.text();
      result.postFetch = {
        status: postRes.status,
        body: JSON.parse(postBody),
      };
    }
    return c.json(result);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "fetch falhou" },
      500,
    );
  }
});
