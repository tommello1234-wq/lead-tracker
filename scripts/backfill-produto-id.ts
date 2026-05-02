import { db } from "../db/client";
import { sql } from "drizzle-orm";

async function main() {
  // Match leads sem produto associado pelo nome do plano
  const r = await db.execute(sql`
    update leads l
    set produto_id = p.id
    from produtos p
    where l.produto_id is null
      and (
        l.plano_nome ilike '%' || p.nome || '%'
        or l.plano_nome ilike '%' || split_part(p.nome, ' ', 1) || '%'
      )
    returning l.id
  `);
  const rows = r as unknown as Array<{ id: number }>;
  console.log(`✓ Associados ${rows.length} leads com produtos via match de nome de plano`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
