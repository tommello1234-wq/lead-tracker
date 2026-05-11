/**
 * Pre-flight pra cleanup de LPs.
 *
 * Lista todos os criativos + ângulos que apontam pra /comparativo ou /emp-v2,
 * com status. Bloquear apagar se algum ativo/pausado depender deles.
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
  console.log("\n=== ÂNGULOS apontando pra /comparativo ou /emp-v2 ===");
  const angulos = await sql<
    Array<{
      id: number;
      nome: string;
      lp_url: string | null;
      status: string;
      ativo: boolean;
    }>
  >`
    SELECT id, nome, lp_url, status, ativo
    FROM angulos
    WHERE lp_url ILIKE '%comparativo%' OR lp_url ILIKE '%emp-v2%'
    ORDER BY status, id
  `;
  if (angulos.length === 0) {
    console.log("   nenhum");
  } else {
    for (const a of angulos) {
      console.log(
        `   #${a.id} "${a.nome}" → ${a.lp_url} (status=${a.status}, ativo=${a.ativo})`,
      );
    }
  }

  console.log("\n=== CRIATIVOS apontando pra /comparativo ou /emp-v2 ===");
  const criativos = await sql<
    Array<{
      id: number;
      headline_overlay: string | null;
      lp_url: string | null;
      status: string;
      meta_ads_id: string | null;
      angulo_id: number | null;
    }>
  >`
    SELECT id, headline_overlay, lp_url, status, meta_ads_id, angulo_id
    FROM criativos
    WHERE lp_url ILIKE '%comparativo%' OR lp_url ILIKE '%emp-v2%'
    ORDER BY status, id
  `;
  if (criativos.length === 0) {
    console.log("   nenhum");
  } else {
    for (const c of criativos) {
      console.log(
        `   #${c.id} "${c.headline_overlay ?? "(sem headline)"}" → ${c.lp_url} (status=${c.status}, ângulo=${c.angulo_id}, meta_ads_id=${c.meta_ads_id})`,
      );
    }
  }

  // Resumo bloqueador
  const blockers = criativos.filter(
    (c) => c.status === "ativo" || c.status === "pausado",
  );
  console.log("\n=== RESUMO ===");
  console.log(
    `Criativos NÃO mortos apontando pra essas URLs: ${blockers.length}`,
  );
  if (blockers.length > 0) {
    console.log("⚠️  CONFIRMAR no Meta Ads se esses criativos estão rodando antes de apagar:");
    for (const b of blockers) console.log(`   #${b.id} meta_ads_id=${b.meta_ads_id} status=${b.status}`);
  } else {
    console.log("✅ Seguro pra apagar /comparativo e /emp-v2");
  }

  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
