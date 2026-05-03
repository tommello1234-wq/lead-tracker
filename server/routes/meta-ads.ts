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

/* GET /api/meta-ads/debug-ticto?path=/v1/orders/history&status=...
   Endpoint temporário pra explorar a API Ticto. */
metaAdsRoutes.get("/debug-ticto", async (c) => {
  const path = c.req.query("path") ?? "/v1/orders/history";
  const status = c.req.query("status");
  const clientId = process.env.TICTO_CLIENT_ID;
  const clientSecret = process.env.TICTO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.json({ error: "TICTO_CLIENT_ID/SECRET ausente" }, 500);
  }
  // Auth
  const authRes = await fetch("https://glados.ticto.cloud/api/security/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "*",
    }),
  });
  const authData = (await authRes.json()) as { access_token?: string };
  if (!authData.access_token) {
    return c.json({ error: "Auth Ticto falhou", detail: authData }, 500);
  }
  const url = new URL(`https://glados.ticto.cloud/api${path}`);
  if (status) url.searchParams.set("filter[status]", status);
  url.searchParams.set("page", "1");
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${authData.access_token}`,
      Accept: "application/json",
    },
  });
  const body = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }
  return c.json({ url: url.toString(), status: res.status, body: parsed });
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

