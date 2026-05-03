import { db } from "../../db/client.js";
import { leads, mensagensAgendadas, eventos, type Lead } from "../../db/schema.js";
import { desc, eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { withCache } from "./cache.js";

/**
 * Helper: where clause de produto. Retorna array de condições pra serem
 * combinadas com `and()`. Se produtoId é null, sem filtro.
 */
function produtoCondition(produtoId: number | null) {
  return produtoId == null ? [] : [eq(leads.produtoId, produtoId)];
}

export async function getAllLeads(
  produtoId: number | null = null,
  since: Date | null = null,
  until: Date | null = null,
): Promise<Lead[]> {
  const cond = produtoCondition(produtoId);
  if (since != null) cond.push(gte(leads.criadoEm, since));
  if (until != null) cond.push(lte(leads.criadoEm, until));
  if (cond.length === 0) {
    return db.select().from(leads).orderBy(desc(leads.criadoEm));
  }
  return db
    .select()
    .from(leads)
    .where(and(...cond))
    .orderBy(desc(leads.criadoEm));
}

/**
 * Contagens leves usadas como badges na sidebar.
 * Cache de 30s pra evitar rodar 2 queries a cada navegacao.
 * Não filtra por produto (badge global).
 */
export const getSidebarCounts = withCache(
  async (): Promise<{ emRisco: number; filaMensagens: number }> => {
    const [risco] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(inArray(leads.status, ["cliente_em_risco", "pix_gerado"]));

    const [fila] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(mensagensAgendadas)
      .where(eq(mensagensAgendadas.status, "pending"));

    return {
      emRisco: risco?.n ?? 0,
      filaMensagens: fila?.n ?? 0,
    };
  },
  "sidebar-counts",
  30,
);

export type DashboardMetrics = {
  totalLeads: number;
  novosLeadsNoPeriodo: number;
  vendasHoje: number;
  vendasMes: number;
  mrr: number;
  mrrPotencial: number;
  arpu: number;
  ltv: number;
  avgLifetimeMonths: number;
  clientesAtivos: number;
  pixGerados: number;
  pixPagos: number;
  pixExpirados: number;
  taxaConversaoPix: number;
  receitaPerdidaPix: number;
  filaSuporte: number;
  mensagensEnviadasHoje: number;
  emRisco: number;
  cancelados: number;
  reembolsos: number;
  receitaTotal: number;
  ticketMedio: number;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d: Date) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function getDashboardMetrics(
  produtoId: number | null = null,
  since: Date | null = null,
  until: Date | null = null,
): Promise<DashboardMetrics> {
  const cond = produtoCondition(produtoId);
  const all = cond.length === 0
    ? await db.select().from(leads)
    : await db.select().from(leads).where(and(...cond));
  const today = startOfDay(new Date());
  const monthStart = startOfMonth(new Date());

  // Helper: testa se data cai no período [since, until]. null = aberto.
  const inPeriod = (d: Date | null | undefined): boolean => {
    if (!d) return false;
    if (since && d < since) return false;
    if (until && d > until) return false;
    return true;
  };

  // MRR e clientesAtivos sempre snapshot atual (não dependem de período).
  const clientesAtivos = all.filter((l) => l.subscriptionStatus === "ativa");
  const mrr = clientesAtivos.reduce((acc, l) => acc + (l.valorAssinatura ?? 0), 0);

  // Receita do PERÍODO selecionado (compras pagas no intervalo).
  // Se since=null e until=null, conta histórico todo.
  const pixPagosTotal = all.filter((l) => l.pagouEm != null);
  const pixPagosNoPeriodo =
    since || until
      ? pixPagosTotal.filter((l) => inPeriod(l.pagouEm))
      : pixPagosTotal;

  // Cohort de PIX no período: leads que GERARAM PIX dentro da janela.
  const pixGeradosNoPeriodo =
    since || until
      ? all.filter((l) => inPeriod(l.pixGeradoEm))
      : all.filter((l) => l.pixGeradoEm != null);
  const pixPagosCohort = pixGeradosNoPeriodo.filter((l) => l.pagouEm != null);
  const pixExpiradosNoPeriodo = pixGeradosNoPeriodo.filter(
    (l) => l.status === "pix_expirado",
  );

  const vendasHoje = all.filter((l) => l.pagouEm && l.pagouEm >= today);
  const vendasMes = all.filter((l) => l.pagouEm && l.pagouEm >= monthStart);

  const mrrPotencial =
    mrr +
    all
      .filter((l) => l.subscriptionStatus === "aguardando_pagamento")
      .reduce((acc, l) => acc + (l.valorAssinatura ?? 0), 0);

  const receitaPerdidaPix = pixExpiradosNoPeriodo.reduce(
    (acc, l) => acc + (l.valorAssinatura ?? l.valorEstimado ?? 0),
    0,
  );

  const receitaTotal = pixPagosNoPeriodo.reduce(
    (acc, l) => acc + (l.valorAssinatura ?? l.valorEstimado ?? 0),
    0,
  );
  const ticketMedio =
    pixPagosNoPeriodo.length > 0 ? receitaTotal / pixPagosNoPeriodo.length : 0;

  // Mensagens — sempre globais (não filtra por produto, todo mundo no mesmo zap)
  const pendingMsgs = await db
    .select()
    .from(mensagensAgendadas)
    .where(eq(mensagensAgendadas.status, "pending"));

  const sentToday = await db
    .select()
    .from(mensagensAgendadas)
    .where(
      and(
        eq(mensagensAgendadas.status, "sent"),
        gte(mensagensAgendadas.enviadoEm, today),
      ),
    );

  // Novos leads no período (filtra por criado_em na janela)
  const novosLeadsNoPeriodo =
    since || until
      ? all.filter((l) => inPeriod(l.criadoEm)).length
      : all.length;

  // LTV (Lifetime Value): fórmula SaaS clássica = ARPU / churn mensal.
  // Churn 30d = % de clientes ativos hoje que cancelaram nos últimos 30 dias.
  // Tempo médio esperado = 1 / churn mensal (em meses).
  // LTV = ARPU * tempo médio esperado.
  //
  // Antes usava "média de tempo desde pagamento" — quebrava porque clientes
  // que pagaram esta semana puxam a média pra ~0.25 mês, dando LTV irrealista
  // (ex: R$ 14 quando o real seria R$ 1000+).
  const arpu = clientesAtivos.length > 0 ? mrr / clientesAtivos.length : 0;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const churnedIn30d = all.filter(
    (l) => l.canceladoEm && l.canceladoEm >= thirtyDaysAgo,
  ).length;
  // base = ativos hoje + os que cancelaram nesses 30d (= ativos 30 dias atrás aproximado)
  const activeBackThen = clientesAtivos.length + churnedIn30d;
  const monthlyChurnRate =
    activeBackThen > 0 ? churnedIn30d / activeBackThen : 0;
  // Cap em 24 meses quando churn = 0 (ainda não dá pra projetar com confiança)
  const avgLifetimeMonths = monthlyChurnRate > 0 ? 1 / monthlyChurnRate : 24;
  const ltv = arpu * avgLifetimeMonths;

  return {
    totalLeads: all.length,
    novosLeadsNoPeriodo,
    vendasHoje: vendasHoje.length,
    vendasMes: vendasMes.length,
    mrr,
    mrrPotencial,
    arpu,
    ltv,
    avgLifetimeMonths,
    clientesAtivos: clientesAtivos.length,
    pixGerados: pixGeradosNoPeriodo.length,
    pixPagos: pixPagosCohort.length,
    pixExpirados: pixExpiradosNoPeriodo.length,
    taxaConversaoPix:
      pixGeradosNoPeriodo.length > 0
        ? pixPagosCohort.length / pixGeradosNoPeriodo.length
        : 0,
    receitaPerdidaPix,
    filaSuporte: pendingMsgs.length,
    mensagensEnviadasHoje: sentToday.length,
    emRisco: all.filter((l) => l.status === "cliente_em_risco").length,
    cancelados: all.filter((l) => l.status === "cliente_cancelado").length,
    reembolsos: all.filter((l) => l.subscriptionStatus === "reembolsada").length,
    receitaTotal,
    ticketMedio,
  };
}

export type DailyMetric = {
  date: string;
  entradas: number;
  convertidos: number;
  taxaConversao: number;
};

/**
 * Série diária pra gráficos de volume (entradas/convertidos por dia).
 * A `taxaConversao` aqui usa a definição clássica de funil:
 *   pagaram / tentaram (rolling 7d, suaviza dias com baixo volume)
 *
 * "Tentaram" = leads únicos que tiveram qualquer evento de intenção de compra
 *              nos últimos 7 dias até o dia X (pix_gerado, carrinho_abandonado,
 *              compra_recusada, pix_expirado, compra_aprovada, assinatura_renovada).
 *
 * "Pagaram" = leads únicos que tiveram compra_aprovada ou assinatura_renovada
 *             nos últimos 7 dias até o dia X.
 */
export async function getDailySeries(
  days = 30,
  produtoId: number | null = null,
): Promise<DailyMetric[]> {
  const cond = produtoCondition(produtoId);
  const all = cond.length === 0
    ? await db.select().from(leads)
    : await db.select().from(leads).where(and(...cond));
  const today = startOfDay(new Date());

  // Pra cada dia: entradas (criado_em do dia) + convertidos (pagou_em do dia)
  // pra o gráfico de volume. Taxa usa cohort acumulado dos últimos 7d via SQL.
  const dailySeries: DailyMetric[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);

    const entradas = all.filter(
      (l) => l.criadoEm >= day && l.criadoEm < next,
    ).length;
    const convertidos = all.filter(
      (l) => l.pagouEm && l.pagouEm >= day && l.pagouEm < next,
    ).length;

    // Rolling 7d cohort: leads únicos que TENTARAM (qualquer evento de intenção)
    // nos últimos 7 dias até "next", e dos que TENTARAM, quantos PAGARAM
    const sevenDaysAgo = new Date(next);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // postgres-js em modo prepare:false não aceita Date como param — converte ISO
    const sinceIso = sevenDaysAgo.toISOString();
    const untilIso = next.toISOString();

    const tentou = await db.execute<{ tentou: number; pagou: number }>(sql`
      with tentou_ids as (
        select distinct lead_id
        from eventos
        where lead_id is not null
          and event_type in ('pix_gerado', 'carrinho_abandonado', 'compra_recusada',
                              'pix_expirado', 'compra_aprovada', 'assinatura_renovada')
          and received_at >= ${sinceIso}::timestamp
          and received_at < ${untilIso}::timestamp
          ${produtoId != null ? sql`and produto_id = ${produtoId}` : sql``}
      ),
      pagou_ids as (
        select distinct lead_id
        from eventos
        where lead_id is not null
          and event_type in ('compra_aprovada', 'assinatura_renovada')
          and received_at >= ${sinceIso}::timestamp
          and received_at < ${untilIso}::timestamp
          ${produtoId != null ? sql`and produto_id = ${produtoId}` : sql``}
      )
      select
        (select count(*)::int from tentou_ids) as tentou,
        (select count(*)::int from pagou_ids) as pagou
    `);
    const r = (tentou as unknown as Array<{ tentou: number; pagou: number }>)[0];
    const taxa = r && r.tentou > 0 ? r.pagou / r.tentou : 0;

    dailySeries.push({
      date: day.toISOString().slice(0, 10),
      entradas,
      convertidos,
      taxaConversao: taxa,
    });
  }
  return dailySeries;
}

export type TipoBreakdown = { tipo: string; total: number };

export async function getTipoBreakdown(
  produtoId: number | null = null,
): Promise<TipoBreakdown[]> {
  const cond = produtoCondition(produtoId);
  const all = cond.length === 0
    ? await db.select().from(leads)
    : await db.select().from(leads).where(and(...cond));
  const counts = new Map<string, number>();
  for (const l of all) {
    counts.set(l.tipo, (counts.get(l.tipo) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([tipo, total]) => ({ tipo, total }));
}

/**
 * Faturamento real no período: soma de TODAS as transações de compra_aprovada
 * e assinatura_renovada, filtradas por produto/período.
 *
 * Fonte: tabela `eventos` (cada evento = 1 transação). Suporta payload de:
 *  - importação CSV (`payload.valor` em reais)
 *  - Ticto v2 webhook (`payload.item.amount` em centavos)
 *  - Stripe webhook (`payload.data.object.amount_total` em centavos)
 *  - fallback: `valor_assinatura` do lead vinculado
 */
export async function getFaturamento(
  produtoId: number | null = null,
  since: Date | null = null,
  until: Date | null = null,
): Promise<{ count: number; total: number }> {
  const conditions = [
    inArray(eventos.eventType, ["compra_aprovada", "assinatura_renovada"]),
    eq(eventos.processedOk, true),
  ];
  if (produtoId != null) conditions.push(eq(eventos.produtoId, produtoId));
  if (since != null) conditions.push(gte(eventos.receivedAt, since));
  if (until != null) conditions.push(lte(eventos.receivedAt, until));

  // Extrai valor com fallbacks pros vários formatos de payload
  const valorExpr = sql<number>`coalesce(
    (${eventos.payload}->>'valor')::numeric,
    ((${eventos.payload}->'item'->>'amount')::numeric / 100),
    ((${eventos.payload}->'data'->'object'->>'amount_total')::numeric / 100),
    (select valor_assinatura from leads where id = ${eventos.leadId}),
    0
  )::numeric(10,2)`;

  const [r] = await db
    .select({
      n: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${valorExpr}), 0)::numeric(10,2)`,
    })
    .from(eventos)
    .where(and(...conditions));

  return {
    count: r?.n ?? 0,
    total: Number(r?.total ?? 0),
  };
}

export type PlanoBreakdown = {
  plano: string;
  total: number;
  receita: number;
  ativos: number;
};

/**
 * Breakdown de planos por nome (ex: "Gravyx Creator", "Gravyx Studio").
 * Usado pro gráfico de pizza no dashboard.
 */
export async function getPlanoBreakdown(
  produtoId: number | null = null,
): Promise<PlanoBreakdown[]> {
  const cond = produtoCondition(produtoId);
  const all = cond.length === 0
    ? await db.select().from(leads)
    : await db.select().from(leads).where(and(...cond));

  const map = new Map<string, { total: number; receita: number; ativos: number }>();
  for (const l of all) {
    const key = (l.planoNome ?? "Sem plano").trim() || "Sem plano";
    const cur = map.get(key) ?? { total: 0, receita: 0, ativos: 0 };
    cur.total++;
    if (l.subscriptionStatus === "ativa") {
      cur.ativos++;
      cur.receita += l.valorAssinatura ?? 0;
    } else if (l.pagouEm) {
      cur.receita += l.valorAssinatura ?? l.valorEstimado ?? 0;
    }
    map.set(key, cur);
  }

  return Array.from(map.entries())
    .map(([plano, v]) => ({ plano, ...v }))
    .sort((a, b) => b.total - a.total);
}
