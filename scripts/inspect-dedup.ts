/**
 * Verifica se a busca por telefone funciona corretamente.
 */
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";

async function main() {
  // Quantos leads tem com esse telefone exato
  const r = (await db.execute(sql`
    select id, nome, contato, email, gateway_customer_id, criado_em
    from leads where contato = '5511984171235'
    order by criado_em asc
  `)) as unknown as Array<{
    id: number;
    nome: string;
    contato: string;
    email: string | null;
    gateway_customer_id: string | null;
    criado_em: Date;
  }>;

  console.log(`Encontrei ${r.length} lead(s) com telefone exatamente '5511984171235':`);
  for (const l of r) {
    console.log(
      `  id=${l.id} nome="${l.nome}" email="${l.email}" customerId=${l.gateway_customer_id} criado=${l.criado_em}`,
    );
  }

  // Casos onde o mesmo telefone aparece em vários leads
  const dupes = (await db.execute(sql`
    select contato, count(*) as n, array_agg(id) as ids
    from leads
    where contato is not null and contato != ''
    group by contato
    having count(*) > 1
    order by n desc
    limit 20
  `)) as unknown as Array<{
    contato: string;
    n: number;
    ids: number[];
  }>;
  console.log(`\n${dupes.length} telefones aparecem em múltiplos leads (top 20):`);
  for (const d of dupes) {
    console.log(`  ${d.contato} → ${d.n} leads (ids: ${d.ids.join(", ")})`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
