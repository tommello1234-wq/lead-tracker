/**
 * Repara o Lead 462 que ficou com dados mesclados Felipe + Clodoaldo.
 * Restaura nome/phone/email do Felipe (do payload original do compra_recusada).
 * Reassocia o evento 989 pro Lead 463 (Clodoaldo) — onde ele pertence.
 */
import { db } from "../db/client.js";
import { leads, eventos } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

async function main() {
  // 1. Restaura Lead 462 com dados originais do Felipe Santos
  const r1 = await db
    .update(leads)
    .set({
      nome: "FELIPE SANTOS",
      contato: "5521991460225",
      email: "bigodesublimacao@gmail.com",
    })
    .where(eq(leads.id, 462));
  console.log("Lead 462 restaurado pro Felipe:", r1);

  // 2. Reassocia evento 989 (carrinho_abandonado do Clodoaldo) pro Lead 463
  const r2 = await db
    .update(eventos)
    .set({ leadId: 463 })
    .where(eq(eventos.id, 989));
  console.log("Evento 989 movido pro Lead 463:", r2);

  // Verifica resultado
  const after = (await db.execute(sql`
    select id, nome, contato, email, status from leads where id in (462, 463)
  `)) as unknown as Array<{
    id: number;
    nome: string;
    contato: string;
    email: string;
    status: string;
  }>;
  console.log("\nLeads depois da correção:");
  for (const l of after) {
    console.log(`  ${l.id}: ${l.nome} | ${l.contato} | ${l.email} | ${l.status}`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
