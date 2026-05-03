/**
 * Valida o lead aurelio (+55 85 99616-9441) — mensagem de reembolso correta?
 */
import { db } from "../db/client.js";
import { leads } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

async function main() {
  const matches = await db
    .select()
    .from(leads)
    .where(eq(leads.contato, "5585996169441"));

  if (matches.length === 0) {
    console.log("Nenhum lead com esse telefone");
    process.exit(0);
  }

  for (const lead of matches) {
    console.log(`\n=== LEAD ${lead.id}: ${lead.nome} ===`);
    console.log(`status: ${lead.status} | sub: ${lead.subscriptionStatus}`);
    console.log(`tipo: ${lead.tipo}`);
    console.log(`pagouEm: ${lead.pagouEm?.toISOString() ?? "—"}`);
    console.log(`canceladoEm: ${lead.canceladoEm?.toISOString() ?? "—"}`);
    console.log(`plano: ${lead.planoNome} | valor: ${lead.valorAssinatura}`);
    console.log(`criadoEm: ${lead.criadoEm?.toISOString()}`);

    const evs = (await db.execute(sql`
      select id, event_type, processed_ok, erro,
             received_at at time zone 'America/Sao_Paulo' as ts_brt
      from eventos where lead_id = ${lead.id}
      order by received_at asc
    `)) as unknown as Array<{
      id: number;
      event_type: string;
      processed_ok: boolean;
      erro: string | null;
      ts_brt: Date | string;
    }>;
    console.log(`\nEVENTOS (${evs.length}):`);
    for (const e of evs) {
      const t = String(e.ts_brt).slice(0, 19);
      console.log(
        `  [${t}] ${e.event_type}` + (e.erro ? ` | erro: ${e.erro}` : ""),
      );
    }

    const msgs = (await db.execute(sql`
      select id, template, status, erro,
             criado_em at time zone 'America/Sao_Paulo' as criado_brt,
             enviado_em at time zone 'America/Sao_Paulo' as enviado_brt
      from mensagens_agendadas where lead_id = ${lead.id}
      order by criado_em asc
    `)) as unknown as Array<{
      id: number;
      template: string;
      status: string;
      erro: string | null;
      criado_brt: Date | string;
      enviado_brt: Date | string | null;
    }>;
    console.log(`\nMENSAGENS (${msgs.length}):`);
    for (const m of msgs) {
      console.log(
        `  ${m.template} | status=${m.status}` +
          (m.erro ? ` | erro: ${m.erro}` : ""),
      );
      console.log(`    criado:  ${String(m.criado_brt).slice(0, 19)}`);
      console.log(
        `    enviado: ${m.enviado_brt ? String(m.enviado_brt).slice(0, 19) : "—"}`,
      );
    }
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
