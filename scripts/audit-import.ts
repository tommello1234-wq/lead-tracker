/**
 * Audita: quantos leads vieram via webhook (têm evento) vs importação (sem evento).
 * Roda: node --env-file=.env.local --import tsx scripts/audit-import.ts
 */
import { db } from "../db/client";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute<{
    total: number;
    com_evento: number;
    sem_evento: number;
  }>(sql`
    select
      count(*)::int as total,
      sum(case when l.id in (select distinct lead_id from eventos where lead_id is not null)
          then 1 else 0 end)::int as com_evento,
      sum(case when l.id not in (select distinct lead_id from eventos where lead_id is not null)
          then 1 else 0 end)::int as sem_evento
    from leads l
  `);

  const row = (result as unknown as Array<{ total: number; com_evento: number; sem_evento: number }>)[0];
  console.log(`\n=== Auditoria importação ===`);
  console.log(`Total de leads:           ${row.total}`);
  console.log(`Com evento real (webhook): ${row.com_evento}`);
  console.log(`Sem evento (importados):   ${row.sem_evento}`);
  console.log(`% importados:             ${((row.sem_evento / row.total) * 100).toFixed(1)}%`);

  // Por status
  const byStatus = await db.execute<{ status: string; importados: number; reais: number }>(sql`
    select
      l.status,
      sum(case when l.id not in (select distinct lead_id from eventos where lead_id is not null)
          then 1 else 0 end)::int as importados,
      sum(case when l.id in (select distinct lead_id from eventos where lead_id is not null)
          then 1 else 0 end)::int as reais
    from leads l
    group by l.status
    order by l.status
  `);

  console.log(`\n=== Por status ===`);
  console.log("Status               | Importados | Reais");
  console.log("-".repeat(50));
  for (const r of byStatus as unknown as Array<{ status: string; importados: number; reais: number }>) {
    console.log(`${r.status.padEnd(20)} | ${String(r.importados).padStart(10)} | ${String(r.reais).padStart(5)}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
