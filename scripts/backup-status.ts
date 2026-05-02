/**
 * Cria tabela de backup com o status atual antes da reconciliação.
 * Pra reverter: insert into leads (id, status, subscription_status)
 *               select id, status, subscription_status from leads_backup_<ts>;
 */
import { db } from "../db/client";
import { sql } from "drizzle-orm";

const ts = new Date().toISOString().replace(/[:.]/g, "_").substring(0, 19);
const tableName = `leads_backup_${ts}`;

async function main() {
  await db.execute(
    sql.raw(
      `create table "${tableName}" as
       select id, status, subscription_status, atualizado_em
       from leads`,
    ),
  );
  const r = await db.execute(sql.raw(`select count(*)::int as n from "${tableName}"`));
  const row = (r as unknown as Array<{ n: number }>)[0];
  console.log(`✓ Backup criado: ${tableName} (${row?.n} linhas)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
