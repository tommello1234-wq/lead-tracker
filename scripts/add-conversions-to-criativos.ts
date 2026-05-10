/**
 * Adiciona métricas de conversão da LP em criativos.
 *
 * Vem do Meta Ads:
 * - lpViews        = landingPageViews (pessoas que carregaram a LP)
 * - checkouts      = initiateCheckout (clicaram em comprar)
 * - compras        = purchases        (compra confirmada via pixel)
 *
 * Com isso dá pra calcular CTC (checkouts/lpViews) e CR (compras/lpViews)
 * agregando todos os criativos que apontam pra mesma LP.
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
  await sql`ALTER TABLE criativos ADD COLUMN IF NOT EXISTS lp_views INTEGER`;
  console.log("✅ Coluna lp_views adicionada (ou já existia)");

  await sql`ALTER TABLE criativos ADD COLUMN IF NOT EXISTS checkouts INTEGER`;
  console.log("✅ Coluna checkouts adicionada (ou já existia)");

  await sql`ALTER TABLE criativos ADD COLUMN IF NOT EXISTS compras INTEGER`;
  console.log("✅ Coluna compras adicionada (ou já existia)");

  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
