import { db } from "../../db/client.js";
import { sql } from "drizzle-orm";

/**
 * Cohort analysis — retenção e LTV real por mês de signup.
 *
 * Diferente do LTV blended em `queries.ts` (que só considera leads que já
 * cancelaram/reembolsaram), cohort mede % retido em cada mês N após signup
 * e calcula LTV = soma(retenção[m] × ticket) — incluindo os ativos.
 *
 * Regras:
 *  - Cohort = mês de pagou_em em America/Sao_Paulo
 *  - Reembolsado: 0 meses pagos (não conta retenção em mês nenhum)
 *  - Cancelado: ativo do mês 0 até floor((cancelado_em - pagou_em)/30 dias)
 *  - Ativo: ativo do mês 0 até NOW
 *  - LTV projetado: se cohort ≥3 meses, extrapola decay observado
 */

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30;
const MAX_MONTHS = 14; // M0..M13 (1 ano + 2)

export type CohortRow = {
  cohortMonth: string; // "2026-04"
  signupCount: number;
  ticketMedio: number;
  monthsElapsed: number;
  retention: (number | null)[]; // null = mês ainda não viveu
  ltvSoFar: number; // R$ acumulado observado
  ltvProjected: number; // R$ projetado até churn ~0
  activeNow: number;
};

export type CohortSummary = {
  rows: CohortRow[];
  ltvMedio: number; // média do ltvSoFar das cohorts ≥3 meses
  ltvProjMedio: number; // média do ltvProjected das cohorts ≥3 meses
  cohortsMaduras: number;
  totalAtivos: number;
};

type LeadRow = {
  id: number;
  pagou_em: string;
  valor_assinatura: number | null;
  cancelado_em: string | null;
  reembolsado_em: string | null;
  subscription_status: string;
};

function monthsBetween(startISO: string, endISO: string): number {
  const diff = new Date(endISO).getTime() - new Date(startISO).getTime();
  return Math.floor(diff / MS_PER_DAY / DAYS_PER_MONTH);
}

function brtMonth(iso: string): string {
  const d = new Date(iso);
  const brt = new Date(d.getTime() - 3 * 3600 * 1000);
  return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getCohortMatrix(
  produtoId: number | null,
  gateway: string | null = null,
): Promise<CohortSummary> {
  const filtroProduto =
    produtoId == null
      ? sql`(produto_id IS NULL OR produto_id IN (SELECT id FROM produtos WHERE ativo = true))`
      : sql`produto_id = ${produtoId}`;
  const filtroGateway = gateway != null ? sql`AND gateway = ${gateway}` : sql``;

  const rows = await db.execute<LeadRow>(sql`
    SELECT id,
      pagou_em::text AS pagou_em,
      valor_assinatura,
      cancelado_em::text AS cancelado_em,
      reembolsado_em::text AS reembolsado_em,
      subscription_status
    FROM leads
    WHERE pagou_em IS NOT NULL
      AND ${filtroProduto}
      ${filtroGateway}
    ORDER BY pagou_em
  `);

  const leads = rows as unknown as LeadRow[];
  const byCohort = new Map<string, LeadRow[]>();
  for (const l of leads) {
    const c = brtMonth(l.pagou_em);
    if (!byCohort.has(c)) byCohort.set(c, []);
    byCohort.get(c)!.push(l);
  }

  const cohortMonths = Array.from(byCohort.keys()).sort();
  const nowISO = new Date().toISOString();
  const result: CohortRow[] = [];

  let ltvSumMaduras = 0;
  let ltvProjSumMaduras = 0;
  let cohortsMaduras = 0;
  let totalAtivos = 0;

  for (const cohort of cohortMonths) {
    const ls = byCohort.get(cohort)!;
    const signup = ls.length;
    const ticket =
      ls.reduce((a, l) => a + Number(l.valor_assinatura ?? 0), 0) / signup;
    const cohortStart = ls[0].pagou_em;
    const monthsElapsed = monthsBetween(cohortStart, nowISO);

    const retention: (number | null)[] = [];
    let ltvSoFar = 0;
    for (let m = 0; m < MAX_MONTHS; m++) {
      if (m > monthsElapsed) {
        retention.push(null);
        continue;
      }
      let alive = 0;
      for (const l of ls) {
        if (l.subscription_status === "reembolsada") continue;
        let fimISO: string;
        if (l.cancelado_em) fimISO = l.cancelado_em;
        else if (l.reembolsado_em) fimISO = l.reembolsado_em;
        else fimISO = nowISO;
        const mesesPagos = monthsBetween(l.pagou_em, fimISO) + 1;
        if (mesesPagos > m) alive++;
      }
      const pct = alive / signup;
      retention.push(pct);
      ltvSoFar += pct * ticket;
    }

    // LTV projetado — extrapola decay
    let ltvProjected = ltvSoFar;
    const observed = retention.filter((r): r is number => r !== null);
    if (observed.length >= 3) {
      const lastIdx = observed.length - 1;
      let decaySum = 0;
      let n = 0;
      for (let i = Math.max(1, lastIdx - 2); i <= lastIdx; i++) {
        if (observed[i - 1] > 0) {
          decaySum += observed[i] / observed[i - 1];
          n++;
        }
      }
      const decay = n > 0 ? Math.min(0.97, Math.max(0.4, decaySum / n)) : 0.7;
      let projRet = observed[lastIdx];
      for (let m = lastIdx + 1; m < 36; m++) {
        projRet *= decay;
        if (projRet < 0.02) break;
        ltvProjected += projRet * ticket;
      }
    }

    const activeNow = ls.filter(
      (l) =>
        l.subscription_status !== "reembolsada" &&
        !l.cancelado_em &&
        !l.reembolsado_em,
    ).length;
    totalAtivos += activeNow;

    if (monthsElapsed >= 3) {
      ltvSumMaduras += ltvSoFar;
      ltvProjSumMaduras += ltvProjected;
      cohortsMaduras++;
    }

    result.push({
      cohortMonth: cohort,
      signupCount: signup,
      ticketMedio: ticket,
      monthsElapsed,
      retention,
      ltvSoFar,
      ltvProjected,
      activeNow,
    });
  }

  return {
    rows: result,
    ltvMedio: cohortsMaduras > 0 ? ltvSumMaduras / cohortsMaduras : 0,
    ltvProjMedio:
      cohortsMaduras > 0 ? ltvProjSumMaduras / cohortsMaduras : 0,
    cohortsMaduras,
    totalAtivos,
  };
}
