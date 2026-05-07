/**
 * Endpoints de auditoria read-only — comparam fontes externas (Ticto API,
 * Stripe, Asaas) com o estado no banco. Não escrevem nada.
 *
 * Uso: GET /api/audit/ticto?token=<CRON_SECRET>
 */
import { Hono } from "hono";
import { db } from "../../db/client.js";
import { subscriptions, leads, eventos, mrrMovements } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { getSubscriptionsHistory } from "../lib/ticto-api.js";

export const auditRoutes = new Hono();

function isAuthed(c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const fromQuery = c.req.query("token");
  const fromHeader = c.req.header("authorization");
  return fromQuery === secret || fromHeader === `Bearer ${secret}`;
}

/**
 * GET /api/audit/lead-info?email=X
 * Cruza banco × Asaas API × Ticto API pra um único lead. Útil pra debug
 * "porquê a Leticia tá cancelada se ela é assinante?".
 */
auditRoutes.get("/lead-info", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const email = (c.req.query("email") ?? "").toLowerCase().trim();
  if (!email) return c.json({ error: "email required" }, 400);

  // Banco
  const dbLead = await db.query.leads.findFirst({ where: eq(leads.email, email) });
  const dbSubs = dbLead
    ? await db.select().from(subscriptions).where(eq(subscriptions.leadId, dbLead.id))
    : [];

  // Asaas
  const asaasUrl = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const asaasKey = process.env.ASAAS_API_KEY;
  let asaasInfo: unknown = null;
  if (asaasKey) {
    try {
      const r = await fetch(`${asaasUrl}/customers?email=${encodeURIComponent(email)}`, {
        headers: { access_token: asaasKey },
      });
      const body = (await r.json()) as { data?: Array<{ id: string }> };
      const cust = body.data?.[0];
      if (cust) {
        const [s, p] = await Promise.all([
          fetch(`${asaasUrl}/subscriptions?customer=${cust.id}&limit=20`, { headers: { access_token: asaasKey } }).then((x) => x.json()),
          fetch(`${asaasUrl}/payments?customer=${cust.id}&limit=20`, { headers: { access_token: asaasKey } }).then((x) => x.json()),
        ]);
        asaasInfo = {
          customer: cust,
          subscriptions: (s as { data?: unknown[] }).data ?? [],
          payments: (p as { data?: unknown[] }).data ?? [],
        };
      } else {
        asaasInfo = { customer: null };
      }
    } catch (e) {
      asaasInfo = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return c.json({
    db: dbLead ? { lead: dbLead, subs: dbSubs } : null,
    asaas: asaasInfo,
  });
});

/**
 * GET /api/audit/consistency
 * Cruza as 4 fontes (leads / subscriptions / eventos / mrr_movements) e
 * reporta divergências. Read-only. Roda toda semana ou após cada deploy.
 *
 * Categorias verificadas:
 *  1. Lead com subscription_status='ativa' mas SEM sub ativa
 *  2. Lead com sub ativa mas subscription_status != 'ativa'
 *  3. Lead com subscription_status='reembolsada' mas SEM reembolsadoEm
 *  4. Lead com subscription_status='cancelada' mas SEM canceladoEm
 *  5. Eventos 'reembolso' sem mrr_movement do tipo refund correspondente
 *  6. Eventos 'assinatura_cancelada' sem mrr_movement do tipo churn
 *  7. Subs com valor=0 status='ativa' (não somam no MRR)
 *  8. Leads com pagouEm null mas subscription_status='ativa'
 *  9. Eventos webhook duplicados (mesmo lead+event_type+order_hash)
 */
auditRoutes.get("/consistency", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);

  // 1+2 Lead vs sub ativa
  const subStatusMismatch = await db.execute<{
    lead_id: number;
    nome: string;
    lead_status: string;
    n_active_subs: number;
  }>(sql`
    SELECT l.id as lead_id, l.nome,
      l.subscription_status as lead_status,
      COALESCE(SUM(CASE WHEN s.status = 'ativa' THEN 1 ELSE 0 END), 0)::int as n_active_subs
    FROM leads l
    LEFT JOIN subscriptions s ON s.lead_id = l.id
    GROUP BY l.id, l.nome, l.subscription_status
    HAVING (l.subscription_status = 'ativa' AND COALESCE(SUM(CASE WHEN s.status = 'ativa' THEN 1 ELSE 0 END), 0) = 0)
        OR (l.subscription_status != 'ativa' AND COALESCE(SUM(CASE WHEN s.status = 'ativa' THEN 1 ELSE 0 END), 0) > 0)
    ORDER BY l.id
    LIMIT 50
  `);

  // 3 Reembolsada sem reembolsadoEm
  const refundNoDate = await db
    .select({ id: leads.id, nome: leads.nome })
    .from(leads)
    .where(and(eq(leads.subscriptionStatus, "reembolsada"), sql`${leads.reembolsadoEm} IS NULL`))
    .limit(50);

  // 4 Cancelada sem canceladoEm
  const cancelNoDate = await db
    .select({ id: leads.id, nome: leads.nome })
    .from(leads)
    .where(and(eq(leads.subscriptionStatus, "cancelada"), sql`${leads.canceladoEm} IS NULL`))
    .limit(50);

  // 5 Eventos refund sem movement
  const refundsNoMovement = await db.execute<{
    evento_id: number;
    lead_id: number;
    received_at: string;
  }>(sql`
    SELECT e.id as evento_id, e.lead_id, e.received_at
    FROM eventos e
    WHERE e.event_type = 'reembolso' AND e.processed_ok = true
      AND e.lead_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM mrr_movements m
        WHERE m.evento_id = e.id AND m.type = 'refund'
      )
    ORDER BY e.received_at DESC
    LIMIT 50
  `);

  // 6 Eventos cancelamento sem movement churn
  const cancelsNoMovement = await db.execute<{
    evento_id: number;
    lead_id: number;
    received_at: string;
  }>(sql`
    SELECT e.id as evento_id, e.lead_id, e.received_at
    FROM eventos e
    WHERE e.event_type = 'assinatura_cancelada' AND e.processed_ok = true
      AND e.lead_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM mrr_movements m
        WHERE m.evento_id = e.id AND m.type = 'churn'
      )
    ORDER BY e.received_at DESC
    LIMIT 50
  `);

  // 7 Subs ativas sem valor (não somam no MRR — invisível)
  const subsZero = await db
    .select({
      id: subscriptions.id,
      leadId: subscriptions.leadId,
      gateway: subscriptions.gateway,
      planoNome: subscriptions.planoNome,
      valor: subscriptions.valor,
    })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "ativa"), sql`(${subscriptions.valor} IS NULL OR ${subscriptions.valor} = 0)`))
    .limit(50);

  // 8 Lead ativo sem pagouEm
  const activeNoPaid = await db
    .select({ id: leads.id, nome: leads.nome })
    .from(leads)
    .where(and(eq(leads.subscriptionStatus, "ativa"), sql`${leads.pagouEm} IS NULL`))
    .limit(50);

  // 9 Eventos duplicados (mesmo lead+event_type+order_hash)
  const dupes = await db.execute<{
    lead_id: number;
    event_type: string;
    order_hash: string;
    cnt: number;
  }>(sql`
    SELECT lead_id, event_type, payload->'order'->>'hash' as order_hash, COUNT(*)::int as cnt
    FROM eventos
    WHERE processed_ok = true AND erro IS NULL
      AND payload->'order'->>'hash' IS NOT NULL
      AND event_type IN ('assinatura_cancelada', 'reembolso', 'compra_aprovada', 'assinatura_renovada')
    GROUP BY lead_id, event_type, payload->'order'->>'hash'
    HAVING COUNT(*) > 1
    LIMIT 50
  `);

  const issues = {
    subStatusMismatch: (subStatusMismatch as unknown as Array<unknown>).slice(0, 50),
    refundNoDate,
    cancelNoDate,
    refundsNoMovement: (refundsNoMovement as unknown as Array<unknown>).slice(0, 50),
    cancelsNoMovement: (cancelsNoMovement as unknown as Array<unknown>).slice(0, 50),
    subsZero,
    activeNoPaid,
    dupes: (dupes as unknown as Array<unknown>).slice(0, 50),
  };

  const counts = Object.fromEntries(
    Object.entries(issues).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
  );
  const totalIssues = Object.values(counts).reduce((a, b) => a + (b as number), 0);

  return c.json({
    ok: true,
    summary: { totalIssues, ...counts },
    issues,
  });
});

// Atualiza valor das subs Ticto no banco pra refletir s.price real (com taxa).
// Match por email/cpf. Só toca em subs que mudam.
auditRoutes.post("/ticto-sync-prices", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);

  const tictoSubs: Array<Record<string, unknown>> = [];
  let page = 1;
  while (true) {
    const r = await getSubscriptionsHistory(page);
    const data = r.data ?? [];
    if (data.length === 0) break;
    tictoSubs.push(...data);
    const last = r.meta?.last_page ?? page;
    if (page >= last) break;
    page++;
  }

  // Map por email + cpf → price real
  type TictoPrice = { email: string; cpf: string; tictoId: string; price: number; subId: string };
  const tictoData: TictoPrice[] = [];
  for (const ts of tictoSubs) {
    const cust = (ts.customer as Record<string, unknown>) ?? {};
    const email = String(cust.email ?? "").toLowerCase();
    const cpf = String(cust.cpf ?? cust.cnpj ?? "");
    const price = Number(ts.price ?? 0) / 100;
    if (price <= 0) continue;
    tictoData.push({
      email,
      cpf,
      tictoId: String(ts.id ?? ""),
      subId: String((ts.order as Record<string, unknown>)?.hash ?? ""),
      price,
    });
  }

  // Pra cada sub Ticto no banco, busca correspondente no Ticto e atualiza
  const dbSubs = await db
    .select({
      id: subscriptions.id,
      leadId: subscriptions.leadId,
      valor: subscriptions.valor,
      gatewaySubscriptionId: subscriptions.gatewaySubscriptionId,
      leadEmail: leads.email,
      leadCpf: leads.gatewayCustomerId,
    })
    .from(subscriptions)
    .innerJoin(leads, eq(leads.id, subscriptions.leadId))
    .where(eq(subscriptions.gateway, "ticto"));

  let updated = 0;
  let unchanged = 0;
  let noMatch = 0;
  const samples: Array<{ leadId: number; email: string | null; from: number | null; to: number }> = [];

  for (const dbS of dbSubs) {
    let match = dbS.gatewaySubscriptionId
      ? tictoData.find((t) => t.subId === dbS.gatewaySubscriptionId || t.tictoId === dbS.gatewaySubscriptionId)
      : undefined;
    if (!match && dbS.leadEmail) {
      match = tictoData.find((t) => t.email === (dbS.leadEmail ?? "").toLowerCase());
    }
    if (!match && dbS.leadCpf) {
      match = tictoData.find((t) => t.cpf === dbS.leadCpf);
    }
    if (!match) { noMatch++; continue; }

    if (Math.abs((dbS.valor ?? 0) - match.price) < 0.01) {
      unchanged++;
      continue;
    }

    await db
      .update(subscriptions)
      .set({ valor: match.price, atualizadoEm: new Date() })
      .where(eq(subscriptions.id, dbS.id));
    // Também atualiza valor_assinatura no lead (drill-downs/ARPU/etc)
    await db
      .update(leads)
      .set({ valorAssinatura: match.price, atualizadoEm: new Date() })
      .where(eq(leads.id, dbS.leadId));
    if (samples.length < 10) {
      samples.push({ leadId: dbS.leadId, email: dbS.leadEmail, from: dbS.valor, to: match.price });
    }
    updated++;
  }

  return c.json({ ok: true, updated, unchanged, noMatch, samples });
});

/**
 * GET /api/audit/asaas-revenue
 * Soma todos payments Asaas por produto (extraído da description).
 * Read-only — calcula bruto, reembolsado e líquido.
 */
auditRoutes.get("/asaas-revenue", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ error: "ASAAS_API_KEY não configurada" }, 500);

  // Lista paginada
  async function listAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    while (true) {
      const r = await fetch(`${url}${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`, {
        headers: { access_token: key },
      });
      if (!r.ok) {
        if (r.status === 429) { await new Promise(res => setTimeout(res, 2000)); continue; }
        break;
      }
      const b = (await r.json()) as { data: T[]; hasMore: boolean };
      out.push(...(b.data ?? []));
      if (!b.hasMore) break;
      offset += 100;
      if (offset > 10000) break;
      await new Promise(res => setTimeout(res, 200));
    }
    return out;
  }

  type Pay = { status: string; value: number; description?: string; confirmedDate?: string; paymentDate?: string };
  const pays = await listAll<Pay>("/payments");

  // Classifica por produto via description
  function detectProduto(desc: string | undefined): string {
    const d = (desc ?? "").toLowerCase();
    if (/web designer/.test(d)) return "Web Designer do Futuro";
    if (/lucrando com foto/.test(d)) return "Lucrando com Foto de IA";
    if (/designer de prompt|designer master/.test(d)) return "Designer de Prompt";
    if (/gravyx|oferta principal/.test(d)) return "Gravyx";
    if (/arsenal|proposta/.test(d)) return "Outros (legado)";
    return "Outros";
  }

  type Bucket = {
    bruto: number;
    refundado: number;
    liquido: number;
    countConfirmed: number;
    countRefunded: number;
  };
  const byProduto: Record<string, Bucket> = {};
  let totalBruto = 0, totalRefund = 0;

  for (const p of pays) {
    const status = (p.status ?? "").toUpperCase();
    const produto = detectProduto(p.description);
    if (!byProduto[produto]) byProduto[produto] = { bruto: 0, refundado: 0, liquido: 0, countConfirmed: 0, countRefunded: 0 };

    if (status === "CONFIRMED" || status === "RECEIVED" || status === "RECEIVED_IN_CASH") {
      byProduto[produto].bruto += p.value;
      byProduto[produto].countConfirmed++;
      totalBruto += p.value;
    } else if (status === "REFUNDED") {
      byProduto[produto].refundado += p.value;
      byProduto[produto].countRefunded++;
      totalRefund += p.value;
    }
  }
  for (const k of Object.keys(byProduto)) {
    byProduto[k].liquido = byProduto[k].bruto - byProduto[k].refundado;
  }

  return c.json({
    summary: {
      totalPayments: pays.length,
      totalBruto: Math.round(totalBruto * 100) / 100,
      totalRefund: Math.round(totalRefund * 100) / 100,
      totalLiquido: Math.round((totalBruto - totalRefund) * 100) / 100,
    },
    byProduto,
  });
});

/**
 * GET /api/audit/asaas
 * Read-only — pull todos customers + subs + payments do Asaas e retorna
 * resumo agregado (sem mexer no banco). Pra ver o que vai entrar antes
 * de aplicar.
 */
auditRoutes.get("/asaas", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ error: "ASAAS_API_KEY não configurada" }, 500);

  // Helper: lista paginada de qualquer endpoint Asaas (limit 100/page)
  const fetchLog: Array<{ path: string; status: number; got: number; offset: number }> = [];
  async function listAll<T = Record<string, unknown>>(path: string): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    while (true) {
      const r = await fetch(`${url}${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`, {
        headers: { access_token: key },
      });
      if (!r.ok) {
        fetchLog.push({ path, status: r.status, got: 0, offset });
        if (r.status === 429) {
          await new Promise((res) => setTimeout(res, 2000));
          continue;
        }
        break;
      }
      const b = (await r.json()) as { data: T[]; hasMore: boolean };
      fetchLog.push({ path, status: r.status, got: b.data?.length ?? 0, offset });
      out.push(...(b.data ?? []));
      if (!b.hasMore) break;
      offset += 100;
      if (offset > 10000) break;
      await new Promise((res) => setTimeout(res, 200));
    }
    return out;
  }

  // 1) Lista TUDO globalmente (3-10 calls em vez de 1 por customer)
  const customers = await listAll<{ id: string; name?: string; email?: string; cpfCnpj?: string }>("/customers");
  const allSubs = await listAll<{ id: string; customer: string; status: string; value: number; cycle: string; description?: string; dateCreated?: string; deletedDate?: string }>("/subscriptions");
  const allPays = await listAll<{ id: string; customer: string; status: string; value: number; description?: string; confirmedDate?: string; paymentDate?: string; dueDate?: string; subscription?: string }>("/payments");

  // 2) Pra cada customer, busca subs + payments (paralelo limitado pra não estourar API)
  type Bucket = {
    name: string;
    email: string;
    cpf: string;
    customerId: string;
    subStatus: string | null;
    subValue: number | null;
    subCycle: string | null;
    description: string | null;
    paymentsCount: number;
    paymentsConfirmed: number;
    paymentsRefunded: number;
    paymentsPending: number;
    lastPaymentDate: string | null;
    classification: "ativa" | "cancelada" | "reembolsada" | "atrasada" | "sem_assinatura";
  };
  const buckets: Bucket[] = [];

  // Index payments e subs por customer pra lookup O(1)
  const subsByCustomer = new Map<string, typeof allSubs>();
  for (const s of allSubs) {
    if (!subsByCustomer.has(s.customer)) subsByCustomer.set(s.customer, []);
    subsByCustomer.get(s.customer)!.push(s);
  }
  const paysByCustomer = new Map<string, typeof allPays>();
  for (const p of allPays) {
    if (!paysByCustomer.has(p.customer)) paysByCustomer.set(p.customer, []);
    paysByCustomer.get(p.customer)!.push(p);
  }

  const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
  for (const cust of customers) {
    const sub = subsByCustomer.get(cust.id) ?? [];
    const pays = paysByCustomer.get(cust.id) ?? [];

    // Pega sub mais recente
    const lastSub = [...sub].sort((a, b) =>
      String(b.dateCreated ?? "").localeCompare(String(a.dateCreated ?? "")),
    )[0];

    const pConfirmed = pays.filter((p) => /^(CONFIRMED|RECEIVED|RECEIVED_IN_CASH)$/i.test(String(p.status ?? ""))).length;
    const pRefunded = pays.filter((p) => /^REFUNDED$/i.test(String(p.status ?? ""))).length;
    const pPending = pays.filter((p) => /^(PENDING|OVERDUE)$/i.test(String(p.status ?? ""))).length;

    const lastPay = pays.find((p) => /^(CONFIRMED|RECEIVED|RECEIVED_IN_CASH)$/i.test(String(p.status ?? "")));
    const lastDate = String(lastPay?.confirmedDate ?? lastPay?.paymentDate ?? lastPay?.dueDate ?? "") || null;

    let classification: Bucket["classification"] = "sem_assinatura";
    const subStatus = String(lastSub?.status ?? "").toUpperCase();
    const onlyRefund = pays.length > 0 && pays.every((p) => /^REFUNDED$/i.test(String(p.status ?? "")));
    const recentPaid = pays.some((p) => {
      if (!/^(CONFIRMED|RECEIVED|RECEIVED_IN_CASH)$/i.test(String(p.status ?? ""))) return false;
      const d = new Date(String(p.confirmedDate ?? p.paymentDate ?? p.dueDate));
      return d.getTime() > cutoff;
    });

    if (lastSub && subStatus === "ACTIVE") {
      classification = recentPaid ? "ativa" : "atrasada";
    } else if (lastSub && (subStatus === "INACTIVE" || subStatus === "EXPIRED")) {
      classification = "cancelada";
    } else if (onlyRefund) {
      classification = "reembolsada";
    } else if (pays.length > 0 && !lastSub) {
      classification = recentPaid ? "ativa" : "cancelada";
    }

    buckets.push({
      name: String(cust.name ?? ""),
      email: String(cust.email ?? ""),
      cpf: String(cust.cpfCnpj ?? ""),
      customerId: String(cust.id),
      subStatus: lastSub ? String(lastSub.status ?? "") : null,
      subValue: lastSub ? Number(lastSub.value) : null,
      subCycle: lastSub ? String(lastSub.cycle ?? "") : null,
      description: lastSub ? String(lastSub.description ?? "") : (pays[0] ? String(pays[0].description ?? "") : null),
      paymentsCount: pays.length,
      paymentsConfirmed: pConfirmed,
      paymentsRefunded: pRefunded,
      paymentsPending: pPending,
      lastPaymentDate: lastDate,
      classification,
    });
  }

  // Resumos
  const byClass: Record<string, number> = {};
  let mrrAtivas = 0;
  for (const b of buckets) {
    byClass[b.classification] = (byClass[b.classification] ?? 0) + 1;
    if (b.classification === "ativa" && b.subValue) {
      // Cycle: MONTHLY = mensal, YEARLY = anual / 12
      if (String(b.subCycle).toUpperCase().includes("YEAR")) mrrAtivas += b.subValue / 12;
      else mrrAtivas += b.subValue;
    }
  }

  // Top planos (description) das ativas + canceladas
  const planos: Record<string, { ativas: number; total: number }> = {};
  for (const b of buckets) {
    const plano = b.description?.trim() || "Sem plano";
    if (!planos[plano]) planos[plano] = { ativas: 0, total: 0 };
    planos[plano].total++;
    if (b.classification === "ativa") planos[plano].ativas++;
  }

  return c.json({
    summary: {
      totalCustomers: customers.length,
      totalSubs: allSubs.length,
      totalPayments: allPays.length,
      ...byClass,
      mrrAtivas: Math.round(mrrAtivas * 100) / 100,
    },
    fetchLog,
    planos: Object.entries(planos)
      .map(([plano, info]) => ({ plano, ...info }))
      .sort((a, b) => b.ativas - a.ativas)
      .slice(0, 30),
    ativas: buckets.filter((b) => b.classification === "ativa").map((b) => ({
      nome: b.name,
      email: b.email,
      cpf: b.cpf,
      plano: b.description,
      valor: b.subValue,
      cycle: b.subCycle,
      lastPay: b.lastPaymentDate,
    })),
    canceladas: buckets.filter((b) => b.classification === "cancelada").length,
    reembolsadas: buckets.filter((b) => b.classification === "reembolsada").map((b) => ({
      nome: b.name,
      email: b.email,
      plano: b.description,
      valor: b.subValue ?? null,
      payments: b.paymentsRefunded,
    })),
    atrasadas: buckets.filter((b) => b.classification === "atrasada").map((b) => ({
      nome: b.name,
      email: b.email,
      plano: b.description,
      valor: b.subValue,
    })),
  });
});

// Inspect 1 sub Ticto pelo email — debug profundo
auditRoutes.get("/ticto-lead", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const email = (c.req.query("email") ?? "").toLowerCase();
  if (!email) return c.json({ error: "email required" }, 400);

  const tictoSubs: Array<Record<string, unknown>> = [];
  let page = 1;
  while (true) {
    const r = await getSubscriptionsHistory(page);
    const data = r.data ?? [];
    if (data.length === 0) break;
    tictoSubs.push(...data);
    const last = r.meta?.last_page ?? page;
    if (page >= last) break;
    page++;
  }

  const matches = tictoSubs.filter((s) => {
    const c = (s.customer as Record<string, unknown>) ?? {};
    return String(c.email ?? "").toLowerCase() === email;
  });

  return c.json({ count: matches.length, subs: matches });
});

auditRoutes.get("/ticto", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);

  // 1. Pull subscriptions Ticto (todas — só ~250)
  const tictoSubs: Array<Record<string, unknown>> = [];
  let page = 1;
  while (true) {
    const r = await getSubscriptionsHistory(page);
    const data = r.data ?? [];
    if (data.length === 0) break;
    tictoSubs.push(...data);
    const last = r.meta?.last_page ?? page;
    if (page >= last) break;
    page++;
  }

  // Debug: shape da 1ª sub
  const sampleShape = tictoSubs[0] ? Object.keys(tictoSubs[0]).sort() : [];
  const sampleAtiva = tictoSubs.find((s) => {
    const sit = String(s.situation ?? s.status ?? "").toLowerCase();
    return sit === "ativa" || sit === "active";
  });

  // 2. Subs Ticto no banco
  const dbSubs = await db
    .select({
      id: subscriptions.id,
      leadId: subscriptions.leadId,
      gatewaySubscriptionId: subscriptions.gatewaySubscriptionId,
      gatewayCustomerId: subscriptions.gatewayCustomerId,
      planoNome: subscriptions.planoNome,
      valor: subscriptions.valor,
      status: subscriptions.status,
      periodicidade: subscriptions.periodicidade,
      pagouEm: subscriptions.pagouEm,
      leadEmail: leads.email,
      leadCpf: leads.gatewayCustomerId,
      leadNome: leads.nome,
    })
    .from(subscriptions)
    .innerJoin(leads, eq(leads.id, subscriptions.leadId))
    .where(eq(subscriptions.gateway, "ticto"));

  // Conta status Ticto
  const tictoByStatus: Record<string, number> = {};
  let tictoMrr = 0;
  let tictoActiveCount = 0;
  // Helper: extrai valor da sub Ticto. Tenta vários campos pq a API muda
  // entre payloads (offer.amount, value, item.amount, etc).
  function extractValor(s: Record<string, unknown>): number {
    const offer = s.offer as Record<string, unknown> | undefined;
    const item = s.item as Record<string, unknown> | undefined;
    const candidates = [
      // Sub Ticto: price no root é em centavos.
      Number(s.price),
      Number(s.first_charge_price),
      Number(offer?.price),
      Number(offer?.amount),
      Number(item?.amount),
      Number(s.value),
      Number(s.amount),
      Number(s.total),
      Number(s.unit_price),
    ];
    for (const c of candidates) {
      if (Number.isFinite(c) && c > 0) return c / 100;
    }
    return 0;
  }

  // Status real considera ÚLTIMA transação (situation pode estar stale).
  // Ex: sub Daniel — situation="Ativa" mas transactions[0].status="refunded".
  function realStatus(s: Record<string, unknown>): string {
    const sit = String(s.situation ?? s.status ?? "").toLowerCase();
    const txs = (s.transactions as Array<Record<string, unknown>>) ?? [];
    const latest = txs.find((t) => t.is_latest_transaction) ?? txs[0];
    if (latest) {
      const txStatus = String(latest.status ?? "").toLowerCase();
      if (txStatus === "refunded" || txStatus === "chargeback") return "reembolsada";
      if (txStatus === "delayed") return "atrasada";
      if (txStatus === "refused") return "atrasada";
    }
    return sit;
  }

  for (const s of tictoSubs) {
    const sit = realStatus(s);
    tictoByStatus[sit] = (tictoByStatus[sit] ?? 0) + 1;
    if (sit === "ativa" || sit === "active") {
      tictoActiveCount++;
      const valor = extractValor(s);
      const period = String(s.periodicity ?? s.periodicidade ?? "monthly").toLowerCase();
      const interval = String(s.interval ?? "monthly").toLowerCase();
      if (period.includes("anual") || period === "yearly" || interval.includes("year") || interval.includes("anual")) {
        tictoMrr += valor / 12;
      } else {
        tictoMrr += valor;
      }
    }
  }

  // Conta status banco
  const dbByStatus: Record<string, number> = {};
  let dbMrr = 0;
  let dbActiveCount = 0;
  for (const s of dbSubs) {
    dbByStatus[s.status] = (dbByStatus[s.status] ?? 0) + 1;
    if (s.status === "ativa") {
      dbActiveCount++;
      const v = s.valor ?? 0;
      if (s.periodicidade === "anual") dbMrr += v / 12;
      else if (s.periodicidade !== "vitalicio" && s.periodicidade !== "gratis") dbMrr += v;
    }
  }

  // Match por gatewaySubscriptionId (hash) e por email do customer
  const dbBySubId = new Map<string, (typeof dbSubs)[number]>();
  const dbByEmail = new Map<string, (typeof dbSubs)[number][]>();
  const dbByCpf = new Map<string, (typeof dbSubs)[number][]>();
  for (const s of dbSubs) {
    if (s.gatewaySubscriptionId) dbBySubId.set(s.gatewaySubscriptionId, s);
    if (s.leadEmail) {
      const arr = dbByEmail.get(s.leadEmail.toLowerCase()) ?? [];
      arr.push(s);
      dbByEmail.set(s.leadEmail.toLowerCase(), arr);
    }
    if (s.leadCpf) {
      const arr = dbByCpf.get(s.leadCpf) ?? [];
      arr.push(s);
      dbByCpf.set(s.leadCpf, arr);
    }
  }

  type Diff = {
    customerEmail: string | null;
    customerCpf: string | null;
    tictoStatus: string;
    dbStatus: string | null;
    tictoValor: number;
    dbValor: number | null;
    tictoPlano: string;
    dbPlano: string | null;
    issue: string;
  };
  const issues: Diff[] = [];
  let matched = 0;
  let onlyInTicto = 0;

  for (const ts of tictoSubs) {
    const sit = realStatus(ts);
    const customer = (ts.customer as Record<string, unknown>) ?? {};
    const email = String(customer.email ?? "").toLowerCase();
    const cpf = String(customer.cpf ?? customer.cnpj ?? "");
    const tictoValor = extractValor(ts);
    const tictoPlano = `${(ts.product as Record<string, unknown>)?.name ?? ts.product_name ?? ""} ${(ts.offer as Record<string, unknown>)?.name ?? ""}`.trim() || "(sem plano)";

    // Tenta match por subscription_id (hash da Ticto)
    const tictoId = String(ts.id ?? ts.hash ?? "");
    let dbMatch: (typeof dbSubs)[number] | undefined =
      tictoId ? dbBySubId.get(tictoId) : undefined;

    // Fallback por email
    if (!dbMatch && email) {
      const arr = dbByEmail.get(email) ?? [];
      dbMatch = arr[0];
    }
    // Fallback por CPF
    if (!dbMatch && cpf) {
      const arr = dbByCpf.get(cpf) ?? [];
      dbMatch = arr[0];
    }

    if (!dbMatch) {
      onlyInTicto++;
      issues.push({
        customerEmail: email || null,
        customerCpf: cpf || null,
        tictoStatus: sit,
        dbStatus: null,
        tictoValor,
        dbValor: null,
        tictoPlano,
        dbPlano: null,
        issue: "no-match-in-db",
      });
      continue;
    }
    matched++;

    // Compara status
    const expectedDb = sit === "ativa" || sit === "active" ? "ativa"
      : sit === "atrasada" || sit === "delayed" ? "atrasada"
      : sit === "cancelada" || sit === "canceled" ? "cancelada"
      : null;

    if (expectedDb && dbMatch.status !== expectedDb) {
      issues.push({
        customerEmail: email || null,
        customerCpf: cpf || null,
        tictoStatus: sit,
        dbStatus: dbMatch.status,
        tictoValor,
        dbValor: dbMatch.valor,
        tictoPlano,
        dbPlano: dbMatch.planoNome,
        issue: `status-mismatch (${sit} vs ${dbMatch.status})`,
      });
    } else if (Math.abs(tictoValor - (dbMatch.valor ?? 0)) > 1) {
      issues.push({
        customerEmail: email || null,
        customerCpf: cpf || null,
        tictoStatus: sit,
        dbStatus: dbMatch.status,
        tictoValor,
        dbValor: dbMatch.valor,
        tictoPlano,
        dbPlano: dbMatch.planoNome,
        issue: `valor-mismatch (${tictoValor} vs ${dbMatch.valor})`,
      });
    }
  }

  // Subs no banco com status='ativa' que não existem mais como ativas no Ticto
  const tictoActiveByEmail = new Set<string>();
  const tictoActiveByCpf = new Set<string>();
  const tictoActiveBySubId = new Set<string>();
  for (const ts of tictoSubs) {
    const sit = realStatus(ts);
    if (sit !== "ativa" && sit !== "active") continue;
    const customer = (ts.customer as Record<string, unknown>) ?? {};
    const email = String(customer.email ?? "").toLowerCase();
    const cpf = String(customer.cpf ?? customer.cnpj ?? "");
    const id = String(ts.id ?? ts.hash ?? "");
    if (email) tictoActiveByEmail.add(email);
    if (cpf) tictoActiveByCpf.add(cpf);
    if (id) tictoActiveBySubId.add(id);
  }

  const orphanActive = dbSubs.filter((s) => {
    if (s.status !== "ativa") return false;
    const subId = s.gatewaySubscriptionId ?? "";
    if (subId && tictoActiveBySubId.has(subId)) return false;
    if (s.leadEmail && tictoActiveByEmail.has(s.leadEmail.toLowerCase())) return false;
    if (s.leadCpf && tictoActiveByCpf.has(s.leadCpf)) return false;
    return true;
  });

  // Quem está ATIVO no Ticto mas o lead correspondente está como NÃO-ativo
  // (ou ativo num gateway diferente, ou sem sub Ticto no banco).
  const dbActiveTictoEmails = new Set<string>();
  const dbActiveTictoCpfs = new Set<string>();
  for (const s of dbSubs) {
    if (s.status !== "ativa") continue;
    if (s.leadEmail) dbActiveTictoEmails.add(s.leadEmail.toLowerCase());
    if (s.leadCpf) dbActiveTictoCpfs.add(s.leadCpf);
  }
  const tictoActiveMissingFromDb: Array<{
    email: string | null;
    cpf: string | null;
    nome: string;
    plano: string;
    valor: number;
  }> = [];
  for (const ts of tictoSubs) {
    const sit = realStatus(ts);
    if (sit !== "ativa" && sit !== "active") continue;
    const customer = (ts.customer as Record<string, unknown>) ?? {};
    const email = String(customer.email ?? "").toLowerCase();
    const cpf = String(customer.cpf ?? customer.cnpj ?? "");
    if (email && dbActiveTictoEmails.has(email)) continue;
    if (cpf && dbActiveTictoCpfs.has(cpf)) continue;
    tictoActiveMissingFromDb.push({
      email: email || null,
      cpf: cpf || null,
      nome: String(customer.name ?? ""),
      plano: `${(ts.product as Record<string, unknown>)?.name ?? ts.product_name ?? ""} ${(ts.offer as Record<string, unknown>)?.name ?? ""}`.trim(),
      valor: extractValor(ts),
    });
  }

  return c.json({
    ok: true,
    summary: {
      tictoTotal: tictoSubs.length,
      tictoActive: tictoActiveCount,
      tictoMrr: Math.round(tictoMrr * 100) / 100,
      dbTotal: dbSubs.length,
      dbActive: dbActiveCount,
      dbMrr: Math.round(dbMrr * 100) / 100,
      delta: {
        countActive: tictoActiveCount - dbActiveCount,
        mrr: Math.round((tictoMrr - dbMrr) * 100) / 100,
      },
      matched,
      onlyInTicto,
      orphanActiveInDb: orphanActive.length,
    },
    tictoByStatus,
    dbByStatus,
    sampleShape,
    sampleAtiva: sampleAtiva
      ? {
          id: sampleAtiva.id,
          situation: sampleAtiva.situation,
          price: sampleAtiva.price,
          first_charge_price: sampleAtiva.first_charge_price,
          interval: sampleAtiva.interval,
          payment_method: sampleAtiva.payment_method,
          offer: sampleAtiva.offer,
          product: sampleAtiva.product,
          customer: sampleAtiva.customer,
        }
      : null,
    tictoActiveMissingFromDb,
    issues: issues.slice(0, 30),
    orphanActive: orphanActive.slice(0, 20).map((s) => ({
      leadId: s.leadId,
      nome: s.leadNome,
      email: s.leadEmail,
      planoNome: s.planoNome,
      valor: s.valor,
    })),
  });
});
