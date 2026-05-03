/**
 * Investiga os leads com planoNome = "Gravyx" (sem sufixo).
 * Pra entender se é legado, parsing falhou, ou outro motivo.
 */
import { db } from "../db/client.js";
import { leads, eventos } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

async function main() {
  const list = await db
    .select()
    .from(leads)
    .where(and(eq(leads.produtoId, 1), eq(leads.planoNome, "Gravyx")));

  console.log(`${list.length} leads com planoNome = "Gravyx" (sem sufixo)\n`);

  // Distribuição por gateway/source
  const byGateway = new Map<string, number>();
  for (const l of list) {
    const k = l.gateway ?? "null";
    byGateway.set(k, (byGateway.get(k) ?? 0) + 1);
  }
  console.log("Por gateway:");
  for (const [k, v] of byGateway) console.log(`  ${k}: ${v}`);

  // Datas: mostra o range
  const datas = list
    .map((l) => l.criadoEm)
    .filter(Boolean)
    .sort();
  if (datas.length > 0) {
    console.log(`\nCriado entre: ${datas[0]?.toISOString()} → ${datas[datas.length - 1]?.toISOString()}`);
  }

  // Mostra 5 exemplos com payload do primeiro evento pra ver
  // como o webhook chegou
  console.log("\n5 exemplos com 1º evento:");
  for (const l of list.slice(0, 5)) {
    console.log(`\n  Lead ${l.id}: ${l.nome}`);
    console.log(`    gateway=${l.gateway} status=${l.status} sub=${l.subscriptionStatus}`);
    console.log(`    valorAssinatura=${l.valorAssinatura} criado=${l.criadoEm?.toISOString().slice(0, 10)}`);

    const ev = (await db.execute(sql`
      select event_type, source, payload
      from eventos where lead_id = ${l.id}
      order by received_at asc
      limit 1
    `)) as unknown as Array<{ event_type: string; source: string; payload: object }>;

    if (ev[0]) {
      const p = ev[0].payload as Record<string, unknown>;
      const item = (p.item ?? p.offer ?? p.product) as Record<string, unknown> | undefined;
      console.log(`    1º evento: ${ev[0].event_type} (source: ${ev[0].source})`);
      console.log(`    payload.item.product_name: ${item?.product_name ?? "—"}`);
      console.log(`    payload.item.offer_name: ${item?.offer_name ?? "—"}`);
      console.log(`    payload.product.name: ${(p.product as Record<string, unknown>)?.name ?? "—"}`);
      console.log(`    payload.offer.name: ${(p.offer as Record<string, unknown>)?.name ?? "—"}`);
    }
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
