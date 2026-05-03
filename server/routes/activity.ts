import { Hono } from "hono";
import { getRecentActivity, getFunilSnapshot } from "../lib/activity.js";

export const activityRoutes = new Hono();

function parseProdutoId(c: { req: { query: (k: string) => string | undefined } }): number | null {
  const v = c.req.query("produtoId");
  if (!v || v === "all") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* GET /api/activity/recent?produtoId=X&limit=30 */
activityRoutes.get("/recent", async (c) => {
  const produtoId = parseProdutoId(c);
  const limit = Math.min(Number(c.req.query("limit") ?? 30) || 30, 100);
  const items = await getRecentActivity(produtoId, limit);
  return c.json(items);
});

/* GET /api/activity/funil?produtoId=X&since=ISO&until=ISO */
activityRoutes.get("/funil", async (c) => {
  const produtoId = parseProdutoId(c);
  const sinceParam = c.req.query("since");
  const untilParam = c.req.query("until");
  const since = sinceParam ? new Date(sinceParam) : null;
  const until = untilParam ? new Date(untilParam) : null;
  const snapshot = await getFunilSnapshot(
    produtoId,
    since && !Number.isNaN(since.getTime()) ? since : null,
    until && !Number.isNaN(until.getTime()) ? until : null,
  );
  return c.json(snapshot);
});
