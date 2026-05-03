/**
 * Lê o payload completo do evento 987 pra entender como ele mesclou
 * Felipe + Clodoaldo no Lead 462.
 */
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

async function main() {
  const r = (await db.execute(sql`
    select id, lead_id, event_type, source, payload
    from eventos
    where id in (986, 987, 989)
    order by id asc
  `)) as unknown as Array<{
    id: number;
    lead_id: number;
    event_type: string;
    source: string;
    payload: object;
  }>;

  for (const e of r) {
    console.log(`\n=== evt ${e.id} (lead ${e.lead_id}) ${e.event_type} ===`);
    console.log(JSON.stringify(e.payload, null, 2).slice(0, 2000));
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
