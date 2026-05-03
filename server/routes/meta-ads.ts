import { Hono } from "hono";
import { getInsights, getCampaigns } from "../lib/meta-ads.js";

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

