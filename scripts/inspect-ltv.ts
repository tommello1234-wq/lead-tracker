/**
 * Distribui os clientes cancelados em buckets de lifespan pra ver
 * por que o LTV deu tão baixo.
 */
import { db } from "../db/client.js";
import { leads } from "../db/schema.js";
import { isNotNull, and, eq } from "drizzle-orm";

async function main() {
  const all = await db
    .select()
    .from(leads)
    .where(
      and(
        isNotNull(leads.pagouEm),
        isNotNull(leads.canceladoEm),
        eq(leads.produtoId, 1),
      ),
    );

  console.log(`${all.length} leads com pagouEm + canceladoEm\n`);

  const buckets = { "<1d": 0, "1-7d": 0, "7-30d": 0, "1-3m": 0, "3-6m": 0, "6m+": 0 };
  let totalDays = 0;
  let totalTicket = 0;

  for (const l of all) {
    const days =
      (l.canceladoEm!.getTime() - l.pagouEm!.getTime()) / (24 * 60 * 60 * 1000);
    totalDays += days;
    totalTicket += l.valorAssinatura ?? 0;
    if (days < 1) buckets["<1d"]++;
    else if (days < 7) buckets["1-7d"]++;
    else if (days < 30) buckets["7-30d"]++;
    else if (days < 90) buckets["1-3m"]++;
    else if (days < 180) buckets["3-6m"]++;
    else buckets["6m+"]++;
  }

  console.log("Distribuição por lifespan:");
  for (const [k, v] of Object.entries(buckets)) {
    const pct = ((v / all.length) * 100).toFixed(0);
    console.log(`  ${k.padEnd(6)} ${v.toString().padStart(3)} (${pct}%)`);
  }

  const avgDays = totalDays / all.length;
  const avgMonths = avgDays / 30;
  const avgTicket = totalTicket / all.length;
  console.log(
    `\nMédias: ${avgDays.toFixed(1)} dias = ${avgMonths.toFixed(2)} meses · ticket médio R$ ${avgTicket.toFixed(2)}`,
  );
  console.log(`LTV calculado = R$ ${(avgTicket * avgMonths).toFixed(0)}`);

  // Mostra os 5 mais curtos pra ver se tem algo esquisito
  const sorted = all
    .map((l) => ({
      id: l.id,
      nome: l.nome.slice(0, 30),
      pagou: l.pagouEm!.toISOString().slice(0, 19),
      cancelou: l.canceladoEm!.toISOString().slice(0, 19),
      dias: (l.canceladoEm!.getTime() - l.pagouEm!.getTime()) / (24 * 60 * 60 * 1000),
      valor: l.valorAssinatura,
      sub: l.subscriptionStatus,
    }))
    .sort((a, b) => a.dias - b.dias);

  console.log(`\n5 cancelados mais rápidos (suspeitos):`);
  for (const l of sorted.slice(0, 5)) {
    console.log(
      `  ${l.id} ${l.nome} | sub=${l.sub} | ${l.dias.toFixed(2)}d | pagou ${l.pagou} cancelou ${l.cancelou}`,
    );
  }

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
