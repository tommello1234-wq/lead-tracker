/**
 * Investiga o payload de "reembolso" da Ticto pra ver se tem info de
 * momento da solicitação vs momento do processamento.
 */
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

async function main() {
  const r = (await db.execute(sql`
    select id, lead_id, payload
    from eventos
    where event_type = 'reembolso'
    order by received_at desc
    limit 3
  `)) as unknown as Array<{ id: number; lead_id: number; payload: object }>;

  for (const e of r) {
    console.log(`\n=== evt ${e.id} (lead ${e.lead_id}) ===`);
    console.log(JSON.stringify(e.payload, null, 2));
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
