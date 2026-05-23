import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

async function run() {
  const l = await db.execute(sql`
    SELECT id, nome, email, contato, gateway, gateway_customer_id,
      to_char(criado_em, 'YYYY-MM-DD HH24:MI') as criado,
      to_char(pagou_em, 'YYYY-MM-DD HH24:MI') as pago,
      subscription_status, status, produto_id
    FROM leads WHERE email = 'alroldosantos123@gmail.com'
  `);
  console.log("=== Lead ===");
  console.log(JSON.stringify(l, null, 2));

  const s = await db.execute(sql`
    SELECT s.id, s.lead_id, s.gateway, s.gateway_subscription_id, s.plano_nome, s.valor, s.periodicidade,
      s.status, to_char(s.criado_em, 'YYYY-MM-DD HH24:MI') as criado,
      to_char(s.pagou_em, 'YYYY-MM-DD HH24:MI') as pago,
      to_char(s.ultima_renovacao_em, 'YYYY-MM-DD') as ultima_renov
    FROM subscriptions s
    WHERE s.lead_id IN (SELECT id FROM leads WHERE email = 'alroldosantos123@gmail.com')
    ORDER BY s.criado_em
  `);
  console.log("\n=== Subscriptions ===");
  console.log(JSON.stringify(s, null, 2));

  const e = await db.execute(sql`
    SELECT to_char(received_at, 'YYYY-MM-DD HH24:MI') as t, source, event_type,
      payload->>'event' as evt
    FROM eventos
    WHERE lead_id IN (SELECT id FROM leads WHERE email = 'alroldosantos123@gmail.com')
    ORDER BY received_at LIMIT 30
  `);
  console.log("\n=== Eventos ===");
  for (const x of e as any) console.log(`  ${x.t} | ${x.source} | ${x.event_type}`);

  // Asaas API — customer search by email
  const apiKey = process.env.ASAAS_API_KEY || "";
  if (apiKey) {
    const r = await fetch(`https://api.asaas.com/v3/customers?email=alroldosantos123@gmail.com`, {
      headers: { access_token: apiKey } as any,
    });
    const data = await r.json() as any;
    console.log("\n=== Asaas customers por email ===");
    console.log(JSON.stringify((data.data || []).map((c: any) => ({
      id: c.id, name: c.name, email: c.email, cpfCnpj: c.cpfCnpj, phone: c.phone, dateCreated: c.dateCreated
    })), null, 2));

    // Buscar subs do cus_000170227846
    const r2 = await fetch(`https://api.asaas.com/v3/subscriptions?customer=cus_000170227846`, {
      headers: { access_token: apiKey } as any,
    });
    const d2 = await r2.json() as any;
    console.log("\n=== Asaas subs do cus_000170227846 ===");
    console.log(JSON.stringify((d2.data || []).map((s: any) => ({
      id: s.id, status: s.status, value: s.value, nextDueDate: s.nextDueDate, billingType: s.billingType,
      description: s.description, deleted: s.deleted, dateCreated: s.dateCreated
    })), null, 2));
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
