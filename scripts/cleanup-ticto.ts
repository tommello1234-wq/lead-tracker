import { db } from "../db/client.js";
import { subscriptions, leads } from "../db/schema.js";
import { sql, eq, and, inArray } from "drizzle-orm";

async function run() {
  // 4 emails confirmados canceladas no Ticto
  const emails = [
    "artheavymetal@gmail.com",
    "tevezdesigner@gmail.com",
    "anaccarolinaa4@gmail.com",
    "taynecosta02@gmail.com",
  ];

  // Pega lead ids
  const ls = await db.select({ id: leads.id, email: leads.email })
    .from(leads).where(inArray(leads.email, emails));
  console.log("Leads encontrados:", ls.length);

  const leadIds = ls.map(x => x.id);
  if (!leadIds.length) { process.exit(0); }

  // Atualiza subs Ticto pra cancelada
  const updated = await db.update(subscriptions)
    .set({ status: "cancelada", canceladoEm: new Date(), atualizadoEm: new Date() })
    .where(and(eq(subscriptions.gateway, "ticto"), inArray(subscriptions.leadId, leadIds)))
    .returning({ id: subscriptions.id, leadId: subscriptions.leadId, valor: subscriptions.valor });
  console.log("Subs atualizadas:", updated.length);

  // Atualiza leads se não tiverem outra sub ativa
  for (const u of updated) {
    const others = await db.select({ id: subscriptions.id }).from(subscriptions)
      .where(and(eq(subscriptions.leadId, u.leadId), inArray(subscriptions.status, ["ativa", "atrasada"])));
    if (others.length === 0) {
      await db.update(leads).set({ subscriptionStatus: "cancelada", atualizadoEm: new Date() })
        .where(eq(leads.id, u.leadId));
      console.log(`  lead#${u.leadId} → cancelada`);
    } else {
      console.log(`  lead#${u.leadId} → mantém (tem outras subs)`);
    }
  }

  // Novo MRR
  const r = await db.execute(sql`
    SELECT COUNT(*) as n, SUM(CASE WHEN periodicidade='mensal' THEN valor WHEN periodicidade='anual' THEN valor/12.0 ELSE 0 END)::numeric(10,2) as mrr
    FROM subscriptions WHERE status = 'ativa'
  `);
  console.log("\nMRR após cleanup Ticto:", JSON.stringify(r, null, 2));
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
