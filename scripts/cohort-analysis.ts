/**
 * Cohort analysis local — printar matriz de retenção + LTV real por cohort mensal.
 *
 * Lógica:
 *  - Cohort = mês de pagou_em (YYYY-MM em BRT)
 *  - Reembolsado: 0 meses pagos (não conta retenção em nenhum mês)
 *  - Cancelado: ativo do mês 0 até floor((cancelado_em - pagou_em) / 30 dias)
 *  - Ativo: ativo do mês 0 até hoje
 *  - LTV real = soma(retention[m] * ticket) pra cada mês onde cohort já viveu
 *  - LTV projetado = se cohort tem ≥3 meses, extrapola decay até retenção ~5%
 */
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30;

type Lead = {
  id: number;
  pagou_em: string; // ISO
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
  // YYYY-MM em America/Sao_Paulo
  const d = new Date(iso);
  const brt = new Date(d.getTime() - 3 * 3600 * 1000); // BRT = UTC-3
  return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function run(produtoId: number | null = 1) {
  const filtroProduto = produtoId == null
    ? sql`(produto_id IS NULL OR produto_id IN (SELECT id FROM produtos WHERE ativo = true))`
    : sql`produto_id = ${produtoId}`;

  const rows = await db.execute<Lead>(sql`
    SELECT id,
      pagou_em::text AS pagou_em,
      valor_assinatura,
      cancelado_em::text AS cancelado_em,
      reembolsado_em::text AS reembolsado_em,
      subscription_status
    FROM leads
    WHERE pagou_em IS NOT NULL
      AND ${filtroProduto}
    ORDER BY pagou_em
  `);

  const leads = rows as unknown as Lead[];
  console.log(`Total leads pagantes: ${leads.length} (produto_id=${produtoId ?? "todos ativos"})\n`);

  // Agrupa por cohort_month
  const byCohort = new Map<string, Lead[]>();
  for (const l of leads) {
    const c = brtMonth(l.pagou_em);
    if (!byCohort.has(c)) byCohort.set(c, []);
    byCohort.get(c)!.push(l);
  }

  const cohortMonths = Array.from(byCohort.keys()).sort();
  const nowISO = new Date().toISOString();
  const maxMonths = 14; // M0..M13

  // Header
  const header = ["Cohort", "Tam", "Ticket"];
  for (let m = 0; m < maxMonths; m++) header.push(`M${m}`);
  header.push("LTV", "LTV proj");
  console.log(header.join(" | "));
  console.log("-".repeat(header.join(" | ").length));

  let ltvSomados = 0;
  let cohortsMaduras = 0;
  let totalAtivosLifetime = 0;

  for (const cohort of cohortMonths) {
    const ls = byCohort.get(cohort)!;
    const signup = ls.length;
    const ticket = ls.reduce((a, l) => a + Number(l.valor_assinatura ?? 0), 0) / signup;

    // Idade da cohort em meses
    const cohortStart = ls[0].pagou_em;
    const monthsElapsed = monthsBetween(cohortStart, nowISO);

    // Retention[m] = quantos estavam ativos no mês m
    const retention: number[] = [];
    let ltvSoFar = 0;
    for (let m = 0; m <= Math.min(monthsElapsed, maxMonths - 1); m++) {
      let alive = 0;
      for (const l of ls) {
        if (l.subscription_status === "reembolsada") continue; // 0 meses
        // Determina "fim" de vida desse lead
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

    // LTV projetado: se cohort ≥3 meses, extrapola decay
    let ltvProj = ltvSoFar;
    if (retention.length >= 3) {
      // decay = ratio médio M[n+1]/M[n] dos últimos 2 ratios
      const r = retention;
      const lastIdx = r.length - 1;
      let decaySum = 0, n = 0;
      for (let i = Math.max(1, lastIdx - 2); i <= lastIdx; i++) {
        if (r[i - 1] > 0) { decaySum += r[i] / r[i - 1]; n++; }
      }
      const decay = n > 0 ? Math.min(0.97, Math.max(0.4, decaySum / n)) : 0.7;
      let projRet = r[lastIdx];
      for (let m = lastIdx + 1; m < 36; m++) {
        projRet *= decay;
        if (projRet < 0.02) break;
        ltvProj += projRet * ticket;
      }
    }

    const ativosHoje = ls.filter(l =>
      l.subscription_status !== "reembolsada" &&
      !l.cancelado_em &&
      !l.reembolsado_em
    ).length;
    totalAtivosLifetime += ativosHoje;

    if (monthsElapsed >= 3) {
      ltvSomados += ltvSoFar;
      cohortsMaduras++;
    }

    const row = [
      cohort,
      String(signup).padStart(3),
      `R$${ticket.toFixed(0).padStart(3)}`,
    ];
    for (let m = 0; m < maxMonths; m++) {
      if (m < retention.length) row.push(`${(retention[m] * 100).toFixed(0).padStart(3)}%`);
      else row.push("  - ");
    }
    row.push(`R$${ltvSoFar.toFixed(0).padStart(4)}`);
    row.push(`R$${ltvProj.toFixed(0).padStart(4)}`);
    console.log(row.join(" | "));
  }

  // Sanity check: ativos por cohort deve somar ~270
  console.log(`\n=== Sanity ===`);
  console.log(`Ativos hoje somados: ${totalAtivosLifetime}`);

  // LTV médio das cohorts maduras (≥3 meses)
  const ltvMedio = cohortsMaduras > 0 ? ltvSomados / cohortsMaduras : 0;
  console.log(`\n=== LTV ===`);
  console.log(`LTV médio (cohorts ≥3m, observado até hoje): R$ ${ltvMedio.toFixed(2)}`);
  console.log(`CAC: R$ 94`);
  console.log(`LTV/CAC: ${(ltvMedio / 94).toFixed(2)}`);
  console.log(`Payback: ${(94 / (ltvMedio / 6)).toFixed(1)} meses (estimado se cliente ficar 6m)`);

  process.exit(0);
}

const arg = process.argv[2];
const produtoId = arg === "all" ? null : arg ? Number(arg) : 1;
run(produtoId).catch(e => { console.error(e); process.exit(1); });
