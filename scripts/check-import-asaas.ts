import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

async function run() {
  // Subs importadas ontem (22/05 noite) via /audit/asaas-import-missing
  const r = await db.execute(sql`
    SELECT s.id, s.gateway_subscription_id, s.plano_nome, s.valor, s.status,
      l.id as lead_id, l.email, l.nome,
      to_char(l.criado_em, 'YYYY-MM-DD') as lead_criado,
      to_char(l.pagou_em, 'YYYY-MM-DD') as lead_pago,
      l.subscription_status as lead_sub_status, l.status as lead_status,
      to_char(s.criado_em, 'YYYY-MM-DD HH24:MI') as sub_criada,
      to_char(s.pagou_em, 'YYYY-MM-DD HH24:MI') as sub_paga
    FROM subscriptions s
    LEFT JOIN leads l ON l.id = s.lead_id
    WHERE s.gateway = 'asaas'
      AND s.status = 'ativa'
      AND s.criado_em >= '2026-05-22'
    ORDER BY s.criado_em DESC
  `);
  console.log(`=== Subs Asaas importadas após 22/05 (${(r as any).length}) ===`);
  for (const x of r as any) {
    const fantasma = !x.lead_pago ? " 👻 FANTASMA (lead nunca pagou)" : "";
    console.log(`\n  sub#${x.id} ${x.gateway_subscription_id}`);
    console.log(`    plano: ${x.plano_nome} R$${x.valor} | status: ${x.status}`);
    console.log(`    lead#${x.lead_id} ${x.email} (${x.nome})`);
    console.log(`    lead_pago: ${x.lead_pago ?? "NUNCA"} | sub_status_lead: ${x.lead_sub_status}${fantasma}`);
    console.log(`    sub criada em: ${x.sub_criada} | sub paga em: ${x.sub_paga ?? "NUNCA"}`);
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
