import { Hono } from "hono";
import { dispatchPending } from "../lib/messages.js";

export const cronRoutes = new Hono();

/**
 * GET /api/cron/dispatch-messages
 * Chamado pelo Vercel Cron ou job externo.
 * Auth: header `Authorization: Bearer <CRON_SECRET>`.
 */
cronRoutes.get("/dispatch-messages", async (c) => {
  const auth = c.req.header("authorization");
  const secret = process.env.CRON_SECRET;

  if (secret && auth !== `Bearer ${secret}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const result = await dispatchPending();
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : "Erro" },
      500,
    );
  }
});
