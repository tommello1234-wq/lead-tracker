import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

async function run() {
  // Leads com MAIS de uma sub ativa no MESMO gateway (suspeita de dup)
  const dups = await db.execute(sql`
    SELECT lead_id, gateway, COUNT(*) as n,
      string_agg(gateway_subscription_id, ' | ') as sub_ids,
      SUM(valor) as total
    FROM subscriptions WHERE status = 'ativa'
    GROUP BY lead_id, gateway
    HAVING COUNT(*) > 1
    ORDER BY n DESC LIMIT 20
  `);
  console.log("=== Leads com >1 sub ativa no mesmo gateway ===");
  for (const x of dups as any) {
    console.log(`lead#${x.lead_id} | ${x.gateway} | ${x.n} subs | R$${x.total} | ${x.sub_ids?.slice(0, 80)}`);
  }

  // Stripe novas (criadas hoje no banco) — são 1ª compra ou renovação?
  const stripeRecent = await db.execute(sql`
    SELECT s.gateway_subscription_id, s.valor, s.lead_id, s.criado_em,
      l.email,
      (SELECT COUNT(*) FROM eventos WHERE lead_id = s.lead_id AND event_type IN ('compra_aprovada', 'assinatura_renovada')) as n_eventos
    FROM subscriptions s LEFT JOIN leads l ON l.id = s.lead_id
    WHERE s.gateway = 'stripe' AND s.status = 'ativa'
      AND s.criado_em >= NOW() - INTERVAL '24 hours'
    ORDER BY s.criado_em DESC
  `);
  console.log("\n=== Subs Stripe criadas últimas 24h ===");
  for (const x of stripeRecent as any) {
    console.log(`  ${x.criado_em} | ${x.email} | R$${x.valor} | n_eventos: ${x.n_eventos}`);
  }

  // Os 4 leads que importei do Asaas — quantas subs ativas tem cada um?
  const asaasImportados = await db.execute(sql`
    SELECT s.lead_id, l.email,
      COUNT(*) FILTER (WHERE s.status = 'ativa') as ativas,
      COUNT(*) as total,
      SUM(s.valor) FILTER (WHERE s.status = 'ativa') as mrr
    FROM subscriptions s LEFT JOIN leads l ON l.id = s.lead_id
    WHERE l.email IN ('tommello1234@gmail.com', 'gordaoda777@gmail.com', 'impactodigitalribeirao@gmail.com')
    GROUP BY s.lead_id, l.email
  `);
  console.log("\n=== Os 3 emails Asaas importados — quantas subs ativas cada? ===");
  for (const x of asaasImportados as any) {
    console.log(`  lead#${x.lead_id} | ${x.email} | ${x.ativas} ativa(s) de ${x.total} total | MRR R$${x.mrr ?? 0}`);
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
