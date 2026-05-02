/**
 * Motor de fluxos — define O QUE acontece quando um evento chega.
 *
 * Recebe: tipo do evento (compra_aprovada, pix_gerado, etc) + lead
 * Faz:
 *   1. Atualiza o status do lead
 *   2. Agenda mensagens com timing apropriado
 *   3. Cria o evento no audit log
 */

import { db } from "../../db/client.js";
import {
  leads,
  mensagensAgendadas,
  eventos,
  flowSteps,
  type Lead,
  type LeadStatus,
  type SubscriptionStatus,
  type MessageTemplate,
} from "../../db/schema.js";
import { renderTemplate } from "./message-templates.js";
import { eq, and, inArray, asc } from "drizzle-orm";

export type GatewayEvent =
  | "carrinho_abandonado"
  | "pix_gerado"
  | "pix_expirado"
  | "compra_aprovada"
  | "compra_recusada"
  | "reembolso"
  | "assinatura_renovada"
  | "assinatura_cancelada"
  | "assinatura_atrasada";

export type EventInput = {
  source: string; // "ticto" | "manual" | "stripe"
  eventType: GatewayEvent;
  rawPayload: unknown;
  // Identificacao do cliente
  nome: string;
  contato?: string | null; // telefone
  email?: string | null;
  gatewayCustomerId?: string | null;
  gatewayLastOrderId?: string | null;
  // Detalhes
  valor?: number | null;
  planoNome?: string | null;
  produtoId?: number | null;
  pixExpiraEm?: Date | null;
  extras?: Record<string, string | number | undefined>;
};

type FlowStep = {
  template: MessageTemplate;
  delaySeconds: number;
  /** Se true, cancela follow-ups anteriores antes de agendar este (evita spam quando cliente paga) */
  cancelPrevious?: boolean;
};

/**
 * Carrega o flow ativo de um GatewayEvent direto do banco (tabela flow_steps).
 * Editavel pelo dashboard em /automacoes.
 */
async function loadFlow(event: GatewayEvent): Promise<FlowStep[]> {
  const rows = await db
    .select()
    .from(flowSteps)
    .where(and(eq(flowSteps.gatewayEvent, event), eq(flowSteps.ativo, true)))
    .orderBy(asc(flowSteps.ordem));
  return rows.map((r) => ({
    template: r.templateKey,
    delaySeconds: r.delaySeconds,
    cancelPrevious: r.cancelPrevious,
  }));
}

/**
 * Mapeia evento -> novo status do lead e da assinatura.
 */
const STATUS_TRANSITIONS: Record<
  GatewayEvent,
  { lead: LeadStatus; subscription: SubscriptionStatus }
> = {
  carrinho_abandonado: { lead: "carrinho_abandonado", subscription: "nenhuma" },
  pix_gerado: { lead: "pix_gerado", subscription: "aguardando_pagamento" },
  pix_expirado: { lead: "pix_expirado", subscription: "nenhuma" },
  compra_aprovada: { lead: "cliente_ativo", subscription: "ativa" },
  compra_recusada: { lead: "pix_expirado", subscription: "nenhuma" },
  reembolso: { lead: "cliente_em_risco", subscription: "reembolsada" },
  assinatura_renovada: { lead: "cliente_ativo", subscription: "ativa" },
  assinatura_cancelada: { lead: "cliente_cancelado", subscription: "cancelada" },
  assinatura_atrasada: { lead: "cliente_em_risco", subscription: "atrasada" },
};

/**
 * Encontra ou cria um lead com base nos identificadores do gateway.
 * Prioridade: gatewayCustomerId > email > contato.
 */
async function findOrCreateLead(input: EventInput): Promise<Lead> {
  if (input.gatewayCustomerId) {
    const existing = await db.query.leads.findFirst({
      where: eq(leads.gatewayCustomerId, input.gatewayCustomerId),
    });
    if (existing) return existing;
  }
  if (input.email) {
    const existing = await db.query.leads.findFirst({
      where: eq(leads.email, input.email),
    });
    if (existing) return existing;
  }
  if (input.contato) {
    const existing = await db.query.leads.findFirst({
      where: eq(leads.contato, input.contato),
    });
    if (existing) return existing;
  }

  const [created] = await db
    .insert(leads)
    .values({
      nome: input.nome,
      contato: input.contato ?? null,
      email: input.email ?? null,
      tipo: tipoFromEvent(input.eventType),
      status: STATUS_TRANSITIONS[input.eventType].lead,
      origem: "site",
      gateway: input.source,
      gatewayCustomerId: input.gatewayCustomerId ?? null,
      gatewayLastOrderId: input.gatewayLastOrderId ?? null,
      valorAssinatura: input.valor ?? null,
      planoNome: input.planoNome ?? null,
      produtoId: input.produtoId ?? null,
      subscriptionStatus: STATUS_TRANSITIONS[input.eventType].subscription,
    })
    .returning();
  return created;
}

function tipoFromEvent(event: GatewayEvent): Lead["tipo"] {
  switch (event) {
    case "carrinho_abandonado":
      return "abandono_carrinho";
    case "pix_gerado":
    case "pix_expirado":
    case "compra_recusada":
      return "pix_nao_pago";
    case "compra_aprovada":
    case "assinatura_renovada":
      return "compra_aprovada";
    case "reembolso":
      return "reembolso";
    case "assinatura_cancelada":
      return "outro";
    default:
      return "outro";
  }
}

/**
 * Cancela mensagens pendentes deste lead nos templates dados.
 * Usado quando cliente paga -> nao manda mais cobranca de PIX.
 */
async function cancelPendingMessages(leadId: number, templates: MessageTemplate[]) {
  if (templates.length === 0) return;
  await db
    .update(mensagensAgendadas)
    .set({ status: "skipped", erro: "Cancelado por evento posterior" })
    .where(
      and(
        eq(mensagensAgendadas.leadId, leadId),
        eq(mensagensAgendadas.status, "pending"),
        inArray(mensagensAgendadas.template, templates),
      ),
    );
}

/**
 * Processa um evento do gateway de ponta a ponta.
 */
export async function handleGatewayEvent(input: EventInput): Promise<{
  leadId: number;
  scheduledMessages: number;
  status: LeadStatus;
}> {
  const lead = await findOrCreateLead(input);
  const transition = STATUS_TRANSITIONS[input.eventType];
  const now = new Date();

  // Atualiza o lead
  const updates: Record<string, unknown> = {
    status: transition.lead,
    subscriptionStatus: transition.subscription,
    atualizadoEm: now,
    nome: input.nome || lead.nome,
    contato: input.contato ?? lead.contato,
    email: input.email ?? lead.email,
    gatewayLastOrderId: input.gatewayLastOrderId ?? lead.gatewayLastOrderId,
    planoNome: input.planoNome ?? lead.planoNome,
    valorAssinatura: input.valor ?? lead.valorAssinatura,
  };

  if (input.eventType === "pix_gerado") {
    updates.pixGeradoEm = now;
    if (input.pixExpiraEm) updates.pixExpiraEm = input.pixExpiraEm;
  }
  if (input.eventType === "compra_aprovada") {
    updates.pagouEm = now;
    updates.convertidoEm = now;
  }
  if (input.eventType === "assinatura_renovada") {
    updates.ultimaRenovacaoEm = now;
  }
  if (input.eventType === "assinatura_cancelada") {
    updates.canceladoEm = now;
  }
  // Associa produto se vier no payload e o lead ainda nao tem
  if (input.produtoId && !lead.produtoId) {
    updates.produtoId = input.produtoId;
  }

  await db.update(leads).set(updates).where(eq(leads.id, lead.id));

  // Audit log
  await db.insert(eventos).values({
    leadId: lead.id,
    produtoId: input.produtoId ?? lead.produtoId ?? null,
    source: input.source,
    eventType: input.eventType,
    payload: input.rawPayload as object,
    processedOk: true,
  });

  // Agenda mensagens conforme o fluxo (lido do DB — editavel via /automacoes)
  const flow = await loadFlow(input.eventType);
  let scheduled = 0;

  // Cancela pendentes se o evento exigir (compra_aprovada cancela cobranca de PIX)
  const stepWithCancel = flow.find((s) => s.cancelPrevious);
  if (stepWithCancel) {
    await cancelPendingMessages(lead.id, [
      "pix_nao_pago",
      "carrinho_abandonado",
      "assinatura_pix_pendente",
    ]);
  }

  // Atualiza lead com novos campos pra renderizar templates
  const refreshedLead = { ...lead, ...updates } as Lead;

  for (const step of flow) {
    const conteudo = await renderTemplate(step.template, {
      lead: refreshedLead,
      extras: input.extras,
    });
    const agendadoPara = new Date(now.getTime() + step.delaySeconds * 1000);
    await db.insert(mensagensAgendadas).values({
      leadId: lead.id,
      template: step.template,
      conteudo,
      agendadoPara,
      status: "pending",
    });
    scheduled++;
  }

  return {
    leadId: lead.id,
    scheduledMessages: scheduled,
    status: transition.lead,
  };
}
