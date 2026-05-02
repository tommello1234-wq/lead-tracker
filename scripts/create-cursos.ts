/**
 * Cadastra todos os produtos curso detectados nos leads + associa.
 */
import { db } from "../db/client";
import { produtos } from "../db/schema";
import { eq, sql } from "drizzle-orm";

const PRODUCTS = [
  {
    nome: "Designer de Prompt",
    patterns: ["Designer de Prompt"],
    cor: "oklch(0.72 0.18 60)",
  },
  {
    nome: "Designer Master",
    patterns: ["Designer Master"],
    cor: "oklch(0.62 0.20 280)",
  },
  {
    nome: "Proposta Comercial Automática",
    patterns: ["Proposta Comercial Automática", "PCA"],
    cor: "oklch(0.68 0.18 30)",
  },
  {
    nome: "Arsenal de Páginas",
    patterns: ["Arsenal de Páginas", "ADP"],
    cor: "oklch(0.58 0.18 220)",
  },
  {
    nome: "Lucrando com foto de IA",
    patterns: ["Lucrando com foto de IA", "LCIA"],
    cor: "oklch(0.78 0.16 90)",
  },
  {
    nome: "Launcher Designer",
    patterns: ["Launcher Designer"],
    cor: "oklch(0.62 0.20 320)",
  },
  {
    nome: "Upward Academy",
    patterns: ["Upward Academy"],
    cor: "oklch(0.55 0.18 250)",
  },
  {
    nome: "Vortex Start",
    patterns: ["Vortex Start"],
    cor: "oklch(0.68 0.22 10)",
  },
];

async function main() {
  console.log("\n=== Cadastrando produtos curso ===\n");
  let totalCriados = 0;
  let totalAssociados = 0;

  for (const p of PRODUCTS) {
    // Cria produto se não existe (match por nome exato)
    const existing = await db.query.produtos.findFirst({
      where: eq(produtos.nome, p.nome),
    });

    let produtoId: number;
    if (existing) {
      produtoId = existing.id;
      console.log(`✓ Já existia: ${p.nome} (#${existing.id})`);
    } else {
      const [created] = await db
        .insert(produtos)
        .values({
          nome: p.nome,
          tipo: "curso",
          cor: p.cor,
          gatewayMatch: p.patterns,
          ativo: true,
        })
        .returning();
      produtoId = created.id;
      totalCriados++;
      console.log(`+ Criado: ${p.nome} (#${created.id}, ${p.cor})`);
    }

    // Associa leads via ILIKE — só pra leads sem produto_id ainda
    const ilikeClauses = p.patterns.map((pat) => `plano_nome ilike '%${pat}%'`).join(" or ");
    const result = await db.execute<{ id: number }>(sql.raw(`
      update leads
      set produto_id = ${produtoId}
      where produto_id is null and (${ilikeClauses})
      returning id
    `));
    const associated = (result as unknown as Array<{ id: number }>).length;
    totalAssociados += associated;
    if (associated > 0) console.log(`  → ${associated} leads associados`);
  }

  console.log(`\n=== Resumo ===`);
  console.log(`Produtos criados:  ${totalCriados}`);
  console.log(`Leads associados:  ${totalAssociados}`);

  // Quantos sobram sem produto?
  const sobra = await db.execute<{ n: number; planos: string }>(sql`
    select count(*)::int as n, string_agg(distinct plano_nome, ' | ') as planos
    from leads
    where produto_id is null
  `);
  const s = (sobra as unknown as Array<{ n: number; planos: string }>)[0];
  console.log(`\nLeads SEM produto (resíduo): ${s.n}`);
  if (s.n > 0 && s.n < 30) console.log(`Planos: ${s.planos}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
