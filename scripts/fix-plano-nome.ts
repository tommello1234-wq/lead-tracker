/**
 * Reclassifica leads cujo planoNome ficou só "Gravyx" (sem oferta).
 * Pega product_name + offer_name do payload do primeiro evento que tem.
 *
 * Modo dry-run por padrão. Passa --apply pra realmente atualizar.
 */
import { db } from "../db/client.js";
import { leads } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

async function main() {
  const list = await db
    .select()
    .from(leads)
    .where(and(eq(leads.produtoId, 1), eq(leads.planoNome, "Gravyx")));

  console.log(`${list.length} leads com planoNome="Gravyx" pra reclassificar`);
  console.log(`Modo: ${APPLY ? "APPLY (vai atualizar)" : "dry-run"}\n`);

  let updated = 0;
  let skipped = 0;

  for (const l of list) {
    // Pega o primeiro evento com payload rico (compra_aprovada > pix_gerado > etc)
    const ev = (await db.execute(sql`
      select event_type, payload
      from eventos
      where lead_id = ${l.id}
        and event_type in ('compra_aprovada', 'pix_gerado', 'compra_recusada', 'assinatura_renovada')
      order by received_at asc
      limit 1
    `)) as unknown as Array<{ event_type: string; payload: Record<string, unknown> }>;

    if (ev.length === 0) {
      console.log(`  [skip] ${l.id} ${l.nome}: nenhum evento com payload`);
      skipped++;
      continue;
    }

    const p = ev[0].payload;
    const item = p.item as Record<string, unknown> | undefined;
    const productName =
      (item?.product_name as string) ??
      ((p.product as Record<string, unknown>)?.name as string);
    const offerName =
      (item?.offer_name as string) ??
      ((p.offer as Record<string, unknown>)?.name as string);

    const novoPlano =
      productName && offerName
        ? `${productName} ${offerName}`
        : (productName ?? offerName ?? null);

    if (!novoPlano || novoPlano === "Gravyx") {
      console.log(`  [skip] ${l.id} ${l.nome}: payload sem oferta`);
      skipped++;
      continue;
    }

    console.log(`  ${l.id} ${l.nome.slice(0, 25).padEnd(25)} → "${novoPlano}"`);
    if (APPLY) {
      await db
        .update(leads)
        .set({ planoNome: novoPlano })
        .where(eq(leads.id, l.id));
    }
    updated++;
  }

  console.log(`\n${updated} ${APPLY ? "atualizados" : "seriam atualizados"}, ${skipped} skipados`);
  if (!APPLY) {
    console.log(`\nRode novamente com --apply pra aplicar`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
