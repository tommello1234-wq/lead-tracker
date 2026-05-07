import { db } from "../../db/client.js";
import { leads, mensagensAgendadas, eventos, produtos, subscriptions, type Lead } from "../../db/schema.js";
import { desc, eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { withCache } from "./cache.js";

/**
 * Helper: where clause de produto.
 *
 * - produtoId != null: filtra por aquele produto específico
 * - produtoId == null ("Todos"): exclui leads de produtos descontinuados
 *   (ativo=false), ex: "Gravyx Lançamento". Leads sem produto associado
 *   (produtoId=null) continuam aparecendo.
 *
 * Retorna array de condições pra serem combinadas com `and()`.
 */
function produtoCondition(produtoId: number | null) {
  if (produtoId != null) return [eq(leads.produtoId, produtoId)];
  // "Todos" — exclui produtos inativos
  return [
    sql`(${leads.produtoId} IS NULL OR ${leads.produtoId} IN (SELECT id FROM ${produtos} WHERE ativo = true))`,
  ];
}

export async function getAllLeads(
  produtoId: number | null = null,
  since: Date | null = null,
  until: Date | null = null,
): Promise<Lead[]> {
  const cond = produtoCondition(produtoId);
  if (since != null) cond.push(gte(leads.criadoEm, since));
  if (until != null) cond.push(lte(leads.criadoEm, until));
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
  totalAssinantes: number;
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
  const all = await db.select().from(leads).where(and(...cond));
  const today = startOfDay(new Date());
  const monthStart = startOfMonth(new Date());

  // Helper: testa se data cai no período [since, until]. null = aberto.
  const inPeriod = (d: Date | null | undefined): boolean => {
    if (!d) return false;
    if (since && d < since) return false;
    if (until && d > until) return false;
    return true;
  };

  // MRR e clientesAtivos = somar das subscriptions ativas (1 lead pode ter N subs).
  // MRR normaliza por periodicidade: anuais entram como /12, vitalícios/grátis não contam.
  // ClientesAtivos = leads únicos com pelo menos 1 sub ativa.
  const subsAtivas = await db
    .select({
      leadId: subscriptions.leadId,
      valor: subscriptions.valor,
      periodicidade: subscriptions.periodicidade,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "ativa"),
        produtoId != null
          ? eq(subscriptions.produtoId, produtoId)
          : sql`(${subscriptions.produtoId} IS NULL OR ${subscriptions.produtoId} IN (SELECT id FROM ${produtos} WHERE ativo = true))`,
      ),
    );
  const mrr = subsAtivas.reduce((acc, s) => {
    const v = s.valor ?? 0;
    if (s.periodicidade === "anual") return acc + v / 12;
    if (s.periodicidade === "vitalicio" || s.periodicidade === "gratis") return acc;
    return acc + v;
  }, 0);
  const clientesAtivosIds = new Set(subsAtivas.map((s) => s.leadId));
  const clientesAtivos = all.filter((l) => clientesAtivosIds.has(l.id));

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

  // MRR potencial = MRR atual + subs aguardando_pagamento (PIX gerado mas não pago)
  const subsAguardando = await db
    .select({
      valor: subscriptions.valor,
      periodicidade: subscriptions.periodicidade,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "aguardando_pagamento"),
        produtoId != null
          ? eq(subscriptions.produtoId, produtoId)
          : sql`(${subscriptions.produtoId} IS NULL OR ${subscriptions.produtoId} IN (SELECT id FROM ${produtos} WHERE ativo = true))`,
      ),
    );
  const mrrPotencial =
    mrr +
    subsAguardando.reduce((acc, s) => {
      const v = s.valor ?? 0;
      if (s.periodicidade === "anual") return acc + v / 12;
      if (s.periodicidade === "vitalicio" || s.periodicidade === "gratis") return acc;
      return acc + v;
    }, 0);

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

  // LTV (Lifetime Value): receita média efetivamente entrada no caixa por
  // cliente que finalizou (cancelou ou reembolsou).
  //
  // Regras:
  //  - Reembolsado: 0 meses pagos (devolveu o dinheiro, não faturou nada)
  //  - Cancelado normal: floor(lifespan_meses) + 1 meses (signup conta como 1
  //    pagamento, +1 a cada renovação completa). Ex:
  //      6 dias  → 1 mês  (signup, sem renovação)
  //      35 dias → 2 meses (signup + 1 renovação)
  //      95 dias → 4 meses (signup + 3 renovações)
  //
  // Inclui só leads "finalizados" (cancelada ou reembolsada). Ativos
  // ainda estão pagando, lifespan em curso.
  const finishedLeads = all.filter(
    (l) =>
      l.pagouEm &&
      (l.subscriptionStatus === "cancelada" ||
        l.subscriptionStatus === "reembolsada"),
  );
  const monthsPaidPerCustomer = finishedLeads.map((l) => {
    if (l.subscriptionStatus === "reembolsada") return 0;
    if (!l.canceladoEm) return 1; // pagou mas sem data de cancelamento
    const lifespanMonths =
      (l.canceladoEm.getTime() - l.pagouEm!.getTime()) /
      (30 * 24 * 60 * 60 * 1000);
    return Math.floor(lifespanMonths) + 1;
  });
  const avgLifetimeMonths =
    monthsPaidPerCustomer.length > 0
      ? monthsPaidPerCustomer.reduce((a, b) => a + b, 0) /
        monthsPaidPerCustomer.length
      : 0;

  let arpu = clientesAtivos.length > 0 ? mrr / clientesAtivos.length : 0;
  if (arpu === 0 && finishedLeads.length > 0) {
    arpu =
      finishedLeads.reduce((acc, l) => acc + (l.valorAssinatura ?? 0), 0) /
      finishedLeads.length;
  }
  const ltv = arpu * avgLifetimeMonths;

  // Métricas de ciclo de vida que respeitam período (se filtro aplicado).
  // - totalAssinantes: leads que pagaram pela 1ª vez no período (pagouEm)
  // - cancelados: leads que cancelaram no período (canceladoEm)
  // - reembolsos: leads que reembolsaram no período (atualizadoEm como proxy
  //   da data de transição pra reembolsada — não temos campo dedicado).
  // Sem período (since=null && until=null), são lifetime.
  const hasPeriod = since != null || until != null;
  const totalAssinantes = hasPeriod
    ? all.filter((l) => l.pagouEm && inPeriod(l.pagouEm)).length
    : all.filter((l) => l.pagouEm != null).length;
  const cancelados = hasPeriod
    ? all.filter(
        (l) => l.status === "cliente_cancelado" && inPeriod(l.canceladoEm),
      ).length
    : all.filter((l) => l.status === "cliente_cancelado").length;
  // Reembolsos: conta eventos de tipo 'reembolso' no período (data real do
  // refund). Não usa lead.atualizadoEm porque qualquer UPDATE no lead muda
  // esse campo (ex: sync de preço, atualização de contato), inflando o número.
  let reembolsos: number;
  if (hasPeriod) {
    const refundConds = [eq(eventos.eventType, "reembolso"), eq(eventos.processedOk, true)];
    if (produtoId != null) refundConds.push(eq(eventos.produtoId, produtoId));
    if (since) refundConds.push(gte(eventos.receivedAt, since));
    if (until) refundConds.push(lte(eventos.receivedAt, until));
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventos)
      .where(and(...refundConds));
    reembolsos = r?.n ?? 0;
  } else {
    reembolsos = all.filter((l) => l.subscriptionStatus === "reembolsada").length;
  }

  return {
    totalLeads: all.length,
    totalAssinantes,
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
    cancelados,
    reembolsos,
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
  const all = await db.select().from(leads).where(and(...cond));
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
  const all = await db.select().from(leads).where(and(...cond));
  const counts = new Map<string, number>();
  for (const l of all) {
    counts.set(l.tipo, (counts.get(l.tipo) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([tipo, total]) => ({ tipo, total }));
}

/**
 * Calendário de renovação: agrupa leads ATIVOS mensais pelo dia do mês
 * que vão renovar (= dia de pagouEm). Útil pra visualizar previsão de
 * caixa por dia.
 *
 * - Considera só periodicidade = 'mensal'
 * - Considera só subscription_status = 'ativa'
 * - Anuais ignorados (renovam 1x/ano, não cabem em calendário mensal)
 * - Vitalícios/grátis não geram receita recorrente
 */
export async function getRenewalCalendar(
  produtoId: number | null = null,
  referenceDate: Date | null = null,
): Promise<Array<{ dia: number; count: number; valorEsperado: number; leads: Array<{ id: number; nome: string; valor: number; plano: string | null }> }>> {
  // Agora conta cada SUB ativa mensal (1 lead pode ter N subs).
  const conds = [
    eq(subscriptions.status, "ativa"),
    eq(subscriptions.periodicidade, "mensal"),
  ];
  if (produtoId != null) {
    conds.push(eq(subscriptions.produtoId, produtoId));
  } else {
    conds.push(
      sql`(${subscriptions.produtoId} IS NULL OR ${subscriptions.produtoId} IN (SELECT id FROM ${produtos} WHERE ativo = true))`,
    );
  }
  if (referenceDate) {
    conds.push(lte(subscriptions.pagouEm, referenceDate));
  }
  const subRows = await db
    .select({
      leadId: subscriptions.leadId,
      pagouEm: subscriptions.pagouEm,
      valor: subscriptions.valor,
      planoNome: subscriptions.planoNome,
      nome: leads.nome,
    })
    .from(subscriptions)
    .innerJoin(leads, eq(leads.id, subscriptions.leadId))
    .where(and(...conds));

  // Agrupa por dia do mês (1-31) baseado em pagouEm da sub.
  const byDay = new Map<
    number,
    Array<{ id: number; nome: string; valor: number; plano: string | null }>
  >();
  for (const s of subRows) {
    if (!s.pagouEm) continue;
    const dia = s.pagouEm.getUTCDate();
    const list = byDay.get(dia) ?? [];
    list.push({
      id: s.leadId,
      nome: s.nome,
      valor: s.valor ?? 0,
      plano: s.planoNome,
    });
    byDay.set(dia, list);
  }

  // Retorna 31 dias (mesmo que vazios) — frontend cuida do calendário visual
  const out: Array<{ dia: number; count: number; valorEsperado: number; leads: Array<{ id: number; nome: string; valor: number; plano: string | null }> }> = [];
  for (let d = 1; d <= 31; d++) {
    const list = byDay.get(d) ?? [];
    out.push({
      dia: d,
      count: list.length,
      valorEsperado: list.reduce((acc, x) => acc + x.valor, 0),
      leads: list,
    });
  }
  return out;
}

/**
 * Faturamento LÍQUIDO no período: entradas (compra_aprovada + assinatura_renovada)
 * MENOS saídas (reembolso processado), filtrados por produto/período.
 *
 * Fonte: tabela `eventos` (cada evento = 1 transação). Suporta payload de:
 *  - Ticto v2 webhook (`payload.item.amount` em centavos)
 *  - Stripe webhook (`payload.data.object.amount_total` em centavos)
 *  - fallback: `valor_assinatura` do lead vinculado
 *
 * `count` é só as transações positivas (compras + renovações).
 * `refundCount` e `refundTotal` mostram quanto foi descontado.
 * `total` = bruto − reembolsos = dinheiro real entrado no período.
 */
export async function getFaturamento(
  produtoId: number | null = null,
  since: Date | null = null,
  until: Date | null = null,
): Promise<{
  count: number;
  total: number;
  grossTotal: number;
  refundCount: number;
  refundTotal: number;
}> {
  const baseConditions = [eq(eventos.processedOk, true)];
  if (produtoId != null) baseConditions.push(eq(eventos.produtoId, produtoId));
  if (since != null) baseConditions.push(gte(eventos.receivedAt, since));
  if (until != null) baseConditions.push(lte(eventos.receivedAt, until));

  // Extrai valor com fallbacks pros vários formatos de payload.
  // Ordem importa: campos mais específicos primeiro, fallbacks por último.
  const valorExpr = sql<number>`coalesce(
    -- Ticto v2 webhook: item.amount em centavos
    ((${eventos.payload}->'item'->>'amount')::numeric / 100),
    -- Ticto API backfill: transaction.paid_amount em centavos (item é null)
    ((${eventos.payload}->'transaction'->>'paid_amount')::numeric / 100),
    -- Ticto API backfill alternativo: offer.price em centavos
    ((${eventos.payload}->'offer'->>'price')::numeric / 100),
    -- Stripe: data.object.amount_total em centavos
    ((${eventos.payload}->'data'->'object'->>'amount_total')::numeric / 100),
    -- Asaas: payment.value já em reais decimal
    ((${eventos.payload}->'payment'->>'value')::numeric),
    -- Fallback: valor_assinatura do lead
    (select valor_assinatura from leads where id = ${eventos.leadId}),
    0
  )::numeric(10,2)`;

  // Entradas: compra_aprovada + assinatura_renovada
  const [entries] = await db
    .select({
      n: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${valorExpr}), 0)::numeric(10,2)`,
    })
    .from(eventos)
    .where(
      and(
        ...baseConditions,
        inArray(eventos.eventType, ["compra_aprovada", "assinatura_renovada"]),
      ),
    );

  // Saídas: reembolso processado
  const [refunds] = await db
    .select({
      n: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${valorExpr}), 0)::numeric(10,2)`,
    })
    .from(eventos)
    .where(and(...baseConditions, eq(eventos.eventType, "reembolso")));

  const grossTotal = Number(entries?.total ?? 0);
  const refundTotal = Number(refunds?.total ?? 0);

  return {
    count: entries?.n ?? 0,
    total: grossTotal - refundTotal, // líquido
    grossTotal,
    refundCount: refunds?.n ?? 0,
    refundTotal,
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
 *
 * Conta SUBSCRIPTIONS (não leads): 1 lead com 2 subs = 2 entradas (1 por plano).
 * "ativos" = subs com status='ativa'. "total" = todas subs do plano (incl. canceladas).
 * "receita" = MRR das subs ativas (anual/12, vitalício/grátis = 0).
 */
export async function getPlanoBreakdown(
  produtoId: number | null = null,
): Promise<PlanoBreakdown[]> {
  const conds = [];
  if (produtoId != null) {
    conds.push(eq(subscriptions.produtoId, produtoId));
  } else {
    conds.push(
      sql`(${subscriptions.produtoId} IS NULL OR ${subscriptions.produtoId} IN (SELECT id FROM ${produtos} WHERE ativo = true))`,
    );
  }
  const subRows = await db
    .select({
      planoNome: subscriptions.planoNome,
      valor: subscriptions.valor,
      periodicidade: subscriptions.periodicidade,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .where(and(...conds));

  const map = new Map<string, { total: number; receita: number; ativos: number }>();
  for (const s of subRows) {
    const key = (s.planoNome ?? "Sem plano").trim() || "Sem plano";
    const cur = map.get(key) ?? { total: 0, receita: 0, ativos: 0 };
    cur.total++;
    if (s.status === "ativa") {
      cur.ativos++;
      const v = s.valor ?? 0;
      if (s.periodicidade === "anual") cur.receita += v / 12;
      else if (s.periodicidade !== "vitalicio" && s.periodicidade !== "gratis") {
        cur.receita += v;
      }
    }
    map.set(key, cur);
  }

  return Array.from(map.entries())
    .map(([plano, v]) => ({ plano, ...v }))
    .sort((a, b) => b.total - a.total);
}
