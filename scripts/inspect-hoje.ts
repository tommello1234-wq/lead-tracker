/**
 * Verifica o que existe no banco pra "hoje" (em BRT).
 */
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

async function main() {
  const todayBRT = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  console.log(`Hoje em BRT: ${todayBRT}`);
  const sinceUtc = `${todayBRT}T03:00:00Z`;
  console.log(`since UTC: ${sinceUtc}\n`);

  // Eventos hoje
  const evs = (await db.execute(sql`
    select event_type, count(*)::int as n,
           min(received_at) as primeiro, max(received_at) as ultimo
    from eventos
    where received_at >= ${sinceUtc}::timestamp
      and processed_ok = true
    group by event_type
    order by n desc
  `)) as unknown as Array<{ event_type: string; n: number; primeiro: Date; ultimo: Date }>;
  console.log(`EVENTOS hoje (${evs.reduce((a, e) => a + e.n, 0)} total):`);
  for (const e of evs) {
    console.log(`  ${e.event_type}: ${e.n} (${String(e.primeiro).slice(0, 19)} -> ${String(e.ultimo).slice(0, 19)})`);
  }

  // Leads criados hoje
  const novos = (await db.execute(sql`
    select count(*)::int as n from leads
    where criado_em >= ${sinceUtc}::timestamp
  `)) as unknown as Array<{ n: number }>;
  console.log(`\nLEADS NOVOS hoje: ${novos[0]?.n ?? 0}`);

  // Compras hoje
  const compras = (await db.execute(sql`
    select count(*)::int as n, sum(coalesce(valor_assinatura, 0))::numeric(10,2) as total
    from leads where pagou_em >= ${sinceUtc}::timestamp
  `)) as unknown as Array<{ n: number; total: string }>;
  console.log(`COMPRAS hoje: ${compras[0]?.n ?? 0} (R$ ${compras[0]?.total ?? 0})`);

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
