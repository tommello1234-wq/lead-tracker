/**
 * Olha os payloads brutos dos webhooks do Clodoaldo pra ver
 * formato do phone em cada chegada.
 */
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

async function main() {
  const r = (await db.execute(sql`
    select id, lead_id, event_type, source, received_at,
           payload->'customer'->'phone' as phone_obj,
           payload->'customer'->>'name' as nome,
           payload->'customer'->>'email' as email,
           payload->'customer'->>'id' as customer_id,
           payload->'customer'->>'cpf' as cpf
    from eventos
    where lead_id in (462, 463)
    order by received_at asc
  `)) as unknown as Array<{
    id: number;
    lead_id: number;
    event_type: string;
    source: string;
    received_at: Date;
    phone_obj: unknown;
    nome: string;
    email: string;
    customer_id: string;
    cpf: string;
  }>;

  console.log(`Eventos:\n`);
  for (const e of r) {
    console.log(`evt ${e.id} (lead ${e.lead_id}): ${e.event_type}`);
    console.log(`  customer: ${e.nome} | email: ${e.email} | cpf: ${e.cpf} | id: ${e.customer_id}`);
    console.log(`  phone: ${JSON.stringify(e.phone_obj)}`);
    console.log("");
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
