/**
 * Limpa refs a /emp-v2 e /comparativo nos criativos e ângulos.
 *
 * /emp-v2 e /comparativo serão apagados do GRAVYX LP V2. Pra não deixar
 * lp_url morta no DB, setar NULL nesses casos. Status do criativo
 * continua como veio do Meta sync.
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

const sql = postgres(url, { max: 1 });

async function main() {
  const updatedCriativos = await sql<Array<{ id: number; lp_url: string | null }>>`
    UPDATE criativos
    SET lp_url = NULL, atualizado_em = NOW()
    WHERE lp_url ILIKE '%/emp-v2%' OR lp_url ILIKE '%/comparativo%'
    RETURNING id, lp_url
  `;
  console.log(`✅ Criativos limpos (lp_url → NULL): ${updatedCriativos.length}`);
  for (const c of updatedCriativos) console.log(`   #${c.id}`);

  const updatedAngulos = await sql<Array<{ id: number; nome: string; lp_url: string | null }>>`
    UPDATE angulos
    SET lp_url = NULL, atualizado_em = NOW()
    WHERE lp_url ILIKE '%/emp-v2%' OR lp_url ILIKE '%/comparativo%'
    RETURNING id, nome, lp_url
  `;
  console.log(`✅ Ângulos limpos (lp_url → NULL): ${updatedAngulos.length}`);
  for (const a of updatedAngulos) console.log(`   #${a.id} "${a.nome}"`);

  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
