import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

async function run() {
  // lead#464
  const lead = await db.execute(sql`SELECT id, nome, email, gateway, gateway_customer_id FROM leads WHERE id = 464`);
  console.log("Lead 464:", JSON.stringify(lead, null, 2));

  const subs = await db.execute(sql`SELECT id, gateway, gateway_subscription_id, status, valor, plano_nome FROM subscriptions WHERE lead_id = 464`);
  console.log("\nSubs lead 464:", JSON.stringify(subs, null, 2));

  // Asaas API: o que tem pra cus_000170227846
  const apiKey = process.env.ASAAS_API_KEY || "";
  if (!apiKey) { console.log("Sem ASAAS_API_KEY local"); process.exit(0); }
  const r = await fetch(`https://api.asaas.com/v3/subscriptions?customer=cus_000170227846`, {
    headers: { access_token: apiKey },
  });
  const data = await r.json() as any;
  console.log("\nAsaas API subs do customer:", JSON.stringify((data.data || []).map((s: any) => ({
    id: s.id, status: s.status, value: s.value, nextDueDate: s.nextDueDate, deleted: s.deleted,
  })), null, 2));
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
