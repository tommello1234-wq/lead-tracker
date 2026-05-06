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


/* POST /api/webhooks/asaas/run-import?confirm=YES — importa todas
 * subscriptions ativas Asaas. Cria leads novos OU atualiza existentes
 * (match por telefone/email/cpfCnpj). Marca sub_status como 'ativa'
 * se houve pagamento nos últimos 35d, senão 'atrasada'.
 *
 * UM SHOT — depois remove o endpoint. */
webhookRoutes.post("/asaas/run-import", async (c) => {
  if (c.req.query("confirm") !== "YES") {
    return c.json({ ok: false, error: "Adicione ?confirm=YES" }, 400);
  }
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ ok: false, error: "ASAAS_API_KEY ausente" }, 500);

  const { db } = await import("../../db/client.js");
  const { leads, mrrMovements } = await import("../../db/schema.js");
  const { eq } = await import("drizzle-orm");
  const { findOrCreateProdutoByName } = await import("../lib/produtos.js");

  type Sub = { id: string; value: number; cycle: string; description?: string; customer: string; dateCreated?: string };
  type Customer = { id: string; name?: string; email?: string; phone?: string; mobilePhone?: string; cpfCnpj?: string };
  type Payment = { status: string; confirmedDate?: string; paymentDate?: string; dueDate: string };

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

  // 1) Lista subs ativas
  const subs: Sub[] = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${url}/subscriptions?status=ACTIVE&limit=100&offset=${offset}`, { headers: { access_token: key } });
    const b = (await r.json()) as { data: Sub[]; hasMore: boolean };
    subs.push(...b.data);
    if (!b.hasMore) break;
    offset += 100;
    if (offset > 2000) break;
  }

  const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
  const produtoGravyx = await findOrCreateProdutoByName("Gravyx");
  const produtoId = produtoGravyx?.id ?? 1;

  let created = 0, updated = 0, skipped = 0;
  let mrrAdded = 0;
  const errors: string[] = [];

  await db.transaction(async (tx) => {
    for (const s of subs) {
      try {
        // Busca customer
        const cRes = await fetch(`${url}/customers/${s.customer}`, { headers: { access_token: key } });
        const customer = (await cRes.json()) as Customer;
        const phone = normalizePhone(customer.mobilePhone ?? customer.phone);
        const email = normEmail(customer.email);
        const cpf = customer.cpfCnpj ?? null;
        const nome = customer.name?.trim() || "Cliente Asaas";

        // Determina sub_status: ativa se pagou recentemente, atrasada senão
        const pRes = await fetch(`${url}/payments?subscription=${s.id}&limit=10`, { headers: { access_token: key } });
        const pBody = (await pRes.json()) as { data: Payment[] };
        const recentPaid = (pBody.data ?? []).some((p) => {
          const st = (p.status ?? "").toUpperCase();
          if (st !== "CONFIRMED" && st !== "RECEIVED" && st !== "RECEIVED_IN_CASH") return false;
          const d = new Date(p.confirmedDate ?? p.paymentDate ?? p.dueDate);
          return d.getTime() > cutoff;
        });
        const subStatus = recentPaid ? "ativa" : "atrasada";
        const leadStatus = recentPaid ? "cliente_ativo" : "cliente_em_risco";

        // Match com lead existente (telefone primeiro, depois email, depois CPF)
        let existing = phone
          ? await tx.query.leads.findFirst({ where: eq(leads.contato, phone) })
          : undefined;
        if (!existing && email) {
          existing = await tx.query.leads.findFirst({ where: eq(leads.email, email) });
        }
        if (!existing && cpf) {
          existing = await tx.query.leads.findFirst({ where: eq(leads.gatewayCustomerId, cpf) });
        }

        const planoNome = mapPlano(s.description);
        const now = new Date();

        if (existing) {
          // Atualiza lead — preserva pagouEm original (CAC histórico)
          const valorAntigo = existing.valorAssinatura ?? 0;
          await tx
            .update(leads)
            .set({
              gateway: "asaas",
              gatewayCustomerId: cpf ?? existing.gatewayCustomerId,
              gatewayLastOrderId: s.id,
              valorAssinatura: s.value,
              planoNome,
              periodicidade: "mensal",
              status: leadStatus as "cliente_ativo" | "cliente_em_risco",
              subscriptionStatus: subStatus as "ativa" | "atrasada",
              produtoId,
              email: existing.email || email,
              contato: existing.contato || phone,
              atualizadoEm: now,
            })
            .where(eq(leads.id, existing.id));

          // Movement se valor mudou
          if (subStatus === "ativa") {
            const delta = s.value - valorAntigo;
            if (delta > 0) {
              await tx.insert(mrrMovements).values({
                leadId: existing.id,
                produtoId,
                type: "expansion",
                amount: delta,
                fromValue: valorAntigo,
                toValue: s.value,
                fromPlano: existing.planoNome,
                toPlano: planoNome,
                ocorridoEm: now,
              });
              mrrAdded += delta;
            } else if (delta < 0) {
              await tx.insert(mrrMovements).values({
                leadId: existing.id,
                produtoId,
                type: "contraction",
                amount: delta,
                fromValue: valorAntigo,
                toValue: s.value,
                fromPlano: existing.planoNome,
                toPlano: planoNome,
                ocorridoEm: now,
              });
              mrrAdded += delta;
            }
          }
          updated++;
        } else {
          // Cria lead novo
          const dateCreated = s.dateCreated ? new Date(s.dateCreated) : now;
          const [novo] = await tx
            .insert(leads)
            .values({
              nome,
              contato: phone,
              email,
              tipo: "compra_aprovada",
              status: leadStatus as "cliente_ativo" | "cliente_em_risco",
              subscriptionStatus: subStatus as "ativa" | "atrasada",
              gateway: "asaas",
              gatewayCustomerId: cpf,
              gatewayLastOrderId: s.id,
              valorAssinatura: s.value,
              planoNome,
              periodicidade: "mensal",
              produtoId,
              pagouEm: dateCreated,
              criadoEm: dateCreated,
              atualizadoEm: now,
            })
            .returning();

          // Movement 'new' só se a sub está ativa (pagou recentemente)
          if (subStatus === "ativa") {
            await tx.insert(mrrMovements).values({
              leadId: novo.id,
              produtoId,
              type: "new",
              amount: s.value,
              fromValue: null,
              toValue: s.value,
              fromPlano: null,
              toPlano: planoNome,
              ocorridoEm: dateCreated,
            });
            mrrAdded += s.value;
          }
          created++;
        }
      } catch (e) {
        errors.push(`sub ${s.id}: ${e instanceof Error ? e.message : "err"}`);
        skipped++;
      }
    }
  });

  return c.json({
    ok: true,
    total: subs.length,
    created,
    updated,
    skipped,
    mrrAdded,
    errors,
  });
});

/* GET /api/webhooks/asaas/subs-health-v2 — pra cada sub ativa, busca
 * o ÚLTIMO pagamento CONFIRMED/RECEIVED (não o próximo pendente). */
webhookRoutes.get("/asaas/subs-health-v2", async (c) => {
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ ok: false, error: "ASAAS_API_KEY ausente" }, 500);

  type Sub = { id: string; value: number };
  type Payment = { status: string; dueDate: string; confirmedDate?: string; paymentDate?: string; value: number };

  const subs: Sub[] = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${url}/subscriptions?status=ACTIVE&limit=100&offset=${offset}`, { headers: { access_token: key } });
    const b = (await r.json()) as { data: Sub[]; hasMore: boolean };
    subs.push(...b.data);
    if (!b.hasMore) break;
    offset += 100;
    if (offset > 2000) break;
  }

  const cutoff = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 dias atrás
  let pagaramRecente = 0, nuncaPagaram = 0, atrasadas = 0;
  let mrrPagandoEmDia = 0;
  for (const s of subs) {
    // Tenta pegar pagamento CONFIRMED ou RECEIVED — paginar tudo, filtrar
    const r = await fetch(`${url}/payments?subscription=${s.id}&limit=10`, {
      headers: { access_token: key },
    });
    const b = (await r.json()) as { data: Payment[] };
    const recebidos = (b.data ?? []).filter((p) => {
      const st = (p.status ?? "").toUpperCase();
      return st === "CONFIRMED" || st === "RECEIVED" || st === "RECEIVED_IN_CASH";
    });
    const overdue = (b.data ?? []).some((p) => (p.status ?? "").toUpperCase() === "OVERDUE");
    if (recebidos.length === 0) {
      nuncaPagaram++;
      if (overdue) atrasadas++;
    } else {
      // Olha o mais recente
      const lastDate = recebidos
        .map((p) => new Date(p.confirmedDate ?? p.paymentDate ?? p.dueDate))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      if (lastDate && lastDate > cutoff) {
        pagaramRecente++;
        mrrPagandoEmDia += s.value;
      } else if (overdue) {
        atrasadas++;
      } else {
        nuncaPagaram++;
      }
    }
  }

  return c.json({
    ok: true,
    total: subs.length,
    pagaramUlt35d: pagaramRecente,
    atrasadas,
    nuncaPagaramOuMuitoTempo: nuncaPagaram,
    mrrPagandoEmDia,
    mrrTotalActive: subs.reduce((a, s) => a + s.value, 0),
  });
});

/* GET /api/webhooks/asaas/subs-health — pra cada sub ativa, checa se a
 * última fatura foi paga ou se está overdue. */
webhookRoutes.get("/asaas/subs-health", async (c) => {
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ ok: false, error: "ASAAS_API_KEY ausente" }, 500);

  type SubItem = { id: string; value: number; cycle: string; description?: string };
  type Payment = { id: string; status: string; dueDate: string; subscription?: string; value: number };

  // Pega todas subscriptions ativas
  const subs: SubItem[] = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${url}/subscriptions?status=ACTIVE&limit=100&offset=${offset}`, {
      headers: { access_token: key },
    });
    const b = (await r.json()) as { data: SubItem[]; hasMore: boolean };
    subs.push(...b.data);
    if (!b.hasMore) break;
    offset += 100;
    if (offset > 2000) break;
  }

  // Pra cada sub, busca último pagamento
  const buckets = { confirmed: 0, pending: 0, overdue: 0, refunded: 0, other: 0, noPayment: 0 };
  let mrrConfirmed = 0;
  let mrrOverdue = 0;
  for (const s of subs) {
    const r = await fetch(
      `${url}/payments?subscription=${s.id}&limit=1&order=desc`,
      { headers: { access_token: key } },
    );
    const b = (await r.json()) as { data: Payment[] };
    const last = b.data?.[0];
    if (!last) { buckets.noPayment++; continue; }
    const status = (last.status || "").toUpperCase();
    if (status === "CONFIRMED" || status === "RECEIVED") {
      buckets.confirmed++; mrrConfirmed += s.value;
    } else if (status === "OVERDUE") {
      buckets.overdue++; mrrOverdue += s.value;
    } else if (status === "PENDING") buckets.pending++;
    else if (status === "REFUNDED") buckets.refunded++;
    else buckets.other++;
  }

  return c.json({
    ok: true,
    total: subs.length,
    buckets,
    mrr: { confirmed: mrrConfirmed, overdue: mrrOverdue, total: subs.reduce((a, s) => a + s.value, 0) },
  });
});

/* GET /api/webhooks/asaas/dry-run-import — mostra o que aconteceria se
 * importar todas subscriptions ativas Asaas, sem mexer no banco.
 * Faz match por email/contato/cpfCnpj com leads existentes.
 */
webhookRoutes.get("/asaas/dry-run-import", async (c) => {
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ ok: false, error: "ASAAS_API_KEY ausente" }, 500);

  const { db } = await import("../../db/client.js");
  const { leads } = await import("../../db/schema.js");
  const { eq, or } = await import("drizzle-orm");

  type SubItem = {
    id: string; status: string; value: number; cycle: string;
    description?: string; customer: string;
    nextDueDate?: string; dateCreated?: string;
  };
  type CustomerInfo = {
    id: string; name?: string; email?: string;
    phone?: string; mobilePhone?: string; cpfCnpj?: string;
  };

  // 1) Lista todas subscriptions ativas
  const subs: SubItem[] = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${url}/subscriptions?status=ACTIVE&limit=100&offset=${offset}`, {
      headers: { access_token: key, Accept: "application/json" },
    });
    if (!res.ok) return c.json({ ok: false, error: await res.text() }, 500);
    const body = (await res.json()) as { data: SubItem[]; hasMore: boolean };
    subs.push(...body.data);
    if (!body.hasMore || body.data.length === 0) break;
    offset += 100;
    if (offset > 2000) break;
  }

  // 2) Pra cada sub, busca customer e checa match
  const results: Array<{
    subId: string; description?: string; value: number;
    customer: CustomerInfo;
    matchType: "new" | "match-phone" | "match-email" | "match-cpf";
    matchLeadId?: number; matchGateway?: string;
  }> = [];
  function normalizePhone(raw?: string): string | null {
    if (!raw) return null;
    const d = raw.replace(/\D/g, "");
    if (!d) return null;
    if (d.length === 10 || d.length === 11) return `55${d}`;
    return d;
  }

  let cNew = 0, cPhone = 0, cEmail = 0, cCpf = 0;
  let mrrNew = 0, mrrMatch = 0;
  // Por gateway que já tem o cliente
  const existingByGateway: Record<string, number> = {};

  for (const s of subs) {
    const cRes = await fetch(`${url}/customers/${s.customer}`, {
      headers: { access_token: key, Accept: "application/json" },
    });
    const customer = (await cRes.json()) as CustomerInfo;
    const phone = normalizePhone(customer.mobilePhone ?? customer.phone);
    const cpf = customer.cpfCnpj ?? null;

    let matchType: "new" | "match-phone" | "match-email" | "match-cpf" = "new";
    let existing: typeof leads.$inferSelect | undefined;
    if (phone) {
      existing = await db.query.leads.findFirst({ where: eq(leads.contato, phone) });
      if (existing) matchType = "match-phone";
    }
    if (!existing && customer.email) {
      existing = await db.query.leads.findFirst({ where: eq(leads.email, customer.email.toLowerCase()) });
      if (existing) matchType = "match-email";
    }
    if (!existing && cpf) {
      existing = await db.query.leads.findFirst({ where: eq(leads.gatewayCustomerId, cpf) });
      if (existing) matchType = "match-cpf";
    }

    if (matchType === "new") { cNew++; mrrNew += s.value; }
    else if (matchType === "match-phone") cPhone++;
    else if (matchType === "match-email") cEmail++;
    else if (matchType === "match-cpf") cCpf++;

    if (existing) {
      mrrMatch += s.value;
      const gw = existing.gateway ?? "(sem gateway)";
      existingByGateway[gw] = (existingByGateway[gw] ?? 0) + 1;
    }

    results.push({
      subId: s.id,
      description: s.description,
      value: s.value,
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: phone ?? undefined, cpfCnpj: cpf ?? undefined },
      matchType,
      matchLeadId: existing?.id,
      matchGateway: existing?.gateway ?? undefined,
    });
  }

  return c.json({
    ok: true,
    total: subs.length,
    summary: {
      new: cNew, mrrIfNew: mrrNew,
      matchByPhone: cPhone, matchByEmail: cEmail, matchByCpf: cCpf,
      existingByGateway,
      mrrTotalAsaas: subs.reduce((a, s) => a + s.value, 0),
      mrrMatch,
    },
    sample: results.slice(0, 10),
  });
});

/* GET /api/webhooks/asaas/list-subscriptions — admin temporário pra
 * inventário de assinantes ativos por descrição. Remove depois. */
webhookRoutes.get("/asaas/list-subscriptions", async (c) => {
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ ok: false, error: "ASAAS_API_KEY ausente" }, 500);

  type SubItem = {
    id: string; status: string; value: number; cycle: string;
    description?: string; externalReference?: string; customer: string;
    nextDueDate?: string; dateCreated?: string;
  };
  const all: SubItem[] = [];
  let offset = 0;
  const LIMIT = 100;
  while (true) {
    const res = await fetch(
      `${url}/subscriptions?status=ACTIVE&limit=${LIMIT}&offset=${offset}`,
      { headers: { access_token: key, Accept: "application/json" } },
    );
    if (!res.ok) {
      return c.json({ ok: false, status: res.status, error: await res.text() }, 500);
    }
    const body = (await res.json()) as { data: SubItem[]; hasMore: boolean; totalCount: number };
    all.push(...body.data);
    if (!body.hasMore || body.data.length === 0) break;
    offset += LIMIT;
    if (offset > 5000) break; // safety
  }

  // Agrupa por descrição pra ver qual filtro usar pra Gravyx
  const byDesc = new Map<string, { count: number; totalValue: number; cycle: string; sample: SubItem[] }>();
  for (const s of all) {
    const k = s.description?.trim() || "(sem descrição)";
    const cur = byDesc.get(k) ?? { count: 0, totalValue: 0, cycle: s.cycle, sample: [] };
    cur.count++;
    cur.totalValue += s.value;
    if (cur.sample.length < 3) cur.sample.push(s);
    byDesc.set(k, cur);
  }

  const groups = Array.from(byDesc.entries())
    .map(([description, info]) => ({ description, ...info }))
    .sort((a, b) => b.count - a.count);

  return c.json({
    ok: true,
    total: all.length,
    groups,
  });
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
