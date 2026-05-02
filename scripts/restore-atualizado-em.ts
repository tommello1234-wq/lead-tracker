/**
 * Restaura o atualizado_em original do backup, mantendo os status novos.
 */
import { db } from "../db/client";
import { sql } from "drizzle-orm";

const BACKUP_TABLE = "leads_backup_2026-05-02T11_32_39";

async function main() {
  // Restaura atualizado_em do backup só pros leads que tiveram status mudado
  // (assim os outros não são afetados).
  const result = await db.execute<{ updated: number }>(sql`
    update leads l
    set atualizado_em = b.atualizado_em
    from ${sql.raw(`"${BACKUP_TABLE}"`)} b
    where l.id = b.id
      and (l.status != b.status or l.subscription_status != b.subscription_status)
    returning l.id
  `);
  const rows = result as unknown as Array<{ id: number }>;
  console.log(`✓ Restaurado atualizado_em original em ${rows.length} leads`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
