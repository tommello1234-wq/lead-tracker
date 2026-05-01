import "dotenv/config";
import { db } from "./client";
import { eq } from "drizzle-orm";
import { mensagensAgendadas, leads } from "./schema";

async function main() {
  const lead = await db.query.leads.findFirst({
    where: eq(leads.gatewayCustomerId, "ticto_cust_999"),
  });

  if (!lead) {
    console.log("Lead nao encontrado");
    return;
  }

  console.log("\n=== LEAD ===");
  console.log(`  ID: ${lead.id}`);
  console.log(`  Nome: ${lead.nome}`);
  console.log(`  Status: ${lead.status}`);
  console.log(`  Subscription: ${lead.subscriptionStatus}`);
  console.log(`  Plano: ${lead.planoNome} - R$ ${lead.valorAssinatura}`);
  console.log(`  PIX gerado: ${lead.pixGeradoEm?.toISOString() ?? "-"}`);
  console.log(`  Pagou: ${lead.pagouEm?.toISOString() ?? "-"}`);

  const msgs = await db
    .select()
    .from(mensagensAgendadas)
    .where(eq(mensagensAgendadas.leadId, lead.id));

  console.log(`\n=== MENSAGENS (${msgs.length}) ===`);
  for (const m of msgs) {
    console.log(
      `  [${m.status.padEnd(8)}] ${m.template.padEnd(28)} agendado=${m.agendadoPara.toISOString()}  erro=${m.erro ?? "-"}`,
    );
  }
}

main().catch(console.error).finally(() => process.exit(0));
