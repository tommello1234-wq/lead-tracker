/**
 * Lista clientes em risco com data de primeira assinatura + última renovação.
 * Roda: npx tsx --env-file=.env.local scripts/list-em-risco.ts
 */
import { db } from "../db/client";
import { leads } from "../db/schema";
import { desc, eq } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      id: leads.id,
      nome: leads.nome,
      contato: leads.contato,
      planoNome: leads.planoNome,
      valor: leads.valorAssinatura,
      assinaturaStatus: leads.subscriptionStatus,
      pagouEm: leads.pagouEm,
      ultimaRenovacao: leads.ultimaRenovacaoEm,
      atualizadoEm: leads.atualizadoEm,
    })
    .from(leads)
    .where(eq(leads.status, "cliente_em_risco"))
    .orderBy(desc(leads.pagouEm));

  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  console.log(`\n=== ${rows.length} clientes em risco ===\n`);
  console.log(
    "ID  | Nome                          | Plano                  | Valor    | Assinatura desde       | Última renovação       | Status"
  );
  console.log("-".repeat(170));

  for (const r of rows) {
    const id = String(r.id).padEnd(3);
    const nome = (r.nome ?? "-").substring(0, 28).padEnd(29);
    const plano = (r.planoNome ?? "-").substring(0, 22).padEnd(22);
    const valor = `R$ ${(r.valor ?? 0).toFixed(2).replace(".", ",")}`.padEnd(8);
    const pagou = r.pagouEm ? fmt.format(r.pagouEm) : "(sem registro)";
    const renov = r.ultimaRenovacao ? fmt.format(r.ultimaRenovacao) : "(nunca)";
    const stat = r.assinaturaStatus.padEnd(12);
    console.log(`${id} | ${nome} | ${plano} | ${valor} | ${pagou.padEnd(22)} | ${renov.padEnd(22)} | ${stat}`);
  }

  // Estatísticas
  const totalMrr = rows.reduce((acc, r) => acc + (r.valor ?? 0), 0);
  const semRenovacao = rows.filter((r) => !r.ultimaRenovacao).length;
  const comRenovacao = rows.length - semRenovacao;

  console.log("\n=== Resumo ===");
  console.log(`  MRR em risco:                R$ ${totalMrr.toFixed(2).replace(".", ",")}`);
  console.log(`  Nunca renovaram (1ª falha):  ${semRenovacao}`);
  console.log(`  Já tinham renovado antes:    ${comRenovacao}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
