import { Hono } from "hono";
import { dispatchPending } from "../lib/messages.js";
import { runTictoSync } from "../lib/ticto-sync.js";
import { runStripeSync } from "../lib/stripe-sync.js";
import { runAsaasSync } from "../lib/asaas-sync.js";

export const cronRoutes = new Hono();

function isAuthed(authHeader: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev mode (sem secret configurado)
  return authHeader === `Bearer ${secret}`;
}

/**
 * GET /api/cron/dispatch-messages
 * Chamado pelo Vercel Cron ou job externo.
 * Auth: header `Authorization: Bearer <CRON_SECRET>`.
 */
cronRoutes.get("/dispatch-messages", async (c) => {
  if (!isAuthed(c.req.header("authorization"))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  try {
    const result = await dispatchPending();
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "Erro" }, 500);
  }
});

/**
 * GET /api/cron/ticto-sync
 * Sync diário com Ticto API: orders das últimas 48h + todas subscriptions.
 * Mantém estado de cada lead em sintonia com Ticto.
 * Não dispara mensagens.
 */
cronRoutes.get("/ticto-sync", async (c) => {
  if (!isAuthed(c.req.header("authorization"))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  try {
    const result = await runTictoSync(2);
    console.log("[ticto-sync]", result);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : "Erro" },
      500,
    );
  }
});

/* GET /api/cron/stripe-sync — Sync diário Stripe.
 * Pega todas subscriptions e atualiza estado dos leads. */
cronRoutes.get("/stripe-sync", async (c) => {
  if (!isAuthed(c.req.header("authorization"))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  try {
    const result = await runStripeSync();
    console.log("[stripe-sync]", result);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "Erro" }, 500);
  }
});

/* GET /api/cron/asaas-sync — Sync diário Asaas. */
cronRoutes.get("/asaas-sync", async (c) => {
  if (!isAuthed(c.req.header("authorization"))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  try {
    const result = await runAsaasSync();
    console.log("[asaas-sync]", result);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "Erro" }, 500);
  }
});
