/**
 * Verifica lead institutotecnicopaulista — comprou? mensagem enviada?
 */
import { db } from "../db/client.js";
import { leads } from "../db/schema.js";
import { sql, eq } from "drizzle-orm";

async function main() {
  const matches = await db
    .select()
    .from(leads)
    .where(eq(leads.email, "institutotecnicopaulista@gmail.com"));

  if (matches.length === 0) {
    console.log("Nenhum lead com esse email encontrado");
    process.exit(0);
  }

  for (const lead of matches) {
    console.log(`\n=== LEAD ${lead.id}: ${lead.nome} ===`);
    console.log(`email: ${lead.email}`);
    console.log(`telefone: ${lead.contato}`);
    console.log(`status: ${lead.status} | sub: ${lead.subscriptionStatus}`);
    console.log(`pagouEm: ${lead.pagouEm?.toISOString() ?? "—"}`);
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
      ts_brt: string;
    }>;
    console.log(`\nEVENTOS (${evs.length}):`);
    for (const e of evs) {
      console.log(
        `  [${String(e.ts_brt).slice(0, 19)}] ${e.event_type}` +
          (e.erro ? ` | erro: ${e.erro}` : ""),
      );
    }

    const msgs = (await db.execute(sql`
      select id, template, status, erro,
             criado_em at time zone 'America/Sao_Paulo' as criado_brt,
             agendado_para at time zone 'America/Sao_Paulo' as agendado_brt,
             enviado_em at time zone 'America/Sao_Paulo' as enviado_brt
      from mensagens_agendadas where lead_id = ${lead.id}
      order by criado_em asc
    `)) as unknown as Array<{
      id: number;
      template: string;
      status: string;
      erro: string | null;
      criado_brt: string;
      agendado_brt: string;
      enviado_brt: string | null;
    }>;
    console.log(`\nMENSAGENS (${msgs.length}):`);
    for (const m of msgs) {
      console.log(
        `  ${m.template} | status=${m.status}` + (m.erro ? ` | erro: ${m.erro}` : ""),
      );
      console.log(`    criado: ${String(m.criado_brt).slice(0, 19)}`);
      console.log(`    agendado: ${String(m.agendado_brt).slice(0, 19)}`);
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
