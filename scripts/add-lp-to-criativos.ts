/**
 * Move LP do ângulo pro criativo.
 *
 * Antes: lp_url estava só em `angulos` (1 LP por ângulo).
 * Agora: cada criativo carrega sua própria lp_url (cada ad no Meta tem
 * URL de destino própria — herdar do ângulo é simplificação errada).
 *
 * Migração:
 * 1. Adiciona colunas lp_url + lp_screenshot na tabela criativos
 * 2. Backfill: copia lp_url do ângulo atual pra cada criativo filho
 *
 * Idempotente — usa IF NOT EXISTS e só preenche criativos com lp_url NULL.
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
  await sql`ALTER TABLE criativos ADD COLUMN IF NOT EXISTS lp_url TEXT`;
  console.log("✅ Coluna lp_url adicionada (ou já existia)");

  await sql`ALTER TABLE criativos ADD COLUMN IF NOT EXISTS lp_screenshot TEXT`;
  console.log("✅ Coluna lp_screenshot adicionada (ou já existia)");

  const updated = await sql`
    UPDATE criativos c
    SET
      lp_url = a.lp_url,
      lp_screenshot = a.lp_screenshot
    FROM angulos a
    WHERE c.angulo_id = a.id
      AND c.lp_url IS NULL
      AND a.lp_url IS NOT NULL
    RETURNING c.id, c.lp_url
  `;
  console.log(`✅ Backfill: ${updated.length} criativos atualizados com lp_url do ângulo`);

  for (const row of updated) {
    console.log(`   #${row.id} → ${row.lp_url}`);
  }

  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
