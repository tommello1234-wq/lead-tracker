import { Hono } from "hono";
import { db } from "../../db/client";
import { eventos } from "../../db/schema";
import { parseTictoWebhook, verifyTictoSignature } from "../lib/ticto";
import { parseStripeWebhook, verifyStripeSignature } from "../lib/stripe";
import { handleGatewayEvent } from "../lib/flows";
import { findOrCreateProdutoByName } from "../lib/produtos";

export const webhookRoutes = new Hono();

/* ==========================================================================
 * GET /api/webhooks/health
 * ========================================================================== */
webhookRoutes.get("/", (c) =>
  c.json({
    ok: true,
    endpoints: ["POST /api/webhooks/ticto", "POST /api/webhooks/stripe"],
  }),
);

/* ==========================================================================
 * POST /api/webhooks/ticto
 * ========================================================================== */
webhookRoutes.post("/ticto", async (c) => {
  const rawBody = await c.req.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await db.insert(eventos).values({
      source: "ticto",
      eventType: "invalid_json",
      payload: { rawBody },
      processedOk: false,
      erro: "JSON invalido",
    });
    return c.json({ error: "invalid json" }, 400);
  }

  const sig = verifyTictoSignature(payload);
  if (!sig.valid) {
    await db.insert(eventos).values({
      source: "ticto",
      eventType: "signature_invalid",
      payload: { rawBody, reason: sig.reason },
      processedOk: false,
      erro: sig.reason,
    });
    return c.json({ error: "invalid signature" }, 401);
  }

  const event = parseTictoWebhook(payload);
  if (!event) {
    await db.insert(eventos).values({
      source: "ticto",
      eventType: "unknown",
      payload,
      processedOk: false,
      erro: "Tipo de evento nao reconhecido",
    });
    return c.json({ ok: false, reason: "unknown-event" });
  }

  if (event.planoNome) {
    const produto = await findOrCreateProdutoByName(event.planoNome);
    if (produto) event.produtoId = produto.id;
  }

  try {
    const result = await handleGatewayEvent(event);
    return c.json({ ok: true, ...result });
  } catch (e) {
    const erro = e instanceof Error ? e.message : "Erro desconhecido";
    await db.insert(eventos).values({
      source: "ticto",
      eventType: event.eventType,
      payload,
      processedOk: false,
      erro,
    });
    return c.json({ ok: false, error: erro }, 500);
  }
});

/* ==========================================================================
 * POST /api/webhooks/stripe
 * Stripe assina o body cru — temos que validar ANTES de parsear.
 * ========================================================================== */
webhookRoutes.post("/stripe", async (c) => {
  const rawBody = await c.req.text();

  // hono Request → Headers nativos
  const sig = verifyStripeSignature(rawBody, c.req.raw.headers);
  if (!sig.valid) {
    await db.insert(eventos).values({
      source: "stripe",
      eventType: "signature_invalid",
      payload: { rawBody: rawBody.substring(0, 500), reason: sig.reason },
      processedOk: false,
      erro: sig.reason,
    });
    return c.json({ error: "invalid signature" }, 401);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    await db.insert(eventos).values({
      source: "stripe",
      eventType: "invalid_json",
      payload: { rawBody: rawBody.substring(0, 500) },
      processedOk: false,
      erro: "JSON invalido",
    });
    return c.json({ error: "invalid json" }, 400);
  }

  const eventInput = parseStripeWebhook(event);
  if (!eventInput) {
    const stripeType = String((event as { type?: string }).type ?? "unknown");
    await db.insert(eventos).values({
      source: "stripe",
      eventType: stripeType,
      payload: event,
      processedOk: false,
      erro: "Tipo de evento nao mapeado",
    });
    return c.json({ ok: false, reason: "unmapped-event", stripeType });
  }

  if (eventInput.planoNome) {
    const produto = await findOrCreateProdutoByName(eventInput.planoNome);
    if (produto) eventInput.produtoId = produto.id;
  }

  try {
    const result = await handleGatewayEvent(eventInput);
    return c.json({ ok: true, ...result });
  } catch (e) {
    const erro = e instanceof Error ? e.message : "Erro desconhecido";
    await db.insert(eventos).values({
      source: "stripe",
      eventType: eventInput.eventType,
      payload: event,
      processedOk: false,
      erro,
    });
    return c.json({ ok: false, error: erro }, 500);
  }
});
