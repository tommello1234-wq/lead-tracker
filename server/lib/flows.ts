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
import { eq, and, inArray, asc, gte, isNull, sql } from "drizzle-orm";

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
 * Prioridade: telefone > email > gatewayCustomerId.
 *
 * Telefone primeiro porque é o id mais estável (vai pro WhatsApp). Email pode
 * ser vazio/placeholder e gatewayCustomerId muda entre checkouts da Ticto
 * (cada session tem hash novo). Cuidado pra não buscar com placeholder
 * (ticto-parser já sanitiza, mas defesa em profundidade).
 */
async function findOrCreateLead(input: EventInput): Promise<Lead> {
  if (input.contato) {
    const existing = await db.query.leads.findFirst({
      where: eq(leads.contato, input.contato),
    });
    if (existing) return existing;
  }
  if (input.email && input.email.includes("@")) {
    const existing = await db.query.leads.findFirst({
      where: eq(leads.email, input.email),
    });
    if (existing) return existing;
  }
  if (input.gatewayCustomerId) {
    const existing = await db.query.leads.findFirst({
      where: eq(leads.gatewayCustomerId, input.gatewayCustomerId),
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
async function cancelPendingMessages(
  leadId: number,
  templates: MessageTemplate[],
  reason: string,
) {
  if (templates.length === 0) return 0;
  const result = await db
    .update(mensagensAgendadas)
    .set({ status: "skipped", erro: reason })
    .where(
      and(
        eq(mensagensAgendadas.leadId, leadId),
        eq(mensagensAgendadas.status, "pending"),
        inArray(mensagensAgendadas.template, templates),
      ),
    );
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

/**
 * Mapa semântico: quando evento X chega, cancela mensagens pendentes
 * de TODOS templates pertencentes aos eventos cancelados.
 *
 * Diferente do `cancelPrevious` antigo (que dependia de flag por step e
 * tinha lista hardcoded de templates), aqui o lookup é dinâmico — pega
 * todos templates que pertencem aos eventos no array via `flow_steps`.
 * Cobre automaticamente templates criados pelo user via UI.
 */
const EVENT_CANCELS: Record<GatewayEvent, GatewayEvent[]> = {
  // Pagamento entrou — cancela tudo de cobrança pendente
  compra_aprovada: ["pix_gerado", "carrinho_abandonado", "assinatura_atrasada"],
  // Renovação OK — cancela cobrança de atraso
  assinatura_renovada: ["assinatura_atrasada"],
  // Cancelamento — cliente foi embora, cancela tudo
  assinatura_cancelada: [
    "assinatura_atrasada",
    "compra_aprovada",
    "assinatura_renovada",
    "pix_gerado",
    "carrinho_abandonado",
  ],
  // Reembolso — cancela boas-vindas pra não aparecer mensagem positiva
  reembolso: ["compra_aprovada", "assinatura_renovada"],
  // Eventos que NÃO cancelam (são iniciadores ou auditoria)
  carrinho_abandonado: [],
  pix_gerado: [],
  pix_expirado: [],
  compra_recusada: [],
  assinatura_atrasada: [],
};

/**
 * Aplica o mapa EVENT_CANCELS: marca como skipped todas as mensagens
 * pendentes do lead cujos templates pertencem aos eventos cancelados.
 */
async function applyEventCancellation(
  leadId: number,
  newEvent: GatewayEvent,
): Promise<number> {
  const cancelEvents = EVENT_CANCELS[newEvent];
  if (!cancelEvents || cancelEvents.length === 0) return 0;

  // Busca templates que pertencem a esses eventos
  const stepsToCancel = await db
    .select({ key: flowSteps.templateKey })
    .from(flowSteps)
    .where(inArray(flowSteps.gatewayEvent, cancelEvents));

  if (stepsToCancel.length === 0) return 0;

  const templates = stepsToCancel.map((s) => s.key);
  return cancelPendingMessages(
    leadId,
    templates,
    `Cancelado: lead avançou pra "${newEvent}"`,
  );
}

/**
 * Eventos "pre-pagamento" — webhooks que a Ticto pode mandar com delay
 * mesmo que o cliente já tenha avançado pra estado de pagamento confirmado.
 * Se o lead JÁ avançou (cliente_ativo / em_risco / cancelado), esses eventos
 * são ignorados pra não regredir status nem disparar mensagem de cobrança
 * pra cliente que já pagou.
 */
const PRE_PAYMENT_EVENTS: GatewayEvent[] = [
  "carrinho_abandonado",
  "pix_gerado",
  "pix_expirado",
  "compra_recusada",
];

const POST_PAYMENT_STATUSES: LeadStatus[] = [
  "cliente_ativo",
  "cliente_em_risco",
  "cliente_cancelado",
  "convertido", // legado
  "reembolso_revertido", // legado
];

function shouldIgnoreEvent(
  eventType: GatewayEvent,
  currentStatus: LeadStatus,
): boolean {
  return (
    PRE_PAYMENT_EVENTS.includes(eventType) &&
    POST_PAYMENT_STATUSES.includes(currentStatus)
  );
}

/**
 * Ticto dispara múltiplos `carrinho_abandonado` pra mesma sessão de checkout
 * conforme o cliente edita o formulário (telefone, CPF...). Cada webhook chega
 * com o mesmo `checkout_url` (slug único da sessão). Sem dedup, cada um
 * agendaria uma mensagem nova → spam.
 *
 * Filtra por evento prévio do mesmo lead, mesmo `checkout_url`, dentro de 24h,
 * que tenha sido processado com sucesso E não seja ele próprio uma dedup
 * (erro IS NULL exclui eventos ignorados/deduplicados que registram motivo
 * em `erro` mesmo com processedOk=true).
 */
async function isDuplicateAbandonedCart(
  leadId: number,
  rawPayload: unknown,
): Promise<boolean> {
  const checkoutUrl = (rawPayload as { checkout_url?: unknown })?.checkout_url;
  if (typeof checkoutUrl !== "string" || !checkoutUrl) return false;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await db
    .select({ id: eventos.id })
    .from(eventos)
    .where(
      and(
        eq(eventos.leadId, leadId),
        eq(eventos.eventType, "carrinho_abandonado"),
        eq(eventos.processedOk, true),
        isNull(eventos.erro),
        gte(eventos.receivedAt, cutoff),
        sql`${eventos.payload}->>'checkout_url' = ${checkoutUrl}`,
      ),
    )
    .limit(1);
  return existing.length > 0;
}

/**
 * Processa um evento do gateway de ponta a ponta.
 */
export async function handleGatewayEvent(input: EventInput): Promise<{
  leadId: number;
  scheduledMessages: number;
  status: LeadStatus;
  ignored?: boolean;
}> {
  const lead = await findOrCreateLead(input);
  const transition = STATUS_TRANSITIONS[input.eventType];
  const now = new Date();

  // Guarda: webhook retroativo (ex: carrinho_abandonado depois do cliente pagar)
  // não regride status nem agenda mensagens de cobrança.
  if (shouldIgnoreEvent(input.eventType, lead.status)) {
    await db.insert(eventos).values({
      leadId: lead.id,
      produtoId: input.produtoId ?? lead.produtoId ?? null,
      source: input.source,
      eventType: input.eventType,
      payload: input.rawPayload as object,
      processedOk: true,
      erro: `Evento ignorado: lead já está em ${lead.status} (pós-pagamento)`,
    });
    return {
      leadId: lead.id,
      scheduledMessages: 0,
      status: lead.status,
      ignored: true,
    };
  }

  // Dedup: Ticto manda múltiplos carrinho_abandonado pra mesma sessão.
  // Pula o agendamento se já tem um do mesmo checkout_url nas últimas 24h.
  if (
    input.eventType === "carrinho_abandonado" &&
    (await isDuplicateAbandonedCart(lead.id, input.rawPayload))
  ) {
    await db.insert(eventos).values({
      leadId: lead.id,
      produtoId: input.produtoId ?? lead.produtoId ?? null,
      source: input.source,
      eventType: input.eventType,
      payload: input.rawPayload as object,
      processedOk: true,
      erro: "Duplicado: mesmo checkout_url já visto nas últimas 24h",
    });
    return {
      leadId: lead.id,
      scheduledMessages: 0,
      status: lead.status,
      ignored: true,
    };
  }

  // Atualiza o lead — preserva campos existentes quando input é null/vazio
  // (webhooks como carrinho_abandonado vem com payload simplificado, sem
  // dados ricos do customer; não pode sobrescrever email/nome bons com vazio).
  const updates: Record<string, unknown> = {
    status: transition.lead,
    subscriptionStatus: transition.subscription,
    atualizadoEm: now,
    nome: input.nome && input.nome !== "Cliente Ticto" ? input.nome : lead.nome,
    contato: input.contato || lead.contato,
    email: input.email || lead.email,
    gatewayLastOrderId: input.gatewayLastOrderId || lead.gatewayLastOrderId,
    planoNome: input.planoNome || lead.planoNome,
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

  // Cancela mensagens pendentes via mapa EVENT_CANCELS (cobre templates dinâmicos)
  // Ex: compra_aprovada → cancela todas mensagens de pix_gerado, carrinho_abandonado, assinatura_atrasada
  await applyEventCancellation(lead.id, input.eventType);

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
