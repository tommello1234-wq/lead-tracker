import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { authRoutes } from "./routes/auth.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { cronRoutes } from "./routes/cron.js";
import { auditRoutes } from "./routes/audit.js";
import { produtosRoutes } from "./routes/produtos.js";
import { leadsRoutes } from "./routes/leads.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { automacoesRoutes } from "./routes/automacoes.js";
import { activityRoutes } from "./routes/activity.js";
import { metaAdsRoutes } from "./routes/meta-ads.js";
import { personasRoutes } from "./routes/personas.js";
import { angulosRoutes } from "./routes/angulos.js";
import { quizRoutes } from "./routes/quiz.js";
import { requireAuth } from "./middleware/auth.js";

/**
 * Hono app principal — montado em /api/*.
 * Webhooks (Ticto, Stripe) e cron NÃO usam requireAuth — são autenticados via secret/token próprio.
 * Todas as outras rotas REST exigem cookie de sessão válido.
 */
export const app = new Hono().basePath("/api");

app.use("*", logger());
app.use("*", cors({ origin: "*", credentials: true }));

// Health check
app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

// Públicas (auth próprio)
app.route("/auth", authRoutes);
app.route("/webhooks", webhookRoutes);
app.route("/cron", cronRoutes);
app.route("/audit", auditRoutes);

// Quiz: start/answer/complete publicas (LP no gravyx.com.br), funnel/sessions protegidas
app.use("/quiz/funnel", requireAuth);
app.use("/quiz/sessions", requireAuth);
app.use("/quiz/sessions/*", requireAuth); // /sessions/:id/answers
app.route("/quiz", quizRoutes);

// Protegidas (cookie de sessão)
app.use("/produtos/*", requireAuth);
app.use("/leads/*", requireAuth);
app.use("/dashboard/*", requireAuth);
app.use("/automacoes/*", requireAuth);
app.use("/activity/*", requireAuth);
app.use("/meta-ads/*", requireAuth);
app.use("/personas/*", requireAuth);
app.use("/angulos/*", requireAuth);

app.route("/produtos", produtosRoutes);
app.route("/leads", leadsRoutes);
app.route("/dashboard", dashboardRoutes);
app.route("/automacoes", automacoesRoutes);
app.route("/activity", activityRoutes);
app.route("/meta-ads", metaAdsRoutes);
app.route("/personas", personasRoutes);
app.route("/angulos", angulosRoutes);

// 404 padrão JSON
app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error("[hono error]", err);
  return c.json({ error: err.message ?? "Erro interno" }, 500);
});
