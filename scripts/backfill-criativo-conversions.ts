/**
 * Backfill de lp_views, checkouts, compras nos criativos já importados.
 *
 * Pra cada criativo com meta_ads_id, busca métricas no Meta Ads e
 * atualiza o registro. Idempotente — roda sempre que quiser refrescar.
 *
 * Uso: npx tsx scripts/backfill-criativo-conversions.ts [--days=90]
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import postgres from "postgres";
import { getAds } from "../server/lib/meta-ads.js";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
if (!url) {
  console.error("DATABASE_URL nao definida");
  process.exit(1);
}

const daysArg = process.argv.find((a) => a.startsWith("--days="));
const days = daysArg ? Number(daysArg.split("=")[1]) : 90;

const sql = postgres(url, { max: 1 });

async function main() {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const until = new Date();

  console.log(`📊 Buscando ads do Meta nos últimos ${days} dias...`);
  const ads = await getAds(since, until, { limit: 500 });
  console.log(`   ${ads.length} ads retornados`);

  const adById = new Map(ads.map((a) => [a.adId, a]));

  const criativos = await sql<
    Array<{ id: number; meta_ads_id: string | null }>
  >`SELECT id, meta_ads_id FROM criativos WHERE meta_ads_id IS NOT NULL`;
  console.log(`📦 ${criativos.length} criativos com meta_ads_id no DB`);

  let updated = 0;
  let notFound = 0;

  for (const c of criativos) {
    if (!c.meta_ads_id) continue;
    const ad = adById.get(c.meta_ads_id);
    if (!ad) {
      notFound++;
      continue;
    }
    await sql`
      UPDATE criativos
      SET
        lp_views = ${ad.landingPageViews || null},
        checkouts = ${ad.initiateCheckout || null},
        compras = ${ad.purchases || null},
        ctr = ${ad.ctr || null},
        cpa = ${ad.cpa},
        impressoes = ${ad.impressions || null},
        atualizado_em = NOW()
      WHERE id = ${c.id}
    `;
    updated++;
    console.log(
      `   #${c.id} (${c.meta_ads_id}): ${ad.landingPageViews} views · ${ad.initiateCheckout} chk · ${ad.purchases} cmp`,
    );
  }

  console.log(`\n✅ Atualizados: ${updated}`);
  if (notFound > 0)
    console.log(`⚠️  Sem match no Meta: ${notFound} (ads deletados/expirados?)`);

  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
