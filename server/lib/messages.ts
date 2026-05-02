import { db } from "../../db/client.js";
import {
  mensagensAgendadas,
  leads,
  type MessageTemplate,
  type MensagemAgendada,
} from "../../db/schema.js";
import { renderTemplate, type TemplateContext } from "./message-templates.js";
import { sendText } from "./evolution.js";
import { and, eq, lte } from "drizzle-orm";

export async function scheduleMessage(args: {
  leadId: number;
  template: MessageTemplate;
  agendadoPara: Date;
  extras?: TemplateContext["extras"];
}): Promise<MensagemAgendada> {
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, args.leadId),
  });
  if (!lead) throw new Error(`Lead ${args.leadId} nao encontrado`);

  const conteudo = await renderTemplate(args.template, {
    lead,
    extras: args.extras,
  });

  const [row] = await db
    .insert(mensagensAgendadas)
    .values({
      leadId: args.leadId,
      template: args.template,
      conteudo,
      agendadoPara: args.agendadoPara,
      status: "pending",
    })
    .returning();

  return row;
}

export async function dispatchPending(now: Date = new Date()): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const pending = await db
    .select()
    .from(mensagensAgendadas)
    .where(
      and(
        eq(mensagensAgendadas.status, "pending"),
        lte(mensagensAgendadas.agendadoPara, now),
      ),
    )
    .limit(50);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const msg of pending) {
    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, msg.leadId),
    });

    if (!lead?.contato) {
      await db
        .update(mensagensAgendadas)
        .set({ status: "skipped", erro: "Lead sem contato" })
        .where(eq(mensagensAgendadas.id, msg.id));
      skipped++;
      continue;
    }

    const result = await sendText(lead.contato, msg.conteudo);

    if (result.ok) {
      await db
        .update(mensagensAgendadas)
        .set({
          status: "sent",
          enviadoEm: new Date(),
          evolutionMessageId: result.messageId,
        })
        .where(eq(mensagensAgendadas.id, msg.id));
      sent++;

      // marca o lead como contatado se ainda for "novo"
      if (lead.status === "novo") {
        await db
          .update(leads)
          .set({
            status: "contatado",
            primeiroContatoEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(leads.id, lead.id));
      }
    } else {
      await db
        .update(mensagensAgendadas)
        .set({ status: "failed", erro: result.error })
        .where(eq(mensagensAgendadas.id, msg.id));
      failed++;
    }
  }

  return { processed: pending.length, sent, failed, skipped };
}
