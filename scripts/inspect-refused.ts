/**
 * Pega payload completo de compra_recusada pra encontrar onde a
 * Ticto bota o motivo da recusa.
 */
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

async function main() {
  const r = (await db.execute(sql`
    select id, payload from eventos
    where event_type = 'compra_recusada'
    order by received_at desc
    limit 3
  `)) as unknown as Array<{ id: number; payload: object }>;

  for (const e of r) {
    console.log(`\n=== evt ${e.id} compra_recusada ===`);
    console.log(JSON.stringify(e.payload, null, 2));
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
