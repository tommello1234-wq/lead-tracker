import { db } from "/Users/washingtonmelodesouza/Documents/PROJETO BACKUP/Planilha de leads/lead-tracker/db/client.js";
import { sql } from "drizzle-orm";

async function run() {
  const r = await db.execute(sql`
    SELECT s.gateway, s.periodicidade, p.nome as produto, p.ativo as prod_ativo,
      COUNT(*) as n,
      SUM(s.valor) as soma_bruto,
      SUM(CASE WHEN s.periodicidade='mensal' THEN s.valor WHEN s.periodicidade='anual' THEN s.valor/12.0 ELSE 0 END)::numeric(10,2) as mrr
    FROM subscriptions s LEFT JOIN produtos p ON p.id=s.produto_id
    WHERE s.status = 'ativa'
    GROUP BY 1, 2, 3, 4 ORDER BY mrr DESC
  `);
  console.log("=== MRR detalhado (TODAS subs ativas) ===");
  let total = 0;
  for (const x of r as any) {
    const ind = !x.prod_ativo ? " ⚠️" : "";
    console.log(`${x.gateway} | ${x.periodicidade} | ${x.produto ?? "NULL"}${ind} | ${x.n} subs | R$${x.mrr}`);
    total += Number(x.mrr);
  }
  console.log(`\nTOTAL MRR: R$ ${total.toFixed(2)}\n`);

  const r2 = await db.execute(sql`
    SELECT s.gateway, COUNT(*) as n,
      SUM(CASE WHEN s.periodicidade='mensal' THEN s.valor WHEN s.periodicidade='anual' THEN s.valor/12.0 ELSE 0 END)::numeric(10,2) as mrr
    FROM subscriptions s
    WHERE s.status = 'ativa'
      AND (s.produto_id IS NULL OR s.produto_id IN (SELECT id FROM produtos WHERE ativo = true))
    GROUP BY 1 ORDER BY mrr DESC
  `);
  console.log("=== MRR filtro dashboard (exclui produtos inativos) ===");
  let t2 = 0;
  for (const x of r2 as any) { console.log(`${x.gateway} | ${x.n} subs | R$${x.mrr}`); t2 += Number(x.mrr); }
  console.log(`TOTAL: R$ ${t2.toFixed(2)}`);

  const r3 = await db.execute(sql`
    SELECT s.gateway, COUNT(*) as n,
      SUM(CASE WHEN s.periodicidade='mensal' THEN s.valor WHEN s.periodicidade='anual' THEN s.valor/12.0 ELSE 0 END)::numeric(10,2) as mrr
    FROM subscriptions s
    WHERE s.status = 'ativa' AND s.produto_id = 1
    GROUP BY 1 ORDER BY mrr DESC
  `);
  console.log("\n=== MRR só Gravyx (id=1) ===");
  let t3 = 0;
  for (const x of r3 as any) { console.log(`${x.gateway} | ${x.n} subs | R$${x.mrr}`); t3 += Number(x.mrr); }
  console.log(`TOTAL Gravyx: R$ ${t3.toFixed(2)}`);
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
