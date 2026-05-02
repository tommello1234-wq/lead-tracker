/**
 * Mostra histórico completo de eventos de um lead.
 * Roda: node --env-file=.env.local --import tsx scripts/inspect-lead.ts <leadId>
 */
import { db } from "../db/client";
import { leads, eventos, mensagensAgendadas } from "../db/schema";
import { eq, desc, asc } from "drizzle-orm";

const leadId = Number(process.argv[2]);
if (!leadId) {
  console.error("Uso: node --env-file=.env.local --import tsx scripts/inspect-lead.ts <leadId>");
  process.exit(1);
}

async function main() {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  if (!lead) {
    console.error(`Lead ${leadId} não encontrado`);
    process.exit(1);
  }

  const fmt = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("pt-BR", {
          timeZone: "America/Sao_Paulo",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(d)
      : "-";

  console.log(`\n=== LEAD #${lead.id} ===`);
  console.log(`Nome:                ${lead.nome}`);
  console.log(`Contato:             ${lead.contato ?? "-"}`);
  console.log(`Email:               ${lead.email ?? "-"}`);
  console.log(`Status atual:        ${lead.status}`);
  console.log(`Subscription:        ${lead.subscriptionStatus}`);
  console.log(`Plano:               ${lead.planoNome ?? "-"} — R$ ${lead.valorAssinatura ?? 0}`);
  console.log(`Gateway customer ID: ${lead.gatewayCustomerId ?? "-"}`);
  console.log(`Última order:        ${lead.gatewayLastOrderId ?? "-"}`);
  console.log(`Criado em:           ${fmt(lead.criadoEm)}`);
  console.log(`PIX gerado:          ${fmt(lead.pixGeradoEm)}`);
  console.log(`Pagou em:            ${fmt(lead.pagouEm)}`);
  console.log(`Última renovação:    ${fmt(lead.ultimaRenovacaoEm)}`);
  console.log(`Cancelado em:        ${fmt(lead.canceladoEm)}`);

  console.log(`\n=== EVENTOS (sequência cronológica) ===\n`);
  const events = await db
    .select()
    .from(eventos)
    .where(eq(eventos.leadId, lead.id))
    .orderBy(asc(eventos.receivedAt));

  if (events.length === 0) {
    console.log("Sem eventos registrados.");
  } else {
    events.forEach((e, idx) => {
      const ok = e.processedOk ? "✓" : "✗";
      console.log(`[${idx + 1}] ${fmt(e.receivedAt)} ${ok} ${e.source}/${e.eventType}`);
      if (e.erro) console.log(`     erro: ${e.erro}`);
      // Tenta extrair status e payment_method do payload
      const p = e.payload as Record<string, unknown>;
      const ticto = {
        status: p?.status,
        payment_method: p?.payment_method,
        sub_status: ((p?.subscription as Record<string, unknown>) ?? {})?.status,
        successful_charges: ((p?.subscriptions as Array<Record<string, unknown>>) ?? [])[0]?.successful_charges,
      };
      const present = Object.entries(ticto).filter(([_, v]) => v !== undefined);
      if (present.length > 0) {
        console.log(`     payload: ${present.map(([k, v]) => `${k}=${v}`).join(", ")}`);
      }
    });
  }

  console.log(`\n=== MENSAGENS AGENDADAS ===\n`);
  const msgs = await db
    .select()
    .from(mensagensAgendadas)
    .where(eq(mensagensAgendadas.leadId, lead.id))
    .orderBy(asc(mensagensAgendadas.criadoEm));

  if (msgs.length === 0) {
    console.log("Sem mensagens agendadas.");
  } else {
    msgs.forEach((m, idx) => {
      console.log(
        `[${idx + 1}] ${m.template} — status: ${m.status} — agendado: ${fmt(m.agendadoPara)} ${m.enviadoEm ? `— enviado: ${fmt(m.enviadoEm)}` : ""}${m.erro ? `\n     erro: ${m.erro}` : ""}`
      );
    });
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
