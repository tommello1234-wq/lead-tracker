import { db } from "../../db/client.js";
import { leads, subscriptions, produtos } from "../../db/schema.js";
import { and, eq, gte, lte, isNotNull, sql } from "drizzle-orm";

/**
 * Métricas de Churn — mede SAÍDA de clientes/MRR no período.
 *
 * Distinção CRÍTICA:
 *  - Cancelamento = cliente já era ativo (renovou pelo menos 1x ou ficou >7d),
 *    decidiu sair. CONTA NO CHURN.
 *  - Reembolso = cliente recém-comprou, pediu dinheiro de volta dentro de 7d.
 *    NÃO conta no churn — é "venda que não deveria ter acontecido". Conta como
 *    métrica separada `reembolsoTaxa` (% das vendas que reembolsaram).
 *  - Cancelamento agendado (cancel_at) = cliente anunciou que vai sair mas
 *    ainda paga até period_end. Conta no churn ANTECIPADO (mostra que vai sair).
 *
 * Fórmulas:
 *  - customerChurnMensal = cancelamentos nos últimos N dias ÷ clientes ativos médios no período
 *  - revenueChurnMensal = MRR cancelado nos últimos N dias ÷ MRR médio no período
 *  - reembolsoTaxa = reembolsos no período ÷ vendas no período
 *  - ltvViaChurn = ARPU ÷ customerChurnMensal (fórmula clássica de SaaS)
 *
 * Período padrão: 30 dias (= 1 ciclo mensal).
 */

export type ChurnMetrics = {
  // Customer churn (saídas reais — clientes que decidiram sair)
  customerChurnMensal: number; // % (0-1, capped em 1)
  cancelamentos: number; // count no período
  cancelamentosAgendados: number; // count com cancel_at no período
  // Revenue churn (MRR perdido)
  revenueChurnMensal: number; // % (0-1, capped em 1)
  mrrPerdido: number; // R$ perdido em cancelamentos no período
  mrrSaindo: number; // R$ que vai sair (cancelamentos agendados)
  // Reembolso (métrica separada — não é churn de verdade)
  reembolsos: number; // count
  reembolsoTaxa: number; // % das vendas que reembolsaram (0-1)
  vendasNoPeriodo: number;
  // Derivadas
  ltvViaChurn: number; // R$ — ARPU ÷ churn mensal
  vidaMediaMeses: number; // 1/churn — quantos meses cliente médio fica
  // Contexto
  ativosAtuais: number;
  ativosInicio: number; // ativos no início do período
  arpuAtual: number;
  diasAnalisados: number;
  /** true = base muito nova/pequena, churn % não é confiável */
  amostraPequena: boolean;
};

export async function getChurnMetrics(
  produtoId: number | null,
  gateway: string | null = null,
  days = 30,
): Promise<ChurnMetrics> {
  const now = new Date();
  const ago = new Date(now);
  ago.setDate(ago.getDate() - days);

  // Filtros reutilizáveis
  const filtroProduto =
    produtoId != null
      ? sql`AND produto_id = ${produtoId}`
      : sql`AND (produto_id IS NULL OR produto_id IN (SELECT id FROM produtos WHERE ativo = true))`;
  const filtroGateway = gateway != null
    ? sql`AND (gateway = ${gateway} OR gateway = ${gateway + "-sync"})`
    : sql``;

  // ============================================================
  // 1. CANCELAMENTOS no período (saídas reais)
  // ============================================================
  const cancRows = await db.execute<{ n: number; mrr_total: number }>(sql`
    SELECT
      COUNT(*)::int AS n,
      COALESCE(SUM(
        CASE
          WHEN periodicidade = 'anual' THEN valor / 12.0
          WHEN periodicidade IN ('vitalicio', 'gratis') THEN 0
          ELSE valor
        END
      ), 0)::float AS mrr_total
    FROM subscriptions
    WHERE status = 'cancelada'
      AND cancelado_em >= ${ago.toISOString()}::timestamp
      AND cancelado_em <= ${now.toISOString()}::timestamp
      ${filtroProduto}
      ${filtroGateway}
  `);
  const cancelamentos = Number((cancRows as any)[0]?.n ?? 0);
  const mrrPerdido = Number((cancRows as any)[0]?.mrr_total ?? 0);

  // ============================================================
  // 2. CANCELAMENTOS AGENDADOS atuais (cancel_at futuro)
  // ============================================================
  const cancAgRows = await db.execute<{ n: number; mrr_total: number }>(sql`
    SELECT
      COUNT(*)::int AS n,
      COALESCE(SUM(
        CASE
          WHEN periodicidade = 'anual' THEN valor / 12.0
          WHEN periodicidade IN ('vitalicio', 'gratis') THEN 0
          ELSE valor
        END
      ), 0)::float AS mrr_total
    FROM subscriptions
    WHERE status = 'ativa'
      AND cancel_at IS NOT NULL
      ${filtroProduto}
      ${filtroGateway}
  `);
  const cancelamentosAgendados = Number((cancAgRows as any)[0]?.n ?? 0);
  const mrrSaindo = Number((cancAgRows as any)[0]?.mrr_total ?? 0);

  // ============================================================
  // 3. REEMBOLSOS no período (métrica separada)
  // ============================================================
  const reembRows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM subscriptions
    WHERE status = 'reembolsada'
      AND criado_em >= ${ago.toISOString()}::timestamp
      ${filtroProduto}
      ${filtroGateway}
  `);
  const reembolsos = Number((reembRows as any)[0]?.n ?? 0);

  // ============================================================
  // 4. VENDAS NO PERÍODO (denominador da taxa de reembolso)
  // ============================================================
  const vendasRows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM subscriptions
    WHERE pagou_em >= ${ago.toISOString()}::timestamp
      AND pagou_em <= ${now.toISOString()}::timestamp
      ${filtroProduto}
      ${filtroGateway}
  `);
  const vendasNoPeriodo = Number((vendasRows as any)[0]?.n ?? 0);
  const reembolsoTaxa = vendasNoPeriodo > 0 ? reembolsos / vendasNoPeriodo : 0;

  // ============================================================
  // 5. ATIVOS ATUAIS + ARPU (denominador do churn + base do LTV)
  // ============================================================
  const ativosRows = await db.execute<{ n: number; mrr_total: number }>(sql`
    SELECT
      COUNT(*)::int AS n,
      COALESCE(SUM(
        CASE
          WHEN periodicidade = 'anual' THEN valor / 12.0
          WHEN periodicidade IN ('vitalicio', 'gratis') THEN 0
          ELSE valor
        END
      ), 0)::float AS mrr_total
    FROM subscriptions
    WHERE status = 'ativa'
      ${filtroProduto}
      ${filtroGateway}
  `);
  const ativosAtuais = Number((ativosRows as any)[0]?.n ?? 0);
  const mrrAtual = Number((ativosRows as any)[0]?.mrr_total ?? 0);
  const arpuAtual = ativosAtuais > 0 ? mrrAtual / ativosAtuais : 0;

  // ============================================================
  // 6. ATIVOS NO INÍCIO DO PERÍODO (denominador correto do churn)
  // = subs que pagaram ANTES do início do período E (não cancelaram
  //   ainda OU cancelaram DEPOIS do início) E (não reembolsaram
  //   ainda OU reembolsaram DEPOIS do início)
  // Mede "subs que existiam ativas no momento ago".
  // ============================================================
  const ativosInicioRows = await db.execute<{ n: number; mrr_total: number }>(sql`
    SELECT
      COUNT(*)::int AS n,
      COALESCE(SUM(
        CASE
          WHEN periodicidade = 'anual' THEN valor / 12.0
          WHEN periodicidade IN ('vitalicio', 'gratis') THEN 0
          ELSE valor
        END
      ), 0)::float AS mrr_total
    FROM subscriptions
    WHERE pagou_em IS NOT NULL
      AND pagou_em < ${ago.toISOString()}::timestamp
      AND (cancelado_em IS NULL OR cancelado_em >= ${ago.toISOString()}::timestamp)
      AND status NOT IN ('reembolsada', 'nenhuma')
      ${filtroProduto}
      ${filtroGateway}
  `);
  const ativosInicio = Number((ativosInicioRows as any)[0]?.n ?? 0);
  const mrrInicio = Number((ativosInicioRows as any)[0]?.mrr_total ?? 0);
  const ativosDenom = Math.max(ativosInicio, 1); // evita div por zero

  // ============================================================
  // 7. TAXAS DE CHURN
  // ============================================================
  // Cap churn em 100% (matematicamente é o máximo). Cohort jovem pode ter
  // cancelamentos > ativos_no_inicio porque novos entraram e saíram dentro
  // do período. Nesse caso, marca como amostra pequena.
  const customerChurnRaw = cancelamentos / ativosDenom;
  const customerChurnMensal = Math.min(customerChurnRaw, 1);
  const revenueChurnRaw = mrrInicio > 0 ? mrrPerdido / mrrInicio : 0;
  const revenueChurnMensal = Math.min(revenueChurnRaw, 1);
  // Amostra pequena: menos de 10 subs no início OU churn raw > 50% (sinal
  // de que muitos clientes entraram E saíram dentro do período — cohort
  // imatura, fórmula não confiável).
  const amostraPequena = ativosInicio < 10 || customerChurnRaw > 0.5;

  // ============================================================
  // 8. LTV via churn (fórmula clássica SaaS)
  // Só calcula se churn é "decente" (não 100% — daria LTV = ARPU)
  // ============================================================
  const ltvViaChurn =
    customerChurnMensal > 0 && customerChurnMensal < 0.5
      ? arpuAtual / customerChurnMensal
      : 0;
  const vidaMediaMeses =
    customerChurnMensal > 0 && customerChurnMensal < 1
      ? 1 / customerChurnMensal
      : 0;

  return {
    customerChurnMensal,
    cancelamentos,
    cancelamentosAgendados,
    revenueChurnMensal,
    mrrPerdido,
    mrrSaindo,
    reembolsos,
    reembolsoTaxa,
    vendasNoPeriodo,
    ltvViaChurn,
    vidaMediaMeses,
    ativosAtuais,
    ativosInicio,
    arpuAtual,
    diasAnalisados: days,
    amostraPequena,
  };
}
