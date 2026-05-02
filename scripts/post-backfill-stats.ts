import { db } from "../db/client";
import { sql } from "drizzle-orm";

async function main() {
  console.log("\n=== Stats após backfill Ticto ===\n");

  const total = await db.execute<{ n: number }>(sql`select count(*)::int as n from leads`);
  console.log("Total leads:", (total as unknown as Array<{ n: number }>)[0].n);

  const ativos = await db.execute<{ n: number; mrr: number }>(sql`
    select count(*)::int as n, coalesce(sum(valor_assinatura),0)::numeric(10,2) as mrr
    from leads where subscription_status = 'ativa'
  `);
  const a = (ativos as unknown as Array<{ n: number; mrr: number }>)[0];
  console.log("Ativos:", a.n, "| MRR: R$", Number(a.mrr).toFixed(2));

  const stats = await db.execute<{ status: string; n: number }>(sql`
    select status, count(*)::int as n
    from leads
    group by status
    order by n desc
  `);
  console.log("\n=== Por status ===");
  console.table(stats);

  const metodos = await db.execute<{ metodo: string; n: number; mrr: number }>(sql`
    with ultimo as (
      select distinct on (lead_id) lead_id,
        lower(coalesce(
          payload->>'payment_method',
          payload->'transaction'->>'payment_method'
        )) as metodo
      from eventos
      where lead_id is not null
        and event_type in ('compra_aprovada', 'assinatura_renovada')
        and processed_ok = true
      order by lead_id, received_at desc
    )
    select coalesce(metodo, 'indefinido') as metodo,
           count(*)::int as n,
           coalesce(sum(l.valor_assinatura),0)::numeric(10,2) as mrr
    from ultimo
    join leads l on l.id = ultimo.lead_id
    where l.subscription_status = 'ativa'
    group by metodo
    order by n desc
  `);
  console.log("\n=== Ativos por método de pagamento ===");
  console.table(metodos);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
