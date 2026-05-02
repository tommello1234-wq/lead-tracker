import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { authRoutes } from "./routes/auth";
import { webhookRoutes } from "./routes/webhooks";
import { cronRoutes } from "./routes/cron";
import { produtosRoutes } from "./routes/produtos";
import { leadsRoutes } from "./routes/leads";
import { dashboardRoutes } from "./routes/dashboard";
import { automacoesRoutes } from "./routes/automacoes";
import { requireAuth } from "./middleware/auth";

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

// Protegidas (cookie de sessão)
app.use("/produtos/*", requireAuth);
app.use("/leads/*", requireAuth);
app.use("/dashboard/*", requireAuth);
app.use("/automacoes/*", requireAuth);

app.route("/produtos", produtosRoutes);
app.route("/leads", leadsRoutes);
app.route("/dashboard", dashboardRoutes);
app.route("/automacoes", automacoesRoutes);

// 404 padrão JSON
app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error("[hono error]", err);
  return c.json({ error: err.message ?? "Erro interno" }, 500);
});
