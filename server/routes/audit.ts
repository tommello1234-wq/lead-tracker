/**
 * Endpoints de auditoria read-only — comparam fontes externas (Ticto API,
 * Stripe, Asaas) com o estado no banco. Não escrevem nada.
 *
 * Uso: GET /api/audit/ticto?token=<CRON_SECRET>
 */
import { Hono } from "hono";
import { db } from "../../db/client.js";
import { subscriptions, leads } from "../../db/schema.js";
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
  for (const s of tictoSubs) {
    const sit = String((s.situation ?? s.status ?? "")).toLowerCase();
    tictoByStatus[sit] = (tictoByStatus[sit] ?? 0) + 1;
    if (sit === "ativa" || sit === "active") {
      tictoActiveCount++;
      const valor = Number(s.amount ?? 0) / 100;
      const period = String(s.periodicity ?? s.periodicidade ?? "monthly").toLowerCase();
      if (period.includes("anual") || period === "yearly") tictoMrr += valor / 12;
      else tictoMrr += valor;
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
    const sit = String((ts.situation ?? ts.status ?? "")).toLowerCase();
    const customer = (ts.customer as Record<string, unknown>) ?? {};
    const email = String(customer.email ?? "").toLowerCase();
    const cpf = String(customer.cpf ?? customer.cnpj ?? "");
    const tictoValor = Number(ts.amount ?? 0) / 100;
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
    const sit = String((ts.situation ?? ts.status ?? "")).toLowerCase();
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
    issues: issues.slice(0, 50),
    orphanActive: orphanActive.slice(0, 20).map((s) => ({
      leadId: s.leadId,
      nome: s.leadNome,
      email: s.leadEmail,
      planoNome: s.planoNome,
      valor: s.valor,
    })),
  });
});
