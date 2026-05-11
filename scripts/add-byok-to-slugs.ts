/**
 * Adiciona -byok- nos slugs /agencia-velocidade-v1-long e
 * /designer-controle-v1-long no DB.
 *
 * Motivo: hoje todas as ofertas Gravyx são BYOK (user usa chave API
 * própria, paga pelo uso). 'Com Créditos' é plano futuro — fica
 * reservado p/ slugs sem -byok-.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import postgres from "postgres";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
if (!url) {
  console.error("DATABASE_URL nao definida");
  process.exit(1);
}

const RENAMES = [
  { old: "/agencia-velocidade-v1-long", new: "/agencia-velocidade-v1-byok-long" },
  { old: "/designer-controle-v1-long", new: "/designer-controle-v1-byok-long" },
];

const sql = postgres(url, { max: 1 });

async function main() {
  for (const { old: oldSlug, new: newSlug } of RENAMES) {
    console.log(`\n=== ${oldSlug} → ${newSlug} ===`);

    const c = await sql<Array<{ id: number; lp_url: string }>>`
      UPDATE criativos
      SET lp_url = REPLACE(lp_url, ${oldSlug}, ${newSlug}),
          atualizado_em = NOW()
      WHERE lp_url LIKE ${"%" + oldSlug + "%"}
      RETURNING id, lp_url
    `;
    console.log(`  Criativos: ${c.length}`);
    for (const r of c) console.log(`    #${r.id} → ${r.lp_url}`);

    const a = await sql<Array<{ id: number; nome: string; lp_url: string }>>`
      UPDATE angulos
      SET lp_url = REPLACE(lp_url, ${oldSlug}, ${newSlug}),
          atualizado_em = NOW()
      WHERE lp_url LIKE ${"%" + oldSlug + "%"}
      RETURNING id, nome, lp_url
    `;
    console.log(`  Ângulos: ${a.length}`);
    for (const r of a) console.log(`    #${r.id} "${r.nome}"`);
  }

  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
