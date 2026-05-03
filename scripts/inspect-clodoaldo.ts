/**
 * Investiga timeline de eventos + mensagens de Clodoaldo (caso da msg
 * carrinho_abandonado retroativa).
 */
import { db } from "../db/client.js";
import { leads } from "../db/schema.js";
import { sql, ilike } from "drizzle-orm";

async function main() {
  const matches = await db.select().from(leads).where(ilike(leads.nome, "%Clodoaldo%"));
  console.log(`Encontrei ${matches.length} lead(s) com nome Clodoaldo`);
  for (const lead of matches) {
    console.log(`\n=== LEAD ${lead.id}: ${lead.nome} ===`);
    console.log(`status: ${lead.status} | sub: ${lead.subscriptionStatus}`);
    console.log(`contato (tel): ${lead.contato}`);
    console.log(`email: ${lead.email}`);
    console.log(`gatewayCustomerId: ${lead.gatewayCustomerId}`);
    console.log(`gatewayLastOrderId: ${lead.gatewayLastOrderId}`);
    console.log(`pagouEm: ${lead.pagouEm?.toISOString()}`);
    console.log(`pixGeradoEm: ${lead.pixGeradoEm?.toISOString()}`);
    console.log(`criadoEm: ${lead.criadoEm?.toISOString()}`);
    console.log(`atualizadoEm: ${lead.atualizadoEm?.toISOString()}`);

    const evs = (await db.execute(sql`
      select id, event_type, source, processed_ok, erro,
             received_at at time zone 'America/Sao_Paulo' as ts_brt
      from eventos where lead_id = ${lead.id}
        and received_at >= now() - interval '24 hours'
      order by received_at asc
    `)) as unknown as Array<{
      id: number;
      event_type: string;
      source: string;
      processed_ok: boolean;
      erro: string | null;
      ts_brt: Date;
    }>;
    console.log(`\nEVENTOS (${evs.length}):`);
    for (const e of evs) {
      const t = String(e.ts_brt).slice(11, 19);
      console.log(
        `  [${t}] id=${e.id} ${e.event_type} | source=${e.source} | ok=${e.processed_ok}${e.erro ? ` | erro=${e.erro}` : ""}`,
      );
    }

    const msgs = (await db.execute(sql`
      select id, template, status, erro,
             criado_em at time zone 'America/Sao_Paulo' as criado_brt,
             agendado_para at time zone 'America/Sao_Paulo' as agendado_brt,
             enviado_em at time zone 'America/Sao_Paulo' as enviado_brt
      from mensagens_agendadas where lead_id = ${lead.id}
        and criado_em >= now() - interval '24 hours'
      order by criado_em asc
    `)) as unknown as Array<{
      id: number;
      template: string;
      status: string;
      erro: string | null;
      criado_brt: Date;
      agendado_brt: Date;
      enviado_brt: Date | null;
    }>;
    console.log(`\nMENSAGENS (${msgs.length}):`);
    for (const m of msgs) {
      console.log(
        `  id=${m.id} ${m.template} | status=${m.status}` +
          (m.erro ? ` | erro=${m.erro}` : ""),
      );
      console.log(`    criado:   ${String(m.criado_brt).slice(11, 19)}`);
      console.log(`    agendado: ${String(m.agendado_brt).slice(11, 19)}`);
      console.log(`    enviado:  ${m.enviado_brt ? String(m.enviado_brt).slice(11, 19) : "-"}`);
    }
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
