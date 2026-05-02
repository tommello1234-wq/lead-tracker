import { Hono } from "hono";
import {
  getDashboardMetrics,
  getDailySeries,
  getFaturamento,
  getPlanoBreakdown,
  getTipoBreakdown,
  getSidebarCounts,
} from "../lib/queries.js";
import {
  getMetodoBreakdown,
  getFunilPix,
  getRetencaoPorMetodo,
} from "../lib/saas-metrics.js";

export const dashboardRoutes = new Hono();

function parseProdutoId(c: { req: { query: (k: string) => string | undefined } }): number | null {
  const v = c.req.query("produtoId");
  if (!v || v === "all") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseSince(c: { req: { query: (k: string) => string | undefined } }): Date | null {
  const v = c.req.query("since");
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ==========================================================================
 * GET /api/dashboard/sidebar-counts
 * ========================================================================== */
dashboardRoutes.get("/sidebar-counts", async (c) => {
  const counts = await getSidebarCounts();
  return c.json(counts);
});

/* ==========================================================================
 * GET /api/dashboard/metrics?produtoId=N&since=ISO
 * ========================================================================== */
dashboardRoutes.get("/metrics", async (c) => {
  const produtoId = parseProdutoId(c);
  const since = parseSince(c);
  const metrics = await getDashboardMetrics(produtoId, since);
  return c.json(metrics);
});

/* ==========================================================================
 * GET /api/dashboard/daily?produtoId=N&days=30
 * ========================================================================== */
dashboardRoutes.get("/daily", async (c) => {
  const produtoId = parseProdutoId(c);
  const days = Number(c.req.query("days") ?? 30) || 30;
  const series = await getDailySeries(days, produtoId);
  return c.json(series);
});

/* ==========================================================================
 * GET /api/dashboard/faturamento?produtoId=N&since=ISO
 * ========================================================================== */
dashboardRoutes.get("/faturamento", async (c) => {
  const produtoId = parseProdutoId(c);
  const since = parseSince(c);
  const data = await getFaturamento(produtoId, since);
  return c.json(data);
});

/* ==========================================================================
 * GET /api/dashboard/breakdowns?produtoId=N
 * Retorna planos + tipos numa response só (1 round-trip menos pro frontend).
 * ========================================================================== */
dashboardRoutes.get("/breakdowns", async (c) => {
  const produtoId = parseProdutoId(c);
  const [planos, tipos] = await Promise.all([
    getPlanoBreakdown(produtoId),
    getTipoBreakdown(produtoId),
  ]);
  return c.json({ planos, tipos });
});

/* ==========================================================================
 * GET /api/dashboard/saas?produtoId=N&since=ISO
 * Métricas profundas pra produtos SaaS: breakdown por método de pagamento,
 * funil PIX, retenção por método. Tudo derivado dos eventos JSONB sem
 * precisar de schema migration.
 * ========================================================================== */
dashboardRoutes.get("/saas", async (c) => {
  const produtoId = parseProdutoId(c);
  const since = parseSince(c);
  const [metodos, funilPix, retencao] = await Promise.all([
    getMetodoBreakdown(produtoId, since),
    getFunilPix(produtoId, since),
    getRetencaoPorMetodo(produtoId),
  ]);
  return c.json({ metodos, funilPix, retencao });
});
