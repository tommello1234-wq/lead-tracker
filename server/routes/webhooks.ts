import { Hono } from "hono";
import { db } from "../../db/client.js";
import { eventos } from "../../db/schema.js";
import { parseTictoWebhook, verifyTictoSignature } from "../lib/ticto.js";
import { parseStripeWebhook, verifyStripeSignature } from "../lib/stripe.js";
import { parseBrevexWebhook, verifyBrevexSignature } from "../lib/brevex.js";
import { parseAsaasWebhook, verifyAsaasSignature } from "../lib/asaas.js";
import { handleGatewayEvent } from "../lib/flows.js";
import { findOrCreateProdutoByName } from "../lib/produtos.js";
import { handleEvolutionIncoming } from "../lib/evolution-incoming.js";

export const webhookRoutes = new Hono();

/* ==========================================================================
 * GET /api/webhooks/health
 * ========================================================================== */
webhookRoutes.get("/", (c) =>
  c.json({
    ok: true,
    endpoints: [
      "POST /api/webhooks/ticto",
      "POST /api/webhooks/stripe",
      "POST /api/webhooks/brevex (capture-only stub)",
      "POST /api/webhooks/asaas",
      "POST /api/webhooks/evolution (mensagens recebidas WhatsApp)",
    ],
  }),
);



/* GET /api/webhooks/asaas/find-customer?email=X — admin temp */
webhookRoutes.get("/asaas/find-customer", async (c) => {
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ ok: false, error: "ASAAS_API_KEY ausente" }, 500);
  const email = c.req.query("email");
  if (!email) return c.json({ ok: false, error: "email obrigatório" }, 400);

  const r = await fetch(`${url}/customers?email=${encodeURIComponent(email)}`, {
    headers: { access_token: key, Accept: "application/json" },
  });
  const customers = (await r.json()) as { data: Array<Record<string, unknown>> };
  if (!customers.data?.length) return c.json({ ok: false, error: "Customer não encontrado", searched: email });

  const cust = customers.data[0];
  const subsRes = await fetch(`${url}/subscriptions?customer=${cust.id}&limit=50`, { headers: { access_token: key } });
  const subs = (await subsRes.json()) as { data: Array<unknown> };
  const paysRes = await fetch(`${url}/payments?customer=${cust.id}&limit=30`, { headers: { access_token: key } });
  const pays = (await paysRes.json()) as { data: Array<unknown> };

  return c.json({ ok: true, customer: cust, subscriptions: subs.data, payments: pays.data });
});

/* ==========================================================================
 * POST /api/webhooks/asaas
 * Eventos do Asaas (PAYMENT_*, SUBSCRIPTION_*).
 * Auth: header `asaas-access-token` casa com ASAAS_WEBHOOK_TOKEN (opcional).
 * ========================================================================== */
webhookRoutes.post("/asaas", async (c) => {
  const rawBody = await c.req.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await db.insert(eventos).values({
      source: "asaas",
      eventType: "invalid_json",
      payload: { rawBody },
      processedOk: false,
      erro: "JSON invalido",
    });
    return c.json({ error: "invalid json" }, 400);
  }

  const sig = verifyAsaasSignature(c.req.raw.headers);
  if (!sig.valid) {
    await db.insert(eventos).values({
      source: "asaas",
      eventType: "signature_invalid",
      payload: { rawBody, reason: sig.reason },
      processedOk: false,
      erro: sig.reason,
    });
    return c.json({ error: "invalid signature" }, 401);
  }

  const event = await parseAsaasWebhook(payload);
  if (!event) {
    const asaasEvent = String(payload.event ?? "unknown");
    await db.insert(eventos).values({
      source: "asaas",
      eventType: asaasEvent,
      payload,
      processedOk: false,
      erro: "Evento Asaas nao mapeado",
    });
    return c.json({ ok: false, reason: "unmapped-event", asaasEvent });
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
      source: "asaas",
      eventType: event.eventType,
      payload,
      processedOk: false,
      erro,
    });
    return c.json({ ok: false, error: erro }, 500);
  }
});

/* ==========================================================================
 * POST /api/webhooks/evolution
 * Mensagens recebidas do WhatsApp via Evolution API.
 * Quando o cliente responde, marca lead.respondeuEm e cancela mensagens
 * pendentes (skipped) pra que o follow-up automático não chegue.
 *
 * Auth: header `apikey` deve casar com EVOLUTION_WEBHOOK_SECRET (se setado).
 * Sem secret = aceita tudo (modo dev).
 * ========================================================================== */
webhookRoutes.post("/evolution", async (c) => {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (secret) {
    const received = c.req.header("apikey") ?? c.req.header("Apikey");
    if (received !== secret) {
      return c.json({ error: "invalid apikey" }, 401);
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  try {
    const result = await handleEvolutionIncoming(payload);
    return c.json(result);
  } catch (e) {
    const erro = e instanceof Error ? e.message : "Erro desconhecido";
    await db.insert(eventos).values({
      source: "evolution",
      eventType: "incoming_error",
      payload,
      processedOk: false,
      erro,
    });
    return c.json({ ok: false, error: erro }, 500);
  }
});

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

/* ==========================================================================
 * POST /api/webhooks/brevex
 * STUB capture-only — salva payload bruto pra construir parser depois.
 * ========================================================================== */
webhookRoutes.post("/brevex", async (c) => {
  const rawBody = await c.req.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await db.insert(eventos).values({
      source: "brevex",
      eventType: "invalid_json",
      payload: { rawBody },
      processedOk: false,
      erro: "JSON inválido",
    });
    return c.json({ error: "invalid json" }, 400);
  }

  const sig = verifyBrevexSignature(payload, c.req.raw.headers);
  if (!sig.valid) {
    await db.insert(eventos).values({
      source: "brevex",
      eventType: "signature_invalid",
      payload: { rawBody, reason: sig.reason },
      processedOk: false,
      erro: sig.reason,
    });
    return c.json({ error: "invalid signature" }, 401);
  }

  const event = parseBrevexWebhook(payload);

  if (!event) {
    const inferredType = String(
      (payload as { event?: string; type?: string; status?: string }).event ??
        (payload as { type?: string }).type ??
        (payload as { status?: string }).status ??
        "captured-unknown",
    );
    await db.insert(eventos).values({
      source: "brevex",
      eventType: inferredType,
      payload,
      processedOk: false,
      erro: "Parser Brevex ainda não implementado — payload capturado pra inspeção",
    });
    return c.json({
      ok: true,
      captured: true,
      reason: "parser-stub",
      message:
        "Payload salvo na tabela eventos. Parser será construído com base nesse exemplo.",
    });
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
      source: "brevex",
      eventType: event.eventType,
      payload,
      processedOk: false,
      erro,
    });
    return c.json({ ok: false, error: erro }, 500);
  }
});
