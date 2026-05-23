import { Hono } from "hono";
import {
  getDashboardMetrics,
  getDailySeries,
  getDailyRevenue,
  getFaturamento,
  getPlanoBreakdown,
  getTipoBreakdown,
  getSidebarCounts,
  getVendasPorPlano,
  getVendasPorLp,
  getMrrHistory,
} from "../lib/queries.js";
import {
  getMetodoBreakdown,
  getFunilPix,
  getRetencaoPorMetodo,
} from "../lib/saas-metrics.js";
import { getCacMetrics } from "../lib/cac.js";
import { getCohortMatrix } from "../lib/cohort.js";
import { getChurnMetrics } from "../lib/churn.js";
import { getDetails, type DetailsKind } from "../lib/details.js";
import { getMrrBreakdown, getMrrMovementLeads } from "../lib/mrr.js";

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

function parseUntil(c: { req: { query: (k: string) => string | undefined } }): Date | null {
  const v = c.req.query("until");
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const VALID_GATEWAYS = new Set(["stripe", "ticto", "asaas", "pagarme"]);
function parseGateway(c: { req: { query: (k: string) => string | undefined } }): string | null {
  const v = c.req.query("gateway");
  if (!v || v === "all") return null;
  return VALID_GATEWAYS.has(v) ? v : null;
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
  const until = parseUntil(c);
  const gateway = parseGateway(c);
  const metrics = await getDashboardMetrics(produtoId, since, until, gateway);
  return c.json(metrics);
});

/* ==========================================================================
 * GET /api/dashboard/daily?produtoId=N&days=30
 * ========================================================================== */
dashboardRoutes.get("/daily", async (c) => {
  const produtoId = parseProdutoId(c);
  const gateway = parseGateway(c);
  const days = Number(c.req.query("days") ?? 30) || 30;
  const series = await getDailySeries(days, produtoId, gateway);
  return c.json(series);
});

/* ==========================================================================
 * GET /api/dashboard/cohort?produtoId=N&gateway=stripe
 * Matriz de retenção mensal + LTV real (observado e projetado) por cohort de
 * signup. Diferente do LTV blended em /metrics que só vê quem cancelou.
 * ========================================================================== */
dashboardRoutes.get("/cohort", async (c) => {
  const produtoId = parseProdutoId(c);
  const gateway = parseGateway(c);
  const data = await getCohortMatrix(produtoId, gateway);
  return c.json(data);
});

/* ==========================================================================
 * GET /api/dashboard/vendas-por-lp?produtoId=N&days=30
 * Vendas (leads pagantes) agrupadas por LP de origem nos últimos N dias.
 * Permite ver qual LP gera mais conversão. Fonte: leads.lp_origem
 * (preenchido via client_reference_id codificado pelo stripe-attribution.js).
 * ========================================================================== */
dashboardRoutes.get("/vendas-por-lp", async (c) => {
  const produtoId = parseProdutoId(c);
  const since = parseSince(c);
  const until = parseUntil(c);
  const gateway = parseGateway(c);
  const data = await getVendasPorLp(produtoId, since, until, gateway);
  return c.json(data);
});

/* ==========================================================================
 * GET /api/dashboard/daily-revenue?produtoId=N&days=30
 * Faturamento líquido por dia (compras + renovações − reembolsos), pra o
 * gráfico de linha no dashboard. Inclui dias zerados pra série contínua.
 * ========================================================================== */
dashboardRoutes.get("/daily-revenue", async (c) => {
  const produtoId = parseProdutoId(c);
  const gateway = parseGateway(c);
  const days = Number(c.req.query("days") ?? 30) || 30;
  const series = await getDailyRevenue(days, produtoId, gateway);
  return c.json(series);
});

/* ==========================================================================
 * GET /api/dashboard/mrr-history?produtoId=N&days=30&gateway=stripe
 * Evolução do MRR (snapshot por dia). Cada ponto = MRR no fim daquele dia.
 * ========================================================================== */
dashboardRoutes.get("/mrr-history", async (c) => {
  const produtoId = parseProdutoId(c);
  const gateway = parseGateway(c);
  const days = Number(c.req.query("days") ?? 30) || 30;
  const data = await getMrrHistory(days, produtoId, gateway);
  return c.json(data);
});

/* ==========================================================================
 * GET /api/dashboard/churn?produtoId=N&gateway=stripe&days=30
 * Métricas de churn: cancelamentos, reembolsos, taxa de churn mensal,
 * LTV via churn. Reembolso é separado (não é churn de verdade).
 * ========================================================================== */
dashboardRoutes.get("/churn", async (c) => {
  const produtoId = parseProdutoId(c);
  const gateway = parseGateway(c);
  const days = Number(c.req.query("days") ?? 30) || 30;
  const data = await getChurnMetrics(produtoId, gateway, days);
  return c.json(data);
});

/* ==========================================================================
 * GET /api/dashboard/faturamento?produtoId=N&since=ISO
 * ========================================================================== */
dashboardRoutes.get("/faturamento", async (c) => {
  const produtoId = parseProdutoId(c);
  const since = parseSince(c);
  const until = parseUntil(c);
  const gateway = parseGateway(c);
  const data = await getFaturamento(produtoId, since, until, gateway);
  return c.json(data);
});

/* ==========================================================================
 * GET /api/dashboard/breakdowns?produtoId=N
 * Retorna planos + tipos numa response só (1 round-trip menos pro frontend).
 * ========================================================================== */
dashboardRoutes.get("/breakdowns", async (c) => {
  const produtoId = parseProdutoId(c);
  const gateway = parseGateway(c);
  const [planos, tipos] = await Promise.all([
    getPlanoBreakdown(produtoId, gateway),
    getTipoBreakdown(produtoId, gateway),
  ]);
  return c.json({ planos, tipos });
});

/* ==========================================================================
 * GET /api/dashboard/details?kind=X&produtoId=N&since=ISO&until=ISO
 * Drill-down: lista de leads relevantes ao card clicado.
 * ========================================================================== */
const ALLOWED_KINDS = new Set<string>([
  "ativos",
  "novos",
  "em_risco",
  "pix_gerados",
  "pix_pagos",
  "pix_expirados",
  "cancelados",
  "cancelando", // subs com cancel_at populado (ativas mas anunciaram cancelamento)
  "reembolsos",
  "compras",
  "fila_msgs",
]);
// Adiciona gateway no /details
dashboardRoutes.get("/details", async (c) => {
  const kind = c.req.query("kind");
  if (!kind || !ALLOWED_KINDS.has(kind)) {
    return c.json({ error: "kind inválido" }, 400);
  }
  const produtoId = parseProdutoId(c);
  const since = parseSince(c);
  const until = parseUntil(c);
  const gateway = parseGateway(c);
  const data = await getDetails(kind as DetailsKind, produtoId, since, until, gateway);
  return c.json(data);
});

/* ==========================================================================
 * GET /api/dashboard/cac?produtoId=N&since=ISO&until=ISO
 * CAC blended: combina Meta ad spend com novos clientes Lead Tracker.
 * ========================================================================== */
dashboardRoutes.get("/cac", async (c) => {
  const produtoId = parseProdutoId(c);
  const since = parseSince(c);
  const untilParam = c.req.query("until");
  const until = untilParam ? new Date(untilParam) : new Date();
  const safeUntil = Number.isNaN(until.getTime()) ? new Date() : until;
  try {
    const data = await getCacMetrics(produtoId, since, safeUntil);
    return c.json(data);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Erro CAC" },
      500,
    );
  }
});

/* ==========================================================================
 * GET /api/dashboard/mrr-movements?produtoId=N&since=ISO&until=ISO
 * Breakdown da movimentação de MRR no período: New, Expansion, Churn, etc.
 * ========================================================================== */
dashboardRoutes.get("/mrr-movements", async (c) => {
  const produtoId = parseProdutoId(c);
  const since = parseSince(c);
  const until = parseUntil(c);
  const gateway = parseGateway(c);
  const data = await getMrrBreakdown(produtoId, since, until, gateway);
  return c.json(data);
});

/* ==========================================================================
 * GET /api/dashboard/mrr-movements/leads?type=X&produtoId=N&since=ISO&until=ISO
 * Drill-down: lista leads de um tipo específico de movement no período.
 * ========================================================================== */
const MRR_TYPES = new Set([
  "new",
  "expansion",
  "reactivation",
  "contraction",
  "churn",
  "refund",
]);
dashboardRoutes.get("/mrr-movements/leads", async (c) => {
  const type = c.req.query("type");
  if (!type || !MRR_TYPES.has(type)) {
    return c.json({ error: "type inválido" }, 400);
  }
  const produtoId = parseProdutoId(c);
  const since = parseSince(c);
  const until = parseUntil(c);
  const gateway = parseGateway(c);
  const data = await getMrrMovementLeads(type, produtoId, since, until, gateway);
  return c.json(data);
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
  const until = parseUntil(c);
  const gateway = parseGateway(c);
  const [metodos, funilPix, retencao] = await Promise.all([
    getMetodoBreakdown(produtoId, since, until, gateway),
    getFunilPix(produtoId, since, until, gateway),
    getRetencaoPorMetodo(produtoId, gateway),
  ]);
  return c.json({ metodos, funilPix, retencao });
});

/* GET /api/dashboard/vendas-por-plano
 * Vendas por plano no período (eventos compra_aprovada/renovada agrupado). */
dashboardRoutes.get("/vendas-por-plano", async (c) => {
  const produtoId = parseProdutoId(c);
  const since = parseSince(c);
  const until = parseUntil(c);
  const gateway = parseGateway(c);
  const data = await getVendasPorPlano(produtoId, since, until, gateway);
  return c.json(data);
});

