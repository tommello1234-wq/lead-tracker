/**
 * Endpoints de auditoria read-only — comparam fontes externas (Ticto API,
 * Stripe, Asaas) com o estado no banco. Não escrevem nada.
 *
 * Uso: GET /api/audit/ticto?token=<CRON_SECRET>
 */
import { Hono } from "hono";
import { db } from "../../db/client.js";
import { subscriptions, leads, eventos, mrrMovements } from "../../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { getSubscriptionsHistory } from "../lib/ticto-api.js";
import { sendPurchaseToMeta } from "../lib/meta-capi.js";
import { decodeAttribution } from "../lib/stripe.js";

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

  // Ticto — varre orders/history e filtra por email (Ticto não tem filtro
  // direto por email confiável, então busca em todas as páginas recentes).
  let tictoInfo: unknown = null;
  try {
    const { getOrdersHistory } = await import("../lib/ticto-api.js");
    const matches: Array<{ produto: string; valor: number; status: string; data: string }> = [];
    let page = 1;
    while (page <= 40) {
      const resp = (await getOrdersHistory(page)) as {
        data?: Array<Record<string, unknown>>;
        meta?: { last_page?: number };
      };
      const list = resp.data ?? [];
      for (const o of list) {
        const cust = o.customer as { email?: string } | undefined;
        if ((cust?.email ?? "").toLowerCase() === email) {
          const item = o.item as { product_name?: string; offer_name?: string; amount?: number } | undefined;
          const tx = o.transaction as { paid_amount?: number; status?: string } | undefined;
          const offer = o.offer as { product_name?: string; name?: string } | undefined;
          const product = o.product as { name?: string } | undefined;
          const cents = tx?.paid_amount ?? item?.amount ?? (o.paid_amount as number) ?? 0;
          matches.push({
            produto:
              item?.product_name ??
              product?.name ??
              offer?.product_name ??
              offer?.name ??
              item?.offer_name ??
              "(sem nome)",
            valor: cents / 100,
            status: String(o.status ?? tx?.status ?? "?"),
            data: String(o.order_date ?? o.created_at ?? ""),
            offer: o.offer,
            subscriptionId: o.subscription_id,
            transaction: o.transaction,
          } as never);
        }
      }
      const last = resp.meta?.last_page ?? 1;
      if (page >= last || list.length === 0) break;
      page++;
    }
    tictoInfo = { matches, pagesScanned: page };
  } catch (e) {
    tictoInfo = { error: e instanceof Error ? e.message : String(e) };
  }

  return c.json({
    db: dbLead ? { lead: dbLead, subs: dbSubs } : null,
    asaas: asaasInfo,
    ticto: tictoInfo,
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
/** GET /api/audit/asaas-debug-next?customer=cus_XXX
 *  Dump de payments de um customer Asaas + cálculo do nextPaymentDate
 *  igual o sync faz. Pra debugar por que proximo_pagamento_em fica errado. */
auditRoutes.get("/asaas-debug-next", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const customerId = c.req.query("customer");
  if (!customerId) return c.json({ error: "customer query param required" }, 400);
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) return c.json({ error: "ASAAS_API_KEY não configurada" }, 500);

  // Lista subs + payments do customer (sem paginação — customers individuais têm poucos)
  const [subsR, paysR] = await Promise.all([
    fetch(`${url}/subscriptions?customer=${customerId}&limit=10`, { headers: { access_token: key } }),
    fetch(`${url}/payments?customer=${customerId}&limit=50`, { headers: { access_token: key } }),
  ]);
  const subs = (await subsR.json()).data ?? [];
  const pays = (await paysR.json()).data ?? [];
  const lastSub = subs.sort((a: { dateCreated?: string }, b: { dateCreated?: string }) => (b.dateCreated ?? "").localeCompare(a.dateCreated ?? ""))[0];

  // Replica lógica do asaas-sync
  const PENDING_RE = /^(PENDING|AWAITING_RISK_ANALYSIS|AWAITING_PAYMENT|OVERDUE)$/i;
  const pendingOfCurrentSub = lastSub
    ? pays
        .filter((p: { subscription?: string }) => p.subscription === lastSub.id)
        .filter((p: { status?: string }) => PENDING_RE.test(p.status ?? ""))
        .map((p: { dueDate: string }) => p.dueDate)
        .sort()
    : [];

  return c.json({
    lastSubId: lastSub?.id,
    lastSubNextDueDate: lastSub?.nextDueDate,
    totalPays: pays.length,
    paysSummary: pays.map((p: { dueDate: string; status: string; subscription?: string }) => ({
      due: p.dueDate, status: p.status, sub: p.subscription,
    })),
    pendingOfCurrentSub,
    nextPaymentDateCalculado: pendingOfCurrentSub[0] ?? lastSub?.nextDueDate,
  });
});

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

// Lista todas subs Ticto com status real (atrasadas/canceladas/etc)
auditRoutes.get("/ticto-list", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const status = (c.req.query("status") ?? "").toLowerCase();

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

  function realStatus(s: Record<string, unknown>): string {
    const txs = (s.transactions as Array<Record<string, unknown>>) ?? [];
    const latest = txs.find((t) => t.is_latest_transaction) ?? txs[0];
    if (latest) {
      const tx = String(latest.status ?? "").toLowerCase();
      if (tx === "refunded" || tx === "chargeback") return "reembolsada";
      if (tx === "delayed" || tx === "refused") return "atrasada";
    }
    return String(s.situation ?? s.status ?? "").toLowerCase();
  }

  const list = tictoSubs
    .map((s) => {
      const offer = (s.offer as Record<string, unknown>) ?? {};
      const product = (s.product as Record<string, unknown>) ?? {};
      const customer = (s.customer as Record<string, unknown>) ?? {};
      const phones = (customer.phones as Array<Record<string, unknown>>) ?? [];
      const phone = phones[0] ?? customer.phone;
      const txs = (s.transactions as Array<Record<string, unknown>>) ?? [];
      const latest = txs.find((t) => t.is_latest_transaction) ?? txs[0];
      const successfulCharges = Number(s.successful_charges ?? 0);
      const failedCharges = Number(s.failed_charges ?? 0);
      return {
        status: realStatus(s),
        situation: s.situation,
        nome: customer.name,
        email: customer.email,
        phone: phone ? `${(phone as Record<string, unknown>).ddi ?? "+55"}${(phone as Record<string, unknown>).ddd ?? ""}${(phone as Record<string, unknown>).number ?? ""}`.replace(/\D/g, "") : null,
        plano: `${product.name ?? ""} ${offer.name ?? ""}`.trim(),
        valor: Number(s.price) / 100,
        ultimoPagamento: latest?.created_at,
        ultimoStatus: latest?.status,
        successfulCharges,
        failedCharges,
        // jaFoiAtivo = true se pagou pelo menos 1x antes (renovação atrasou)
        // false = nunca ativou (1ª cobrança falhou)
        jaFoiAtivo: successfulCharges > 0,
      };
    })
    .filter((x) => !status || x.status === status);

  return c.json({ count: list.length, list });
});

// Cancelamentos Ticto reais por dia BRT — consulta direta na API.
// Lista TODAS as subs canceladas mostrando todos campos de data possíveis,
// pra encontrar qual reflete o cancelamento real (Ticto não documenta).
// Uso: /api/audit/ticto-cancels-day?date=2026-05-08
auditRoutes.get("/ticto-cancels-day", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);

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

  // Subs canceladas pelo painel Ticto (situation === 'cancelada' / status canceled)
  const canceladas = tictoSubs.filter((s) => {
    const sit = String(s.situation ?? s.status ?? "").toLowerCase();
    return sit === "cancelada" || sit === "canceled" || sit === "cancelled";
  });

  // Ticto distingue:
  //  - cancellation_requested_at: cliente PEDIU cancelamento (data UI relevante)
  //  - canceled_at: data fim do ciclo (sub vira inativa de fato)
  // O card "Cancelados hoje" deve usar cancellation_requested_at.
  const list = canceladas.map((s) => {
    const o = s as Record<string, unknown>;
    const customer = (o.customer as Record<string, unknown>) ?? {};
    const product = (o.product as Record<string, unknown>) ?? {};
    const offer = (o.offer as Record<string, unknown>) ?? {};
    return {
      id: o.id,
      nome: customer.name,
      email: customer.email,
      plano: `${product.name ?? ""} ${offer.name ?? ""}`.trim(),
      situation: o.situation,
      cancellation_requested_at: o.cancellation_requested_at ?? null,
      canceled_at: o.canceled_at ?? null,
      successful_charges: o.successful_charges ?? 0,
    };
  });

  // Filtra pelo dia BRT usando cancellation_requested_at.
  // BRT 00:00 do `date` = UTC `date`T03:00:00Z
  const sinceUtc = `${date}T03:00:00Z`;
  const nextDay = new Date(`${date}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const untilUtc = `${nextDay.toISOString().slice(0, 10)}T03:00:00Z`;
  const filtered = list.filter((x) => {
    if (!x.cancellation_requested_at) return false;
    const t = String(x.cancellation_requested_at);
    return t >= sinceUtc && t < untilUtc;
  });

  return c.json({
    date,
    totalCanceladas: list.length,
    matchedDay: filtered.length,
    sampleAllCanceladas: list.slice(0, 3),
    matchedList: filtered,
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

/**
 * GET /api/audit/stripe-reconcile?token=<CRON_SECRET>
 *
 * Cruza nosso banco com a API Stripe pra ver quantas subs marcadas como
 * `ativa`/`atrasada` no nosso lado ainda estão realmente active/past_due
 * na Stripe. Read-only — não altera nada.
 */
auditRoutes.get("/stripe-reconcile", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return c.json({ error: "STRIPE_SECRET_KEY não configurada" }, 500);

  type StripeSub = {
    id: string;
    status: string;
    customer: string;
    items?: { data: Array<{ price: { unit_amount: number; recurring?: { interval: string } } }> };
  };

  // Pega todas subs Stripe (paginado)
  const allStripeSubs: StripeSub[] = [];
  let starting_after: string | undefined;
  while (true) {
    const p = new URLSearchParams({ limit: "100", status: "all" });
    if (starting_after) p.set("starting_after", starting_after);
    const r = await fetch(`https://api.stripe.com/v1/subscriptions?${p}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return c.json({ error: `Stripe HTTP ${r.status}` }, 502);
    const body = (await r.json()) as { data: StripeSub[]; has_more: boolean };
    allStripeSubs.push(...body.data);
    if (!body.has_more || body.data.length === 0) break;
    starting_after = body.data[body.data.length - 1].id;
    if (allStripeSubs.length > 2000) break;
  }

  const stripeById = new Map(allStripeSubs.map((s) => [s.id, s]));
  const stripeActiveOrPastDue = new Set(
    allStripeSubs.filter((s) => s.status === "active" || s.status === "past_due" || s.status === "trialing").map((s) => s.id),
  );

  // Subs no banco como ativa/atrasada
  const ours = await db
    .select({
      id: subscriptions.id,
      subId: subscriptions.gatewaySubscriptionId,
      status: subscriptions.status,
      valor: subscriptions.valor,
      email: leads.email,
      nome: leads.nome,
    })
    .from(subscriptions)
    .leftJoin(leads, eq(leads.id, subscriptions.leadId))
    .where(
      and(
        eq(subscriptions.gateway, "stripe"),
        sql`${subscriptions.status} IN ('ativa', 'atrasada')`,
      ),
    );

  let aindaAtivas = 0;
  let missingId = 0;
  const mudaramStatus: Array<{
    email: string | null;
    nome: string | null;
    subId: string;
    statusBanco: string;
    statusStripe: string;
    valor: number | null;
  }> = [];
  const naoEncontradas: Array<{ email: string | null; subId: string; statusBanco: string; valor: number | null }> = [];

  for (const o of ours) {
    if (!o.subId) {
      missingId++;
      continue;
    }
    if (stripeActiveOrPastDue.has(o.subId)) {
      aindaAtivas++;
      continue;
    }
    const stripeSub = stripeById.get(o.subId);
    if (!stripeSub) {
      naoEncontradas.push({ email: o.email, subId: o.subId, statusBanco: o.status, valor: o.valor });
      continue;
    }
    mudaramStatus.push({
      email: o.email,
      nome: o.nome,
      subId: o.subId,
      statusBanco: o.status,
      statusStripe: stripeSub.status,
      valor: o.valor,
    });
  }

  // Subs Stripe ACTIVE/past_due que faltam no banco (gap)
  const ourIds = new Set(ours.map((o) => o.subId).filter(Boolean));
  const allDbSubsRaw = await db.select({ subId: subscriptions.gatewaySubscriptionId })
    .from(subscriptions).where(eq(subscriptions.gateway, "stripe"));
  const allDbIds = new Set(allDbSubsRaw.map((x) => x.subId).filter(Boolean));
  const missingFromDb = allStripeSubs.filter(
    (s) => (s.status === "active" || s.status === "trialing") && !allDbIds.has(s.id),
  );

  const mrrSuperestimado = mudaramStatus.reduce((acc, x) => acc + (x.valor ?? 0), 0);

  // MRR direto da API Stripe (cents → reais, normalizando anual ÷ 12)
  function subMrr(s: StripeSub): number {
    const item = s.items?.data?.[0];
    if (!item) return 0;
    const v = (item.price?.unit_amount ?? 0) / 100;
    const interval = item.price?.recurring?.interval;
    return interval === "year" ? v / 12 : v;
  }
  const mrrStripeActive = allStripeSubs
    .filter((s) => s.status === "active")
    .reduce((a, s) => a + subMrr(s), 0);
  const mrrStripeIncTrial = allStripeSubs
    .filter((s) => s.status === "active" || s.status === "trialing")
    .reduce((a, s) => a + subMrr(s), 0);
  const mrrStripeIncPastDue = allStripeSubs
    .filter((s) => s.status === "active" || s.status === "past_due" || s.status === "trialing")
    .reduce((a, s) => a + subMrr(s), 0);

  // Quebra por status (count + MRR)
  const porStatus: Record<string, { count: number; mrr: number }> = {};
  for (const s of allStripeSubs) {
    if (!porStatus[s.status]) porStatus[s.status] = { count: 0, mrr: 0 };
    porStatus[s.status].count++;
    porStatus[s.status].mrr += subMrr(s);
  }

  return c.json({
    summary: {
      stripeApiTotalSubs: allStripeSubs.length,
      stripeActiveOrPastDue: stripeActiveOrPastDue.size,
      bancoAtivaAtrasada: ours.length,
      aindaAtivas,
      mudaramStatus: mudaramStatus.length,
      naoEncontradas: naoEncontradas.length,
      missingFromDb: missingFromDb.length,
      missingId,
      mrrSuperestimado,
      mrrStripeActiveOnly: Math.round(mrrStripeActive * 100) / 100,
      mrrStripeIncTrial: Math.round(mrrStripeIncTrial * 100) / 100,
      mrrStripeIncPastDue: Math.round(mrrStripeIncPastDue * 100) / 100,
      porStatus,
    },
    mudaramStatus,
    naoEncontradas,
    missingFromDb: missingFromDb.map((s) => ({
      subId: s.id,
      customer: s.customer,
      status: s.status,
      valor: s.items?.data[0]?.price.unit_amount ? s.items.data[0].price.unit_amount / 100 : null,
    })),
  });
});

/**
 * POST /api/audit/stripe-import-missing?token=<CRON_SECRET>
 *
 * Importa subs Stripe que estão active na API mas não existem no banco.
 * Usado pra casos onde webhook customer.subscription.created não foi
 * processado (sub criada via API/Dashboard sem passar pelo checkout normal).
 *
 * Pra cada missing: cria lead (se email não existe) + sub no banco, com
 * pagouEm = data da subscription created.
 */
auditRoutes.post("/stripe-import-missing", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return c.json({ error: "STRIPE_SECRET_KEY não configurada" }, 500);

  // Pega todas subs Stripe active
  const allStripeSubs: Array<{
    id: string;
    status: string;
    customer: string;
    created: number;
    current_period_end?: number;
    cancel_at?: number | null;
    cancel_at_period_end?: boolean;
    items?: { data: Array<{ price: { unit_amount: number; recurring?: { interval: string } } }> };
  }> = [];
  let starting_after: string | undefined;
  while (true) {
    const p = new URLSearchParams({ limit: "100", status: "active" });
    if (starting_after) p.set("starting_after", starting_after);
    const r = await fetch(`https://api.stripe.com/v1/subscriptions?${p}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return c.json({ error: `Stripe HTTP ${r.status}` }, 502);
    const body = (await r.json()) as { data: typeof allStripeSubs; has_more: boolean };
    allStripeSubs.push(...body.data);
    if (!body.has_more || body.data.length === 0) break;
    starting_after = body.data[body.data.length - 1].id;
    if (allStripeSubs.length > 1000) break;
  }

  // IDs já no banco
  const existing = await db
    .select({ subId: subscriptions.gatewaySubscriptionId })
    .from(subscriptions)
    .where(eq(subscriptions.gateway, "stripe"));
  const existingIds = new Set(existing.map((e) => e.subId).filter(Boolean) as string[]);

  const missing = allStripeSubs.filter((s) => !existingIds.has(s.id));

  type ImportedSub = { subId: string; email: string | null; valor: number };
  const imported: ImportedSub[] = [];
  const failed: Array<{ subId: string; reason: string }> = [];

  for (const sub of missing) {
    try {
      // Fetch customer pra pegar email
      const r = await fetch(`https://api.stripe.com/v1/customers/${sub.customer}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) {
        failed.push({ subId: sub.id, reason: `customer HTTP ${r.status}` });
        continue;
      }
      const cust = (await r.json()) as { email?: string | null; name?: string | null; phone?: string | null };
      const email = cust.email ?? null;
      if (!email) {
        failed.push({ subId: sub.id, reason: "customer sem email" });
        continue;
      }

      const item = sub.items?.data?.[0];
      const cents = item?.price?.unit_amount ?? 0;
      const valor = cents / 100;
      const interval = item?.price?.recurring?.interval;
      const periodicidade: "mensal" | "anual" = interval === "year" ? "anual" : "mensal";

      // Acha ou cria lead
      const existingLead = await db.query.leads.findFirst({
        where: eq(leads.email, email),
      });

      const pagouEm = new Date(sub.created * 1000);
      const proximoPagamento = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
      const cancelAt = sub.cancel_at_period_end && sub.cancel_at ? new Date(sub.cancel_at * 1000) : null;

      let leadId: number;
      if (existingLead) {
        leadId = existingLead.id;
      } else {
        const [novoLead] = await db
          .insert(leads)
          .values({
            nome: cust.name ?? email.split("@")[0] ?? "Cliente",
            email,
            contato: cust.phone ?? null,
            gateway: "stripe",
            gatewayCustomerId: sub.customer,
            status: "cliente_ativo",
            subscriptionStatus: "ativa",
            valorAssinatura: valor,
            periodicidade,
            pagouEm,
            produtoId: 1, // Gravyx default
          })
          .returning({ id: leads.id });
        leadId = novoLead.id;
      }

      // Cria sub
      await db.insert(subscriptions).values({
        leadId,
        gateway: "stripe",
        gatewaySubscriptionId: sub.id,
        gatewayCustomerId: sub.customer,
        produtoId: 1,
        valor,
        periodicidade,
        status: "ativa",
        pagouEm,
        proximoPagamentoEm: proximoPagamento,
        cancelAt,
      });

      imported.push({ subId: sub.id, email, valor });
    } catch (e) {
      failed.push({ subId: sub.id, reason: String(e) });
    }
  }

  return c.json({
    totalActive: allStripeSubs.length,
    alreadyInDb: existingIds.size,
    missingCount: missing.length,
    importedCount: imported.length,
    failedCount: failed.length,
    imported,
    failed,
  });
});

/**
 * POST /api/audit/stripe-backfill-orphan-invoices?token=<CRON_SECRET>
 *
 * Encontra invoices Stripe (`invoice.payment_succeeded` com
 * billing_reason=subscription_create) que NÃO geraram `compra_aprovada`
 * (porque o checkout.session.completed nunca chegou, ex: sub criada via
 * Dashboard/API). Pra cada uma:
 *   1. Busca o invoice + customer + subscription via API Stripe
 *   2. Cria/usa o lead pelo email
 *   3. Insere um evento `compra_aprovada` sintético com payload completo
 *   4. Marca o invoice event original como processed_ok=true
 *
 * Conserva o cálculo de faturamento (que lê eventos).
 */
auditRoutes.post("/stripe-backfill-orphan-invoices", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return c.json({ error: "STRIPE_SECRET_KEY não configurada" }, 500);

  const sinceDays = Math.max(1, Math.min(60, Number(c.req.query("sinceDays") ?? "7")));

  // 1. Acha invoices Stripe com subscription_create que não viraram compra
  let orphanInvoices;
  try {
  orphanInvoices = await db.execute<{
    evento_id: number;
    received_at: Date;
    sub_id: string;
    customer_id: string;
    invoice_id: string;
    amount_paid: string | null;
  }>(sql`
    SELECT
      e.id as evento_id,
      e.received_at,
      e.payload->'data'->'object'->>'subscription' as sub_id,
      e.payload->'data'->'object'->>'customer' as customer_id,
      e.payload->'data'->'object'->>'id' as invoice_id,
      e.payload->'data'->'object'->>'amount_paid' as amount_paid
    FROM eventos e
    WHERE e.source = 'stripe'
      AND e.event_type = 'invoice.payment_succeeded'
      AND e.payload->'data'->'object'->>'billing_reason' = 'subscription_create'
      AND e.received_at > NOW() - make_interval(days => ${sinceDays})
      AND NOT EXISTS (
        SELECT 1 FROM eventos e2
        WHERE e2.source = 'stripe'
          AND e2.event_type = 'compra_aprovada'
          AND (
            e2.payload->'data'->'object'->>'subscription' = e.payload->'data'->'object'->>'subscription'
            OR e2.payload->'data'->'object'->>'id' = e.payload->'data'->'object'->>'subscription'
          )
      )
  `);
  } catch (queryErr) {
    const err = queryErr as { cause?: { message?: string; detail?: string; code?: string }; message?: string };
    return c.json({
      error: "query select falhou",
      pgMessage: err.cause?.message,
      pgDetail: err.cause?.detail,
      pgCode: err.cause?.code,
      drizzleMsg: err.message,
    }, 500);
  }

  // Debug: conta total de invoice.payment_succeeded subscription_create na janela
  const debugCount = await db.execute<{ total_invoices: number; orphan_count: number; sample_sub_id: string | null }>(sql`
    SELECT
      (SELECT count(*)::int FROM eventos e
        WHERE e.source = 'stripe' AND e.event_type = 'invoice.payment_succeeded'
          AND e.payload->'data'->'object'->>'billing_reason' = 'subscription_create'
          AND e.received_at > NOW() - make_interval(days => ${sinceDays})
      ) as total_invoices,
      (SELECT count(*)::int FROM eventos e
        WHERE e.source = 'stripe' AND e.event_type = 'invoice.payment_succeeded'
          AND e.payload->'data'->'object'->>'billing_reason' = 'subscription_create'
          AND e.received_at > NOW() - make_interval(days => ${sinceDays})
          AND NOT EXISTS (
            SELECT 1 FROM eventos e2
            WHERE e2.source = 'stripe' AND e2.event_type = 'compra_aprovada'
              AND (e2.payload->'data'->'object'->>'subscription' = e.payload->'data'->'object'->>'subscription'
                   OR e2.payload->'data'->'object'->>'id' = e.payload->'data'->'object'->>'subscription')
          )
      ) as orphan_count,
      (SELECT e.payload->'data'->'object'->>'subscription' FROM eventos e
        WHERE e.source = 'stripe' AND e.event_type = 'invoice.payment_succeeded'
          AND e.payload->'data'->'object'->>'billing_reason' = 'subscription_create'
        ORDER BY e.received_at DESC LIMIT 1
      ) as sample_sub_id
  `);
  const debug = (debugCount.rows ?? debugCount)[0] as unknown as { total_invoices: number; orphan_count: number; sample_sub_id: string | null };

  type Result = { invoiceId: string; subId: string; email: string; valor: number; eventoId: number };
  const created: Result[] = [];
  const failed: Array<{ invoiceId: string; reason: string }> = [];

  const orphanRows = ((orphanInvoices as unknown as { rows?: unknown[] }).rows ?? (orphanInvoices as unknown as unknown[])) as Array<{ evento_id: number; received_at: Date; sub_id: string; customer_id: string; invoice_id: string; amount_paid: string | null }>;
  for (const row of orphanRows) {
    try {
      // Fetch customer pra pegar email + nome
      const custRes = await fetch(`https://api.stripe.com/v1/customers/${row.customer_id}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!custRes.ok) {
        failed.push({ invoiceId: row.invoice_id, reason: `customer HTTP ${custRes.status}` });
        continue;
      }
      const cust = (await custRes.json()) as { email?: string | null; name?: string | null; phone?: string | null };
      if (!cust.email) {
        failed.push({ invoiceId: row.invoice_id, reason: "customer sem email" });
        continue;
      }

      // Fetch subscription pra pegar valor + plano
      const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${row.sub_id}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!subRes.ok) {
        failed.push({ invoiceId: row.invoice_id, reason: `subscription HTTP ${subRes.status}` });
        continue;
      }
      const sub = (await subRes.json()) as {
        items?: { data: Array<{ price: { unit_amount: number; recurring?: { interval: string }; metadata?: Record<string, string> } }> };
        metadata?: Record<string, string>;
        created: number;
      };
      const item = sub.items?.data?.[0];
      const cents = item?.price?.unit_amount ?? Number(row.amount_paid ?? 0);
      const valor = cents / 100;
      const interval = item?.price?.recurring?.interval;
      const periodicidade: "mensal" | "anual" = interval === "year" ? "anual" : "mensal";
      const planoNome =
        item?.price?.metadata?.gravyx_tier ??
        sub.metadata?.gravyx_tier ??
        null;

      // Acha ou cria lead
      let leadId: number;
      const existingLead = await db.query.leads.findFirst({
        where: eq(leads.email, cust.email),
      });
      const pagouEm = new Date(sub.created * 1000);
      if (existingLead) {
        leadId = existingLead.id;
      } else {
        const [novoLead] = await db
          .insert(leads)
          .values({
            nome: cust.name ?? cust.email.split("@")[0] ?? "Cliente",
            email: cust.email,
            contato: cust.phone ?? null,
            gateway: "stripe",
            gatewayCustomerId: row.customer_id,
            status: "cliente_ativo",
            subscriptionStatus: "ativa",
            valorAssinatura: valor,
            planoNome,
            periodicidade,
            pagouEm,
            produtoId: 1,
          })
          .returning({ id: leads.id });
        leadId = novoLead.id;
      }

      // Insere evento compra_aprovada sintético
      const fakePayload = {
        backfilled_from_invoice: row.invoice_id,
        data: {
          object: {
            id: row.invoice_id,
            subscription: row.sub_id,
            customer: row.customer_id,
            amount_total: cents,
            amount_paid: cents,
            customer_email: cust.email,
            billing_reason: "subscription_create",
          },
        },
      };
      // row.received_at vem como string ou Date dependendo do driver — normaliza
      const receivedAtDate =
        row.received_at instanceof Date ? row.received_at : new Date(row.received_at as unknown as string);
      const [newEvent] = await db
        .insert(eventos)
        .values({
          leadId,
          source: "stripe",
          eventType: "compra_aprovada",
          payload: fakePayload,
          processedOk: true,
          receivedAt: receivedAtDate,
          produtoId: 1,
        })
        .returning({ id: eventos.id });

      // Marca o invoice original como processado também (não orphan mais)
      await db
        .update(eventos)
        .set({ processedOk: true, erro: `backfilled como compra_aprovada (evento ${newEvent.id})` })
        .where(eq(eventos.id, row.evento_id));

      created.push({
        invoiceId: row.invoice_id,
        subId: row.sub_id,
        email: cust.email,
        valor,
        eventoId: newEvent.id,
      });
    } catch (e) {
      failed.push({ invoiceId: row.invoice_id, reason: String(e) });
    }
  }

  return c.json({
    orphanInvoices: orphanRows.length,
    debug,
    createdCount: created.length,
    failedCount: failed.length,
    created,
    failed,
  });
});

/**
 * POST /api/audit/stripe-backfill-cancel-at?token=<CRON_SECRET>
 *
 * Pra cada sub Stripe ativa, busca via API se cancel_at_period_end=true e
 * popula subscriptions.cancel_at. Resolve subs que pediram cancelamento via
 * Stripe Dashboard antes do webhook customer.subscription.updated ser
 * processado corretamente (bug histórico).
 */
auditRoutes.post("/stripe-backfill-cancel-at", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return c.json({ error: "STRIPE_SECRET_KEY não configurada" }, 500);

  const ativas = await db
    .select({ id: subscriptions.id, subId: subscriptions.gatewaySubscriptionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.gateway, "stripe"), eq(subscriptions.status, "ativa")));

  let updated = 0;
  let cleared = 0;
  let failed = 0;
  const samples: Array<{ subId: string; cancelAt: string | null }> = [];

  for (const a of ativas) {
    if (!a.subId || !a.subId.startsWith("sub_")) continue;
    try {
      const r = await fetch(`https://api.stripe.com/v1/subscriptions/${a.subId}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) { failed++; continue; }
      const sub = (await r.json()) as {
        cancel_at_period_end?: boolean;
        cancel_at?: number | null;
      };
      const cancelAt =
        sub.cancel_at_period_end && sub.cancel_at
          ? new Date(sub.cancel_at * 1000)
          : null;
      await db
        .update(subscriptions)
        .set({ cancelAt })
        .where(eq(subscriptions.id, a.id));
      if (cancelAt) {
        updated++;
        samples.push({ subId: a.subId, cancelAt: cancelAt.toISOString() });
      } else {
        cleared++;
      }
    } catch {
      failed++;
    }
  }

  return c.json({
    totalAtivas: ativas.length,
    populatedCancelAt: updated,
    clearedCancelAt: cleared,
    failed,
    samples,
  });
});

/**
 * POST /api/audit/stripe-fix-sub-ids?token=<CRON_SECRET>
 *
 * Bug histórico: o parser Stripe salvava `id` (= cs_live_XXX session id) em
 * gateway_subscription_id em vez do `subscription` (= sub_XXX, ID estável).
 * Resultado: webhooks de cancelamento/renovação Stripe não conseguem achar a
 * sub no banco (procuram sub_XXX, encontram cs_live_XXX).
 *
 * Fix: pra cada sub com cs_live_XXX, busca a session via API Stripe, pega o
 * .subscription real e atualiza gateway_subscription_id no banco.
 * Read-write — aplica UPDATE.
 */
auditRoutes.post("/stripe-fix-sub-ids", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return c.json({ error: "STRIPE_SECRET_KEY não configurada" }, 500);

  // Pega todas subs do banco com cs_live_* (Stripe sessions confundidas com subs)
  const broken = await db
    .select({
      id: subscriptions.id,
      subId: subscriptions.gatewaySubscriptionId,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.gateway, "stripe"),
        sql`${subscriptions.gatewaySubscriptionId} LIKE 'cs_live_%' OR ${subscriptions.gatewaySubscriptionId} LIKE 'cs_test_%'`,
      ),
    );

  const fixed: Array<{ dbId: number; oldId: string; newId: string }> = [];
  const failed: Array<{ dbId: number; subId: string; reason: string }> = [];

  for (const b of broken) {
    if (!b.subId) continue;
    try {
      const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${b.subId}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) {
        failed.push({ dbId: b.id, subId: b.subId, reason: `Stripe HTTP ${r.status}` });
        continue;
      }
      const session = (await r.json()) as { subscription?: string };
      const realSubId = session.subscription;
      if (!realSubId) {
        failed.push({ dbId: b.id, subId: b.subId, reason: "session sem subscription" });
        continue;
      }
      await db
        .update(subscriptions)
        .set({ gatewaySubscriptionId: realSubId })
        .where(eq(subscriptions.id, b.id));
      fixed.push({ dbId: b.id, oldId: b.subId, newId: realSubId });
    } catch (e) {
      failed.push({ dbId: b.id, subId: b.subId, reason: String(e) });
    }
  }

  return c.json({
    totalBroken: broken.length,
    fixedCount: fixed.length,
    failedCount: failed.length,
    fixed,
    failed,
  });
});

/**
 * GET /api/audit/ticto-reconcile?token=<CRON_SECRET>
 *
 * Cruza nosso banco com a API Ticto. Subs Ticto não têm gateway_subscription_id
 * confiável (varia por offer), então cruzamos por CPF (gateway_customer_id).
 * Read-only.
 */
auditRoutes.get("/ticto-reconcile", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);

  // Pega subs Ticto via API existente
  let tictoSubs: Array<{
    customer?: { cpf?: string; cnpj?: string; email?: string; name?: string };
    situation?: string;
    transactions?: Array<{ status?: string }>;
  }> = [];
  try {
    let page = 1;
    while (page < 50) {
      const resp = await getSubscriptionsHistory(page);
      const data = resp.data ?? [];
      if (data.length === 0) break;
      tictoSubs = tictoSubs.concat(data as typeof tictoSubs);
      const lastPage = resp.meta?.last_page ?? page;
      if (page >= lastPage) break;
      page++;
    }
  } catch (e) {
    return c.json({ error: `Ticto API: ${e instanceof Error ? e.message : "unknown"}` }, 502);
  }

  // Filtra ATIVAS na Ticto. `situation` vem em PT ("ativa", "atrasada",
  // "cancelada", "reembolsada", "checkout_perdido") MAS pode vir EN tambem
  // dependendo da versao da API. Trata ambos.
  const tictoActiveCpfs = new Set<string>();
  const statusCounts = new Map<string, number>();
  for (const s of tictoSubs) {
    const sit = String(s.situation ?? "").toLowerCase();
    statusCounts.set(sit, (statusCounts.get(sit) ?? 0) + 1);
    // Considera "ainda assinante" se situation for ativa OU atrasada.
    // checkout_perdido / cancelada / reembolsada = não conta.
    if (sit === "ativa" || sit === "active" || sit === "atrasada" || sit === "delayed" || sit === "paid_off") {
      const cpf = s.customer?.cpf ?? s.customer?.cnpj;
      if (cpf) tictoActiveCpfs.add(cpf);
    }
  }

  // Subs no banco
  const ours = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      valor: subscriptions.valor,
      cpf: subscriptions.gatewayCustomerId,
      email: leads.email,
      nome: leads.nome,
    })
    .from(subscriptions)
    .leftJoin(leads, eq(leads.id, subscriptions.leadId))
    .where(
      and(
        eq(subscriptions.gateway, "ticto"),
        sql`${subscriptions.status} IN ('ativa', 'atrasada')`,
      ),
    );

  let aindaAtivas = 0;
  const possivelmenteCanceladas: Array<{
    email: string | null;
    nome: string | null;
    cpf: string | null;
    statusBanco: string;
    valor: number | null;
  }> = [];

  for (const o of ours) {
    if (o.cpf && tictoActiveCpfs.has(o.cpf)) {
      aindaAtivas++;
    } else {
      possivelmenteCanceladas.push({
        email: o.email,
        nome: o.nome,
        cpf: o.cpf,
        statusBanco: o.status,
        valor: o.valor,
      });
    }
  }

  const mrrSuperestimado = possivelmenteCanceladas.reduce((acc, x) => acc + (x.valor ?? 0), 0);

  return c.json({
    summary: {
      tictoApiTotalSubs: tictoSubs.length,
      tictoApiActiveOrDelayedCpfs: tictoActiveCpfs.size,
      bancoAtivaAtrasada: ours.length,
      aindaAtivas,
      possivelmenteCanceladas: possivelmenteCanceladas.length,
      mrrSuperestimado,
      // debug: contagem por situation pra diagnosticar
      statusBreakdown: Object.fromEntries(statusCounts.entries()),
    },
    possivelmenteCanceladas: possivelmenteCanceladas.slice(0, 30),
  });
});

/**
 * POST /api/audit/asaas-import-missing?token=<CRON_SECRET>
 *
 * Importa subs ACTIVE do Asaas que NÃO estão no nosso banco (gap das
 * vendas após 10/05 quando sync parou e webhook nunca chegou).
 *
 * Pra cada sub Asaas ACTIVE não encontrada no banco:
 *  - Busca customer info (email, nome, phone, cpf)
 *  - Cria lead (se email/cpf não existir) ou reusa existente
 *  - Cria sub no banco com status=ativa
 *  - Atualiza lead pra subscriptionStatus=ativa
 *
 * Idempotente: se rodar 2x, segunda vez não faz nada (já encontra a sub).
 */
auditRoutes.post("/asaas-import-missing", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);

  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return c.json({ error: "ASAAS_API_KEY não configurada" }, 500);
  const apiUrl = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");

  type AsaasSub = {
    id: string;
    status: string;
    customer: string;
    value: number;
    cycle?: string;
    description?: string;
    nextDueDate?: string;
  };
  type AsaasCustomer = {
    id: string;
    name?: string;
    email?: string;
    mobilePhone?: string;
    phone?: string;
    cpfCnpj?: string;
  };

  // 1. Lista todas subs ACTIVE do Asaas
  const asaasActive: AsaasSub[] = [];
  let offset = 0;
  while (offset < 1000) {
    const r = await fetch(`${apiUrl}/subscriptions?limit=100&offset=${offset}&status=ACTIVE`, {
      headers: { access_token: apiKey },
    });
    if (!r.ok) return c.json({ error: `Asaas API HTTP ${r.status}` }, 502);
    const data = (await r.json()) as { data?: AsaasSub[] };
    if (!data.data?.length) break;
    asaasActive.push(...data.data);
    if (data.data.length < 100) break;
    offset += 100;
  }

  // 2. Pega IDs que já estão no banco (qualquer status)
  const inDb = await db
    .select({ id: subscriptions.gatewaySubscriptionId })
    .from(subscriptions)
    .where(eq(subscriptions.gateway, "asaas"));
  const inDbSet = new Set(inDb.map((x) => x.id).filter(Boolean));

  // 3. Filtra as que faltam
  const missing = asaasActive.filter((s) => !inDbSet.has(s.id));

  const imported: Array<{
    subId: string;
    customerId: string;
    email: string | null;
    nome: string | null;
    valor: number;
    leadId: number;
    action: "created_lead" | "reused_lead";
  }> = [];
  const errors: Array<{ subId: string; error: string }> = [];

  // Helper pra normalizar telefone
  const normalizePhone = (raw?: string): string | null => {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits || null;
  };

  // Helper: detectar produto pelo plano (mesma lógica do asaas-sync)
  const detectProduto = (desc?: string, valor?: number): number => {
    if (!desc) return 1;
    if (/web designer/i.test(desc)) return 13;
    if (/lucrando com foto/i.test(desc)) return 14;
    if (/designer de prompt/i.test(desc)) return 15;
    if (/pacote avulso/i.test(desc)) return 16;
    if (/oferta principal/i.test(desc) && valor !== 47) return 17;
    return 1;
  };

  const skipped: Array<{ subId: string; reason: string; customer: string }> = [];

  for (const sub of missing) {
    try {
      // ⚠️ ANTI-FANTASMA: ANTES de tudo, checa se essa sub tem PELO MENOS 1
      // pagamento CONFIRMED/RECEIVED no Asaas. Status "ACTIVE" no Asaas
      // significa "sub habilitada" — não significa que o cliente pagou.
      // Sem essa checagem, importávamos subs onde o cliente gerou cobrança
      // mas nunca pagou (caso alroldosantos123: 2 subs ACTIVE, R$ 134 de
      // MRR fantasma).
      const payR = await fetch(
        `${apiUrl}/payments?subscription=${sub.id}&limit=10`,
        { headers: { access_token: apiKey } },
      );
      if (!payR.ok) {
        errors.push({ subId: sub.id, error: `payments HTTP ${payR.status}` });
        continue;
      }
      const payData = (await payR.json()) as {
        data?: Array<{ id: string; status: string; paymentDate?: string; confirmedDate?: string }>;
      };
      const paidPayments = (payData.data ?? []).filter(
        (p) => p.status === "CONFIRMED" || p.status === "RECEIVED" || p.status === "RECEIVED_IN_CASH",
      );
      if (paidPayments.length === 0) {
        skipped.push({
          subId: sub.id,
          customer: sub.customer,
          reason: "no_confirmed_payments (sub ACTIVE no Asaas mas cliente nunca pagou — fantasma)",
        });
        continue;
      }
      // Data do 1º pagamento confirmado (pra setar lead.pagouEm correto)
      const firstPaidDate = paidPayments
        .map((p) => p.confirmedDate || p.paymentDate)
        .filter(Boolean)
        .sort()[0];
      const pagouEmDate = firstPaidDate ? new Date(firstPaidDate) : new Date();

      // Busca customer
      const r = await fetch(`${apiUrl}/customers/${sub.customer}`, {
        headers: { access_token: apiKey },
      });
      if (!r.ok) {
        errors.push({ subId: sub.id, error: `customer HTTP ${r.status}` });
        continue;
      }
      const cust = (await r.json()) as AsaasCustomer;
      const email = cust.email?.trim().toLowerCase() || null;
      const phone = normalizePhone(cust.mobilePhone || cust.phone);
      const cpf = cust.cpfCnpj || null;
      const nome = cust.name?.trim() || "Cliente Asaas";

      // Procura lead existente (por cpf, email, telefone)
      let existingLead = null;
      if (cpf) {
        const r2 = await db.query.leads.findFirst({ where: eq(leads.gatewayCustomerId, cpf) });
        if (r2) existingLead = r2;
      }
      if (!existingLead && email) {
        const r2 = await db.query.leads.findFirst({ where: eq(leads.email, email) });
        if (r2) existingLead = r2;
      }
      if (!existingLead && phone) {
        const r2 = await db.query.leads.findFirst({ where: eq(leads.contato, phone) });
        if (r2) existingLead = r2;
      }

      const valor = Number(sub.value || 0);
      const produtoId = detectProduto(sub.description, valor);
      const periodicidade = sub.cycle === "YEARLY" ? "anual" : "mensal";
      const proximoPagamento = sub.nextDueDate ? new Date(sub.nextDueDate) : null;

      let leadId: number;
      let action: "created_lead" | "reused_lead";

      if (existingLead) {
        leadId = existingLead.id;
        action = "reused_lead";
        // Atualiza dados do lead (preserva pagouEm antigo)
        await db.update(leads)
          .set({
            subscriptionStatus: "ativa",
            gateway: "asaas",
            valorAssinatura: valor,
            planoNome: sub.description || existingLead.planoNome,
            periodicidade,
            produtoId,
            atualizadoEm: new Date(),
          })
          .where(eq(leads.id, existingLead.id));
      } else {
        // Cria lead novo
        const [created] = await db.insert(leads).values({
          nome,
          email,
          contato: phone,
          tipo: "compra_aprovada",
          status: "cliente_ativo",
          origem: "site",
          gateway: "asaas",
          gatewayCustomerId: cpf,
          subscriptionStatus: "ativa",
          valorAssinatura: valor,
          planoNome: sub.description || null,
          periodicidade,
          produtoId,
          pagouEm: pagouEmDate, // data do 1º pagamento confirmado no Asaas
        }).returning();
        leadId = created.id;
        action = "created_lead";
      }

      // Cria sub
      await db.insert(subscriptions).values({
        leadId,
        gateway: "asaas",
        gatewaySubscriptionId: sub.id,
        gatewayCustomerId: cpf,
        produtoId,
        status: "ativa",
        valor,
        planoNome: sub.description || null,
        periodicidade,
        proximoPagamentoEm: proximoPagamento,
      });

      imported.push({
        subId: sub.id,
        customerId: sub.customer,
        email,
        nome,
        valor,
        leadId,
        action,
      });
    } catch (e) {
      errors.push({
        subId: sub.id,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return c.json({
    summary: {
      asaasApiTotalActive: asaasActive.length,
      alreadyInDb: asaasActive.length - missing.length,
      missing: missing.length,
      imported: imported.length,
      skipped: skipped.length,
      errors: errors.length,
    },
    imported,
    skipped,
    errors,
  });
});

/**
 * GET /api/audit/asaas-reconcile?token=<CRON_SECRET>
 *
 * Cruza nosso banco com a API Asaas pra ver quantas subs marcadas como
 * `ativa`/`atrasada` no nosso lado ainda estão realmente ACTIVE no Asaas.
 * Sync parou em 10/05 e webhook nunca chegou → vendas/cancels do Asaas
 * desde então são invisíveis. Esse endpoint diz quantas subs nosso banco
 * está superestimando.
 *
 * Read-only — não altera nada no banco.
 */
auditRoutes.get("/asaas-reconcile", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);

  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return c.json({ error: "ASAAS_API_KEY não configurada" }, 500);
  const apiUrl = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");

  // Subs Asaas no nosso banco (ativa + atrasada)
  const ours = await db
    .select({
      id: subscriptions.id,
      leadId: subscriptions.leadId,
      subscriptionId: subscriptions.gatewaySubscriptionId,
      status: subscriptions.status,
      valor: subscriptions.valor,
      email: leads.email,
      nome: leads.nome,
    })
    .from(subscriptions)
    .leftJoin(leads, eq(leads.id, subscriptions.leadId))
    .where(
      and(
        eq(subscriptions.gateway, "asaas"),
        sql`${subscriptions.status} IN ('ativa', 'atrasada')`,
      ),
    );

  // Lista todas subs ACTIVE no Asaas (paginado, até 1000)
  type AsaasSub = { id: string; status: string; customer: string };
  const asaasActive: AsaasSub[] = [];
  let offset = 0;
  while (offset < 1000) {
    const r = await fetch(`${apiUrl}/subscriptions?limit=100&offset=${offset}&status=ACTIVE`, {
      headers: { access_token: apiKey },
    });
    if (!r.ok) {
      return c.json({ error: `Asaas API HTTP ${r.status}`, body: (await r.text()).slice(0, 200) }, 502);
    }
    const data = (await r.json()) as { data?: AsaasSub[] };
    if (!data.data?.length) break;
    asaasActive.push(...data.data);
    if (data.data.length < 100) break;
    offset += 100;
  }
  const activeIdSet = new Set(asaasActive.map((s) => s.id));

  let aindaAtivas = 0;
  let missingId = 0;
  const mudaramStatus: Array<{
    email: string | null;
    nome: string | null;
    subscriptionId: string;
    statusBanco: string;
    statusAsaas: string;
    valor: number | null;
  }> = [];
  const errors: Array<{ subscriptionId: string; error: string }> = [];

  for (const o of ours) {
    if (!o.subscriptionId) {
      missingId++;
      continue;
    }
    if (activeIdSet.has(o.subscriptionId)) {
      aindaAtivas++;
      continue;
    }
    // Não está em ACTIVE — busca individual pra ver status real
    try {
      const r = await fetch(`${apiUrl}/subscriptions/${o.subscriptionId}`, {
        headers: { access_token: apiKey },
      });
      if (r.status === 404) {
        mudaramStatus.push({
          email: o.email,
          nome: o.nome,
          subscriptionId: o.subscriptionId,
          statusBanco: o.status,
          statusAsaas: "DELETED",
          valor: o.valor,
        });
        continue;
      }
      if (!r.ok) {
        errors.push({ subscriptionId: o.subscriptionId, error: `HTTP ${r.status}` });
        continue;
      }
      const real = (await r.json()) as AsaasSub;
      mudaramStatus.push({
        email: o.email,
        nome: o.nome,
        subscriptionId: o.subscriptionId,
        statusBanco: o.status,
        statusAsaas: real.status,
        valor: o.valor,
      });
    } catch (e) {
      errors.push({
        subscriptionId: o.subscriptionId,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  const mrrSuperestimado = mudaramStatus.reduce((acc, x) => acc + (x.valor ?? 0), 0);

  return c.json({
    summary: {
      totalNoBanco: ours.length,
      aindaAtivas,
      mudaramStatus: mudaramStatus.length,
      missingId,
      errors: errors.length,
      mrrSuperestimado: Number(mrrSuperestimado.toFixed(2)),
      asaasApiTotalActive: asaasActive.length,
    },
    mudaramStatus,
    errors: errors.slice(0, 10),
  });
});

/**
 * POST /api/audit/resend-capi-event?token=<CRON_SECRET>&leadId=611
 *
 * Reenvia o evento Purchase pro Meta CAPI com Advanced Matching enriquecido
 * — usado quando uma venda chegou no Meta mas não atribuiu (sem fbp/fbc),
 * pra dar uma 2ª chance com mais sinais de matching.
 *
 * - Lê o lead + evento Stripe original em `eventos`
 * - Extrai customer_details.address pra ct/st/zp/country (Maceió → "maceio", AL → "al", etc)
 * - Decodifica client_reference_id pra recuperar campaign/adset/ad/fbp/fbc
 * - Usa event_id NOVO ("<original>-retry-1") pra evitar dedup do Meta
 * - Mantém event_time ORIGINAL pra preservar janela de atribuição
 *
 * Precisa rodar em produção (Vercel) — META_PIXEL_ID e META_CAPI_ACCESS_TOKEN
 * estão como "Sensitive" e não dá pra puxar via env pull/run.
 */
auditRoutes.post("/resend-capi-event", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);

  const leadIdRaw = c.req.query("leadId");
  const leadId = Number(leadIdRaw);
  if (!leadIdRaw || !Number.isFinite(leadId) || leadId <= 0) {
    return c.json({ error: "leadId query param required" }, 400);
  }

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  if (!lead) return c.json({ error: `lead ${leadId} not found` }, 404);
  if (!lead.pagouEm) return c.json({ error: `lead ${leadId} sem pagouEm` }, 400);
  if (!lead.valorAssinatura) return c.json({ error: `lead ${leadId} sem valor` }, 400);

  // Pega o evento Stripe ORIGINAL (mais antigo compra_aprovada) pra extrair address
  // e o cs_live_* original.
  const evs = await db
    .select()
    .from(eventos)
    .where(
      and(
        eq(eventos.leadId, leadId),
        eq(eventos.source, "stripe"),
        eq(eventos.eventType, "compra_aprovada"),
      ),
    )
    .orderBy(eventos.receivedAt)
    .limit(1);
  const stripeEvent = evs[0];
  if (!stripeEvent) {
    return c.json({ error: `sem compra_aprovada Stripe pro lead ${leadId}` }, 404);
  }

  const payload = stripeEvent.payload as Record<string, unknown> | null;
  const data = (payload?.data ?? {}) as Record<string, unknown>;
  const obj = (data.object ?? {}) as Record<string, unknown>;
  const cd = (obj.customer_details ?? {}) as Record<string, unknown>;
  const addr = (cd.address ?? {}) as Record<string, unknown>;
  const cri = String(obj.client_reference_id ?? "");
  const originalSessionId = String(obj.id ?? lead.gatewayLastOrderId ?? "");
  if (!originalSessionId) {
    return c.json({ error: `sem session_id no payload original` }, 400);
  }

  // Decodifica atribuição (campaign/adset/ad/fbp/fbc/plan).
  // O JS da LP codifica fbp/fbc com `_` em vez de `.` pra caber no formato Stripe
  // (alphanumeric + dash + underscore). Convertemos de volta antes de mandar pro Meta.
  const attr = decodeAttribution(cri);
  const fbp = attr.fbp ? String(attr.fbp).replace(/_/g, ".") : null;
  const fbc = attr.fbc ? String(attr.fbc).replace(/_/g, ".") : null;

  // Extrai IDs numéricos do Meta (mesmo helper do webhook handler).
  const extractMetaId = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const m = String(raw).match(/(\d{15,18})(?!\d)/);
    return m ? m[1] : null;
  };
  const campaignIdNumeric = extractMetaId(attr.cmp);
  const adsetIdNumeric = extractMetaId(attr.adset);
  const adIdNumeric = extractMetaId(attr.ad);

  // Nome → first + last
  const nome = String(cd.name ?? lead.nome);
  const parts = nome.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;

  // event_id NOVO evita dedup do Meta com o envio original
  const eventId = `${originalSessionId}-retry-1`;
  const eventTime = Math.floor(new Date(lead.pagouEm).getTime() / 1000);

  const signals = {
    email: lead.email,
    phone: lead.contato,
    firstName,
    lastName,
    city: addr.city ? String(addr.city) : null,
    state: addr.state ? String(addr.state) : null,
    zip: addr.postal_code ? String(addr.postal_code) : null,
    country: addr.country ? String(addr.country) : null,
    externalId: lead.gatewayCustomerId,
    fbp,
    fbc,
    campaign: attr.cmp ?? null,
    adset: attr.adset ?? null,
    ad: attr.ad ?? null,
    campaignIdNumeric,
    adsetIdNumeric,
    adIdNumeric,
    plan: attr.plan ?? lead.planoNome ?? null,
  };

  const meta = await sendPurchaseToMeta({
    eventId,
    eventTime,
    eventSourceUrl: "https://gravyx.com.br/obrigado",
    email: signals.email,
    phone: signals.phone,
    firstName: signals.firstName,
    lastName: signals.lastName,
    city: signals.city,
    state: signals.state,
    zip: signals.zip,
    country: signals.country,
    externalId: signals.externalId,
    fbp: signals.fbp,
    fbc: signals.fbc,
    value: lead.valorAssinatura,
    currency: "BRL",
    plan: signals.plan,
    campaign: signals.campaign,
    adset: signals.adset,
    ad: signals.ad,
    campaignIdNumeric: signals.campaignIdNumeric,
    adsetIdNumeric: signals.adsetIdNumeric,
    adIdNumeric: signals.adIdNumeric,
  });

  return c.json({
    leadId,
    nome: lead.nome,
    originalSessionId,
    retryEventId: eventId,
    eventTime,
    signalsSent: signals,
    meta,
  });
});

/**
 * GET /api/audit/faturamento-gateways?since=YYYY-MM-DD&until=YYYY-MM-DD&token=<CRON_SECRET>
 *
 * Audita o faturamento consultando DIRETAMENTE as APIs de Stripe, Asaas
 * e Ticto — não passa pelo nosso banco. Útil pra validar números do
 * dashboard contra a fonte da verdade.
 *
 * Retorna, por gateway: vendas brutas, reembolsos, líquido + counts.
 * Datas em BRT (timezone fixo America/Sao_Paulo).
 */
auditRoutes.get("/faturamento-gateways", async (c) => {
  if (!isAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const sinceStr = c.req.query("since");
  const untilStr = c.req.query("until");
  if (!sinceStr || !untilStr) return c.json({ error: "since e until obrigatórios (YYYY-MM-DD)" }, 400);

  // Converte YYYY-MM-DD BRT pra timestamps UTC (start of day BRT = 03:00 UTC)
  const sinceUtc = new Date(`${sinceStr}T00:00:00-03:00`);
  const untilUtc = new Date(`${untilStr}T23:59:59-03:00`);
  if (Number.isNaN(sinceUtc.getTime()) || Number.isNaN(untilUtc.getTime())) {
    return c.json({ error: "datas inválidas" }, 400);
  }
  const sinceUnix = Math.floor(sinceUtc.getTime() / 1000);
  const untilUnix = Math.floor(untilUtc.getTime() / 1000);

  // ─── STRIPE ─────────────────────────────────────────────
  // Usa balance_transactions pra pegar valor líquido (sem taxa Stripe ainda — net é em centavos
  // já descontado o fee da Stripe). Mas pra paridade com Stripe Dashboard "Receita líquida",
  // somamos amount (bruto) e amount refundado separadamente.
  type StripeBxn = {
    id: string;
    type: string;
    amount: number;
    currency: string;
    created: number;
    status: string;
  };
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const stripeRes: {
    grossCents: number;
    refundCents: number;
    netCents: number;
    chargeCount: number;
    refundCount: number;
    error?: string;
  } = { grossCents: 0, refundCents: 0, netCents: 0, chargeCount: 0, refundCount: 0 };
  const stripeViaCharges: { brutoBRL: number; refundBRL: number; liquidoBRL: number; charges: number; oldest?: string; newest?: string } = { brutoBRL: 0, refundBRL: 0, liquidoBRL: 0, charges: 0 };
  if (!stripeKey) {
    stripeRes.error = "STRIPE_SECRET_KEY ausente";
  } else {
    let starting_after: string | undefined;
    const seen = new Set<string>();
    while (true) {
      const p = new URLSearchParams({
        limit: "100",
        "created[gte]": String(sinceUnix),
        "created[lte]": String(untilUnix),
      });
      if (starting_after) p.set("starting_after", starting_after);
      const r = await fetch(`https://api.stripe.com/v1/balance_transactions?${p}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!r.ok) { stripeRes.error = `Stripe HTTP ${r.status}`; break; }
      const body = (await r.json()) as { data: StripeBxn[]; has_more: boolean };
      for (const tx of body.data) {
        if (seen.has(tx.id)) continue;
        seen.add(tx.id);
        if (tx.currency !== "brl") continue;
        if (tx.status !== "available" && tx.status !== "pending") continue;
        if (tx.type === "charge" || tx.type === "payment") {
          stripeRes.grossCents += tx.amount;
          stripeRes.chargeCount++;
        } else if (tx.type === "refund" || tx.type === "payment_refund") {
          // amount vem negativo
          stripeRes.refundCents += Math.abs(tx.amount);
          stripeRes.refundCount++;
        }
      }
      if (!body.has_more || body.data.length === 0) break;
      starting_after = body.data[body.data.length - 1].id;
      if (seen.size > 5000) break;
    }
    stripeRes.netCents = stripeRes.grossCents - stripeRes.refundCents;

    // Cross-check via /charges (sem filtro de período — pega histórico completo)
    type StripeCharge = { id: string; amount: number; amount_refunded: number; currency: string; paid: boolean; status: string; created: number };
    let sa: string | undefined;
    let oldestTs = Infinity, newestTs = 0;
    while (true) {
      const p = new URLSearchParams({
        limit: "100",
        "created[gte]": String(sinceUnix),
        "created[lte]": String(untilUnix),
      });
      if (sa) p.set("starting_after", sa);
      const r2 = await fetch(`https://api.stripe.com/v1/charges?${p}`, { headers: { Authorization: `Bearer ${stripeKey}` } });
      if (!r2.ok) { stripeViaCharges.brutoBRL = -1; break; }
      const b2 = (await r2.json()) as { data: StripeCharge[]; has_more: boolean };
      for (const ch of b2.data) {
        if (ch.currency !== "brl") continue;
        if (!ch.paid || ch.status !== "succeeded") continue;
        stripeViaCharges.brutoBRL += ch.amount / 100;
        stripeViaCharges.refundBRL += (ch.amount_refunded ?? 0) / 100;
        stripeViaCharges.charges++;
        if (ch.created < oldestTs) oldestTs = ch.created;
        if (ch.created > newestTs) newestTs = ch.created;
      }
      if (!b2.has_more || b2.data.length === 0) break;
      sa = b2.data[b2.data.length - 1].id;
      if (stripeViaCharges.charges > 5000) break;
    }
    stripeViaCharges.liquidoBRL = stripeViaCharges.brutoBRL - stripeViaCharges.refundBRL;
    if (oldestTs !== Infinity) stripeViaCharges.oldest = new Date(oldestTs * 1000).toISOString();
    if (newestTs) stripeViaCharges.newest = new Date(newestTs * 1000).toISOString();
  }

  // ─── ASAAS ──────────────────────────────────────────────
  // GET /api/v3/payments com filtro status + paymentDate (data de recebimento real)
  type AsaasPayment = {
    id: string;
    status: string;
    value: number;
    netValue: number;
    paymentDate?: string | null;
    refundedValue?: number;
    description?: string | null;
    subscription?: string | null;
  };
  const asaasKey = process.env.ASAAS_API_KEY;
  const asaasRes: {
    grossReais: number;
    refundReais: number;
    netReais: number;
    receivedCount: number;
    refundCount: number;
    error?: string;
  } = { grossReais: 0, refundReais: 0, netReais: 0, receivedCount: 0, refundCount: 0 };
  if (!asaasKey) {
    asaasRes.error = "ASAAS_API_KEY ausente";
  } else {
    // Pagamentos recebidos no período
    let offset = 0;
    const limit = 100;
    const productMap = new Map<string, { count: number; valor: number }>();
    while (true) {
      const p = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        status: "RECEIVED",
        "paymentDate[ge]": sinceStr,
        "paymentDate[le]": untilStr,
      });
      const r = await fetch(`https://api.asaas.com/v3/payments?${p}`, {
        headers: { access_token: asaasKey, "Content-Type": "application/json" },
      });
      if (!r.ok) { asaasRes.error = `Asaas RECEIVED HTTP ${r.status}`; break; }
      const body = (await r.json()) as { data: AsaasPayment[]; hasMore: boolean };
      for (const pmt of body.data) {
        asaasRes.grossReais += pmt.value;
        asaasRes.receivedCount++;
        // Agrupa por descrição (Asaas não tem campo "product" — descrição costuma
        // ter o nome do plano/produto). Normaliza por prefixo pra agrupar
        // renovações ("Mensalidade Gravyx · 2026-05" → "Mensalidade Gravyx").
        const raw = pmt.description ?? "(sem descrição)";
        const key = raw.split(/\s*[·\-—|]\s*\d/)[0].trim().slice(0, 80) || raw;
        const cur = productMap.get(key) ?? { count: 0, valor: 0 };
        cur.count++;
        cur.valor += pmt.value;
        productMap.set(key, cur);
      }
      if (!body.hasMore || body.data.length === 0) break;
      offset += limit;
      if (offset > 5000) break;
    }
    (asaasRes as unknown as { porDescricao?: unknown }).porDescricao = Array.from(productMap.entries())
      .map(([nome, v]) => ({ nome, vendas: v.count, brutoBRL: Number(v.valor.toFixed(2)) }))
      .sort((a, b) => b.brutoBRL - a.brutoBRL);
    // Reembolsos no período (status REFUNDED + refundedDate)
    // OBS: Asaas não filtra direto por refundedDate, então puxa REFUNDED + filtra no app
    offset = 0;
    while (true) {
      const p = new URLSearchParams({ limit: String(limit), offset: String(offset), status: "REFUNDED" });
      const r = await fetch(`https://api.asaas.com/v3/payments?${p}`, {
        headers: { access_token: asaasKey, "Content-Type": "application/json" },
      });
      if (!r.ok) { asaasRes.error = (asaasRes.error ?? "") + ` | REFUNDED HTTP ${r.status}`; break; }
      const body = (await r.json()) as { data: Array<AsaasPayment & { refundedDate?: string | null }>; hasMore: boolean };
      for (const pmt of body.data) {
        const rDate = pmt.refundedDate ?? pmt.paymentDate;
        if (!rDate) continue;
        if (rDate >= sinceStr && rDate <= untilStr) {
          asaasRes.refundReais += pmt.refundedValue ?? pmt.value;
          asaasRes.refundCount++;
        }
      }
      if (!body.hasMore || body.data.length === 0) break;
      offset += limit;
      if (offset > 5000) break;
    }
    asaasRes.netReais = asaasRes.grossReais - asaasRes.refundReais;
  }

  // ─── TICTO ──────────────────────────────────────────────
  // Usa o helper existente. Filtros: status=authorized/approved, paid_at no range.
  type TictoOrder = {
    id?: number;
    status?: string;
    amount?: number;
    paid_amount?: number;
    paid_at?: string | null;
    refunded_at?: string | null;
    transaction?: { amount?: number; paid_amount?: number };
    order?: { amount?: number; paid_amount?: number };
    item?: { amount?: number };
  };
  function tictoValueCents(o: TictoOrder): number {
    return (
      o.transaction?.paid_amount ??
      o.transaction?.amount ??
      o.order?.paid_amount ??
      o.order?.amount ??
      o.item?.amount ??
      o.paid_amount ??
      o.amount ??
      0
    );
  }
  const tictoRes: {
    grossReais: number;
    refundReais: number;
    netReais: number;
    paidCount: number;
    refundCount: number;
    error?: string;
  } = { grossReais: 0, refundReais: 0, netReais: 0, paidCount: 0, refundCount: 0 };
  try {
    // Ticto: filter[betweenDates] formato MM/DD/YYYY,MM/DD/YYYY
    const [sy, sm, sd] = sinceStr.split("-");
    const [uy, um, ud] = untilStr.split("-");
    const betweenDates = `${sm}/${sd}/${sy},${um}/${ud}/${uy}`;
    const { getOrdersHistory } = await import("../lib/ticto-api.js");

    let page = 1;
    let sampleOrder: TictoOrder | null = null;
    const productNames = new Map<string, { count: number; valor: number }>();
    while (true) {
      const resp = (await getOrdersHistory(page, {
        status: "authorized",
        betweenDates,
      })) as { data?: TictoOrder[]; meta?: { last_page?: number } };
      const list = resp.data ?? [];
      if (!sampleOrder && list.length > 0) sampleOrder = list[0];
      for (const o of list) {
        const valueCents = tictoValueCents(o);
        tictoRes.grossReais += valueCents / 100;
        tictoRes.paidCount++;
        // Tenta achar nome do produto em vários lugares possíveis
        const oo = o as unknown as Record<string, unknown> & {
          item?: { product_name?: string };
          product?: { name?: string };
          offer?: { product_name?: string; name?: string };
        };
        const pname = oo.item?.product_name
          ?? oo.product?.name
          ?? oo.offer?.product_name
          ?? oo.offer?.name
          ?? "(sem nome)";
        const cur = productNames.get(pname) ?? { count: 0, valor: 0 };
        cur.count++;
        cur.valor += valueCents / 100;
        productNames.set(pname, cur);
      }
      const last = resp.meta?.last_page ?? 1;
      if (page >= last || list.length === 0) break;
      page++;
      if (page > 50) break;
    }
    // Reembolsos
    page = 1;
    while (true) {
      const resp = (await getOrdersHistory(page, {
        status: "refunded",
        betweenDates,
      })) as { data?: TictoOrder[]; meta?: { last_page?: number } };
      const list = resp.data ?? [];
      for (const o of list) {
        const valueCents = tictoValueCents(o);
        tictoRes.refundReais += valueCents / 100;
        tictoRes.refundCount++;
      }
      const last = resp.meta?.last_page ?? 1;
      if (page >= last || list.length === 0) break;
      page++;
      if (page > 50) break;
    }
    tictoRes.netReais = tictoRes.grossReais - tictoRes.refundReais;
    (tictoRes as unknown as { sample?: unknown }).sample = sampleOrder ? Object.keys(sampleOrder) : null;
    (tictoRes as unknown as { porProduto?: unknown }).porProduto = Array.from(productNames.entries())
      .map(([nome, v]) => ({ nome, vendas: v.count, brutoBRL: Number(v.valor.toFixed(2)) }))
      .sort((a, b) => b.brutoBRL - a.brutoBRL);
  } catch (e) {
    tictoRes.error = String(e);
  }

  const stripeReais = {
    gross: stripeRes.grossCents / 100,
    refund: stripeRes.refundCents / 100,
    net: stripeRes.netCents / 100,
  };
  const totalGross = stripeReais.gross + asaasRes.grossReais + tictoRes.grossReais;
  const totalRefund = stripeReais.refund + asaasRes.refundReais + tictoRes.refundReais;
  const totalNet = totalGross - totalRefund;

  return c.json({
    periodo: { since: sinceStr, until: untilStr, timezone: "America/Sao_Paulo" },
    stripe: {
      brutoBRL: Number(stripeReais.gross.toFixed(2)),
      reembolsosBRL: Number(stripeReais.refund.toFixed(2)),
      liquidoBRL: Number(stripeReais.net.toFixed(2)),
      compras: stripeRes.chargeCount,
      refunds: stripeRes.refundCount,
      error: stripeRes.error,
    },
    stripeViaCharges: {
      brutoBRL: Number(stripeViaCharges.brutoBRL.toFixed(2)),
      reembolsosBRL: Number(stripeViaCharges.refundBRL.toFixed(2)),
      liquidoBRL: Number(stripeViaCharges.liquidoBRL.toFixed(2)),
      charges: stripeViaCharges.charges,
      oldest: stripeViaCharges.oldest,
      newest: stripeViaCharges.newest,
    },
    asaas: {
      brutoBRL: Number(asaasRes.grossReais.toFixed(2)),
      reembolsosBRL: Number(asaasRes.refundReais.toFixed(2)),
      liquidoBRL: Number(asaasRes.netReais.toFixed(2)),
      compras: asaasRes.receivedCount,
      refunds: asaasRes.refundCount,
      error: asaasRes.error,
      porDescricao: (asaasRes as unknown as { porDescricao?: unknown }).porDescricao ?? [],
    },
    ticto: {
      brutoBRL: Number(tictoRes.grossReais.toFixed(2)),
      reembolsosBRL: Number(tictoRes.refundReais.toFixed(2)),
      liquidoBRL: Number(tictoRes.netReais.toFixed(2)),
      compras: tictoRes.paidCount,
      refunds: tictoRes.refundCount,
      error: tictoRes.error,
      porProduto: (tictoRes as unknown as { porProduto?: unknown }).porProduto ?? [],
      sample: (tictoRes as unknown as { sample?: unknown }).sample ?? null,
    },
    total: {
      brutoBRL: Number(totalGross.toFixed(2)),
      reembolsosBRL: Number(totalRefund.toFixed(2)),
      liquidoBRL: Number(totalNet.toFixed(2)),
    },
  });
});
