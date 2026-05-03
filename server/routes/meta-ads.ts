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

/* GET /api/meta-ads/debug-ad?adId=X — temporário pra investigar LP missing */
metaAdsRoutes.get("/debug-ad", async (c) => {
  const adId = c.req.query("adId");
  const token = process.env.META_ACCESS_TOKEN;
  if (!adId || !token) return c.json({ error: "adId+token req" }, 400);
  const adRes = await fetch(
    `${META_BASE}/${adId}?access_token=${token}&fields=id,name,creative{id,name,object_url,effective_object_story_id,thumbnail_url,object_story_spec,asset_feed_spec}`,
  );
  const ad = (await adRes.json()) as {
    creative?: { effective_object_story_id?: string };
  };
  const result: Record<string, unknown> = { ad };
  const storyId = ad?.creative?.effective_object_story_id;
  if (storyId) {
    const postRes = await fetch(
      `${META_BASE}/${storyId}?access_token=${token}&fields=id,permalink_url,attachments{target,unshimmed_url,url,type,description,subattachments},call_to_action,message`,
    );
    result.post = await postRes.json();
    // Tenta identificar a página pública (page_id é a parte antes do _)
    const pageId = storyId.split("_")[0];
    if (pageId) {
      const pageRes = await fetch(
        `${META_BASE}/${pageId}?access_token=${token}&fields=id,name,link,username`,
      );
      result.page = await pageRes.json();
    }
  }
  return c.json(result);
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

