import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

export const LEAD_TYPES = [
  "abandono_carrinho",
  "pix_nao_pago",
  "indeciso",
  "reembolso",
  "compra_aprovada",
  "outro",
] as const;

export const LEAD_STATUS = [
  "lead_novo",
  "carrinho_abandonado",
  "pix_gerado",
  "pix_expirado",
  "cliente_ativo",
  "cliente_em_risco",
  "cliente_cancelado",
  "perdido",
  "reembolso_revertido",
  // legados
  "novo",
  "contatado",
  "respondeu",
  "convertido",
] as const;

export const SUBSCRIPTION_STATUS = [
  "nenhuma",
  "aguardando_pagamento",
  "ativa",
  "atrasada",
  "cancelada",
  "reembolsada",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[number];

export const LEAD_ORIGINS = [
  "instagram",
  "whatsapp",
  "email",
  "site",
  "indicacao",
  "outro",
] as const;

export type LeadType = (typeof LEAD_TYPES)[number];
export type LeadStatus = (typeof LEAD_STATUS)[number];
export type LeadOrigin = (typeof LEAD_ORIGINS)[number];

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  contato: text("contato"),
  email: text("email"),
  tipo: text("tipo").$type<LeadType>().notNull(),
  status: text("status").$type<LeadStatus>().notNull().default("lead_novo"),
  origem: text("origem").$type<LeadOrigin>(),
  valorEstimado: real("valor_estimado"),
  observacoes: text("observacoes"),

  // Identificacao no gateway (Ticto)
  gateway: text("gateway"),
  gatewayCustomerId: text("gateway_customer_id"),
  gatewayLastOrderId: text("gateway_last_order_id"),

  // Assinatura
  subscriptionStatus: text("subscription_status")
    .$type<SubscriptionStatus>()
    .notNull()
    .default("nenhuma"),
  planoNome: text("plano_nome"),
  valorAssinatura: real("valor_assinatura"),
  pixGeradoEm: timestamp("pix_gerado_em", { mode: "date" }),
  pixExpiraEm: timestamp("pix_expira_em", { mode: "date" }),
  pagouEm: timestamp("pagou_em", { mode: "date" }),
  ultimaRenovacaoEm: timestamp("ultima_renovacao_em", { mode: "date" }),
  canceladoEm: timestamp("cancelado_em", { mode: "date" }),

  // Timestamps de interacao
  primeiroContatoEm: timestamp("primeiro_contato_em", { mode: "date" }),
  respondeuEm: timestamp("respondeu_em", { mode: "date" }),
  convertidoEm: timestamp("convertido_em", { mode: "date" }),

  criadoEm: timestamp("criado_em", { mode: "date" }).notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em", { mode: "date" }).notNull().defaultNow(),
});

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

export const MESSAGE_STATUS = [
  "pending",
  "sent",
  "failed",
  "skipped",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUS)[number];

export const MESSAGE_TEMPLATES = [
  "boas_vindas_compra",
  "pix_nao_pago",
  "carrinho_abandonado",
  "follow_up_indeciso",
  "reembolso_pre_cancelamento",
  "custom",
] as const;
export type MessageTemplate = (typeof MESSAGE_TEMPLATES)[number];

export const mensagensAgendadas = pgTable("mensagens_agendadas", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  template: text("template").$type<MessageTemplate>().notNull(),
  conteudo: text("conteudo").notNull(),
  agendadoPara: timestamp("agendado_para", { mode: "date" }).notNull(),
  status: text("status").$type<MessageStatus>().notNull().default("pending"),
  enviadoEm: timestamp("enviado_em", { mode: "date" }),
  erro: text("erro"),
  evolutionMessageId: text("evolution_message_id"),
  criadoEm: timestamp("criado_em", { mode: "date" }).notNull().defaultNow(),
});

export type MensagemAgendada = typeof mensagensAgendadas.$inferSelect;
export type NovaMensagem = typeof mensagensAgendadas.$inferInsert;

/**
 * Audit trail de eventos do gateway.
 */
export const eventos = pgTable("eventos", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leads.id, {
    onDelete: "set null",
  }),
  source: text("source").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  processedOk: boolean("processed_ok").notNull().default(true),
  erro: text("erro"),
  receivedAt: timestamp("received_at", { mode: "date" }).notNull().defaultNow(),
});

export type Evento = typeof eventos.$inferSelect;
export type NovoEvento = typeof eventos.$inferInsert;
