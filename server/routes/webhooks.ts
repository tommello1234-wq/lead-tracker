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



/* POST /api/webhooks/asaas/run-import-v2?confirm=YES — import completo de
 * todos customers com histórico de pagamento (não só sub ativa).
 *
 * Aplica regra "última assinatura vale": pra cada customer, pega a
 * subscription mais recente (qualquer status). Define subscription_status:
 *   - sub ACTIVE + payment recente (35d): ativa
 *   - sub ACTIVE + OVERDUE: atrasada
 *   - sub não-ACTIVE: cancelada
 *   - sem sub mas tem pagamento: cancelada (registro histórico)
 */
webhookRoutes.post("/asaas/run-import-v2", async (c) => {
  if (c.req.query("confirm") !== "YES") return c.json({ ok: false, error: "?confirm=YES" }, 400);
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ ok: false, error: "ASAAS_API_KEY ausente" }, 500);

  const { db } = await import("../../db/client.js");
  const { leads, mrrMovements } = await import("../../db/schema.js");
  const { eq } = await import("drizzle-orm");

  type Cust = { id: string; name?: string; email?: string; phone?: string; mobilePhone?: string; cpfCnpj?: string };
  type Sub = { id: string; status: string; value: number; cycle: string; description?: string; dateCreated?: string };
  type Payment = { id: string; status: string; value: number; subscription?: string; description?: string; dueDate: string; confirmedDate?: string; paymentDate?: string; dateCreated?: string };

  function normalizePhone(raw?: string): string | null {
    if (!raw) return null;
    const d = raw.replace(/\D/g, "");
    if (!d) return null;
    if (d.length === 10 || d.length === 11) return `55${d}`;
    return d;
  }
  function normEmail(raw?: string): string | null {
    if (!raw) return null;
    const t = raw.trim().toLowerCase();
    if (!t.includes("@") || !t.includes(".")) return null;
    return t;
  }
  function mapPlano(desc?: string): string {
    if (!desc) return "Gravyx";
    if (/custom/i.test(desc)) return "Gravyx Creator";
    if (/starter/i.test(desc)) return "Gravyx Starter";
    if (/premium/i.test(desc)) return "Gravyx Premium";
    if (/enterprise/i.test(desc)) return "Gravyx Enterprise";
    return desc;
  }

  // 1) Lista todos customers
  const customers: Cust[] = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${url}/customers?limit=100&offset=${offset}`, { headers: { access_token: key } });
    const b = (await r.json()) as { data: Cust[]; hasMore: boolean };
    customers.push(...b.data);
    if (!b.hasMore) break;
    offset += 100;
    if (offset > 5000) break;
  }

  const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
  let created = 0, updated = 0, skipped = 0;
  let mrrAdded = 0;
  const errors: string[] = [];

  for (const cust of customers) {
    try {
      // Pega payments (todos) e subscriptions (todos status)
      const [pRes, sActiveRes] = await Promise.all([
        fetch(`${url}/payments?customer=${cust.id}&limit=20`, { headers: { access_token: key } }),
        // Não tem como pegar todas subs com 1 req — tenta ACTIVE primeiro
        fetch(`${url}/subscriptions?customer=${cust.id}&limit=20`, { headers: { access_token: key } }),
      ]);
      const pays = ((await pRes.json()) as { data: Payment[] }).data ?? [];
      const subsActive = ((await sActiveRes.json()) as { data: Sub[] }).data ?? [];

      // Pega subscriptions associadas em pagamentos (mesmo se INACTIVE)
      const subIdsFromPayments = new Set<string>();
      for (const p of pays) if (p.subscription) subIdsFromPayments.add(p.subscription);
      const allSubs: Sub[] = [...subsActive];
      for (const subId of subIdsFromPayments) {
        if (allSubs.some((s) => s.id === subId)) continue;
        try {
          const r = await fetch(`${url}/subscriptions/${subId}`, { headers: { access_token: key } });
          if (r.ok) allSubs.push((await r.json()) as Sub);
        } catch {/* skip */}
      }

      // Sem nenhuma sub e sem pagamento confirmado: skip
      const hasPaid = pays.some((p) => /^(CONFIRMED|RECEIVED|RECEIVED_IN_CASH|REFUNDED)$/i.test(p.status ?? ""));
      if (allSubs.length === 0 && !hasPaid) { skipped++; continue; }

      // Pega ÚLTIMA sub por dateCreated (regra: última assinatura vale)
      const lastSub = allSubs.sort((a, b) => (b.dateCreated ?? "").localeCompare(a.dateCreated ?? ""))[0];

      // Determina sub_status
      let subStatus: "ativa" | "atrasada" | "cancelada" | "reembolsada";
      let leadStatus: "cliente_ativo" | "cliente_em_risco" | "cliente_cancelado";
      if (!lastSub) {
        // Só pagamento avulso, sem sub: marca como cancelado
        subStatus = pays.every((p) => /^REFUNDED$/i.test(p.status ?? "")) ? "reembolsada" : "cancelada";
        leadStatus = subStatus === "reembolsada" ? "cliente_em_risco" : "cliente_cancelado";
      } else if (/^ACTIVE$/i.test(lastSub.status)) {
        const recentPaid = pays.some((p) => {
          const st = (p.status ?? "").toUpperCase();
          if (st !== "CONFIRMED" && st !== "RECEIVED" && st !== "RECEIVED_IN_CASH") return false;
          const d = new Date(p.confirmedDate ?? p.paymentDate ?? p.dueDate);
          return d.getTime() > cutoff;
        });
        subStatus = recentPaid ? "ativa" : "atrasada";
        leadStatus = recentPaid ? "cliente_ativo" : "cliente_em_risco";
      } else {
        subStatus = "cancelada";
        leadStatus = "cliente_cancelado";
      }

      const valor = lastSub?.value ?? pays[0]?.value ?? 0;
      const planoNome = mapPlano(lastSub?.description ?? pays[0]?.description);
      const phone = normalizePhone(cust.mobilePhone ?? cust.phone);
      const email = normEmail(cust.email);
      const cpf = cust.cpfCnpj ?? null;
      const nome = cust.name?.trim() || "Cliente Asaas";

      // Datas
      const firstPayment = pays
        .filter((p) => /^(CONFIRMED|RECEIVED|RECEIVED_IN_CASH)$/i.test(p.status ?? ""))
        .sort((a, b) => (a.confirmedDate ?? a.dateCreated ?? "").localeCompare(b.confirmedDate ?? b.dateCreated ?? ""))[0];
      const pagouEm = firstPayment
        ? new Date(firstPayment.confirmedDate ?? firstPayment.paymentDate ?? firstPayment.dateCreated ?? "")
        : lastSub?.dateCreated
          ? new Date(lastSub.dateCreated)
          : null;

      // Match com lead existente
      let existing = phone
        ? await db.query.leads.findFirst({ where: eq(leads.contato, phone) })
        : undefined;
      if (!existing && email) existing = await db.query.leads.findFirst({ where: eq(leads.email, email) });
      if (!existing && cpf) existing = await db.query.leads.findFirst({ where: eq(leads.gatewayCustomerId, cpf) });

      const now = new Date();
      if (existing) {
        const valorAntigo = existing.valorAssinatura ?? 0;
        await db.update(leads).set({
          gateway: "asaas",
          gatewayCustomerId: cpf ?? existing.gatewayCustomerId,
          gatewayLastOrderId: lastSub?.id ?? existing.gatewayLastOrderId,
          valorAssinatura: valor,
          planoNome,
          periodicidade: "mensal",
          status: leadStatus,
          subscriptionStatus: subStatus,
          produtoId: 1,
          email: existing.email || email,
          contato: existing.contato || phone,
          atualizadoEm: now,
        }).where(eq(leads.id, existing.id));
        if (subStatus === "ativa" && valor > valorAntigo) {
          await db.insert(mrrMovements).values({
            leadId: existing.id, produtoId: 1, type: "expansion",
            amount: valor - valorAntigo, fromValue: valorAntigo, toValue: valor,
            fromPlano: existing.planoNome, toPlano: planoNome, ocorridoEm: now,
          });
          mrrAdded += valor - valorAntigo;
        }
        updated++;
      } else {
        const [novo] = await db.insert(leads).values({
          nome, contato: phone, email,
          tipo: "compra_aprovada",
          status: leadStatus,
          subscriptionStatus: subStatus,
          gateway: "asaas",
          gatewayCustomerId: cpf,
          gatewayLastOrderId: lastSub?.id ?? null,
          valorAssinatura: valor,
          planoNome,
          periodicidade: "mensal",
          produtoId: 1,
          pagouEm,
          criadoEm: pagouEm ?? now,
          atualizadoEm: now,
        }).returning();
        if (subStatus === "ativa") {
          await db.insert(mrrMovements).values({
            leadId: novo.id, produtoId: 1, type: "new",
            amount: valor, fromValue: null, toValue: valor,
            fromPlano: null, toPlano: planoNome,
            ocorridoEm: pagouEm ?? now,
          });
          mrrAdded += valor;
        }
        created++;
      }
    } catch (e) {
      errors.push(`cust ${cust.id}: ${e instanceof Error ? e.message : "err"}`);
      skipped++;
    }
  }

  return c.json({ ok: true, totalCustomers: customers.length, created, updated, skipped, mrrAdded, errors: errors.slice(0, 10) });
});

/* GET /api/webhooks/asaas/customers-summary — pega TODOS customers
 * com pagamento, classifica pelo último pagamento + subscription. */
webhookRoutes.get("/asaas/customers-summary", async (c) => {
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ ok: false, error: "ASAAS_API_KEY ausente" }, 500);

  type Cust = { id: string; name?: string; email?: string };
  // Lista todos customers
  const customers: Cust[] = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${url}/customers?limit=100&offset=${offset}`, { headers: { access_token: key } });
    const b = (await r.json()) as { data: Cust[]; hasMore: boolean };
    customers.push(...b.data);
    if (!b.hasMore) break;
    offset += 100;
    if (offset > 5000) break;
  }

  // Pra cada customer, conta payments por status
  const stats = { totalCustomers: customers.length, comPagamentoConfirmed: 0, soReembolso: 0, semPagamento: 0, comSubAtiva: 0 };
  let processed = 0;
  for (const cust of customers) {
    const pRes = await fetch(`${url}/payments?customer=${cust.id}&limit=10`, { headers: { access_token: key } });
    const pBody = (await pRes.json()) as { data: Array<{ status: string }> };
    const statuses = (pBody.data ?? []).map((p) => (p.status ?? "").toUpperCase());
    if (statuses.length === 0) stats.semPagamento++;
    else if (statuses.includes("CONFIRMED") || statuses.includes("RECEIVED")) stats.comPagamentoConfirmed++;
    else if (statuses.every((s) => s === "REFUNDED")) stats.soReembolso++;

    const sRes = await fetch(`${url}/subscriptions?customer=${cust.id}&status=ACTIVE&limit=1`, { headers: { access_token: key } });
    const sBody = (await sRes.json()) as { data: unknown[] };
    if (sBody.data?.length > 0) stats.comSubAtiva++;
    processed++;
  }
  return c.json({ ok: true, ...stats, processed });
});

/* GET /api/webhooks/asaas/all-subs-summary — quantos customers tem com subs
 * de cada status (ACTIVE, INACTIVE, CANCELED, EXPIRED). Dry-run admin. */
webhookRoutes.get("/asaas/all-subs-summary", async (c) => {
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ ok: false, error: "ASAAS_API_KEY ausente" }, 500);

  type Sub = { id: string; status: string; value: number; cycle: string; description?: string; customer: string; dateCreated?: string };
  const subs: Sub[] = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${url}/subscriptions?limit=100&offset=${offset}`, { headers: { access_token: key } });
    const b = (await r.json()) as { data: Sub[]; hasMore: boolean };
    subs.push(...b.data);
    if (!b.hasMore) break;
    offset += 100;
    if (offset > 5000) break;
  }

  // Agrupa por customer, pega a última subscription por dateCreated
  const byCustomer = new Map<string, Sub[]>();
  for (const s of subs) {
    const arr = byCustomer.get(s.customer) ?? [];
    arr.push(s);
    byCustomer.set(s.customer, arr);
  }
  // Pra cada customer, ordena subs por dateCreated DESC, pega a primeira
  const lastByCustomer = new Map<string, Sub>();
  for (const [cust, arr] of byCustomer) {
    arr.sort((a, b) => (b.dateCreated ?? "").localeCompare(a.dateCreated ?? ""));
    lastByCustomer.set(cust, arr[0]);
  }

  // Conta por status da última sub
  const byStatus: Record<string, number> = {};
  for (const sub of lastByCustomer.values()) {
    byStatus[sub.status] = (byStatus[sub.status] ?? 0) + 1;
  }

  return c.json({
    ok: true,
    totalSubs: subs.length,
    customersUnicos: byCustomer.size,
    porStatusUltimaSub: byStatus,
  });
});

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
