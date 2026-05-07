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

/**
 * Periodicidade da assinatura — usada pra normalizar MRR.
 * - mensal: cobra todo mês, MRR = valor_assinatura
 * - anual: cobra 1x/ano, MRR = valor_assinatura / 12
 * - vitalicio: pagamento único, MRR = 0 (não é recorrente)
 * - gratis: trial/oferta grátis, MRR = 0
 */
export const PERIODICIDADES = ["mensal", "anual", "vitalicio", "gratis"] as const;
export type Periodicidade = (typeof PERIODICIDADES)[number];

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

export const PRODUCT_TYPES = ["saas", "curso", "digital", "indefinido"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/**
 * Produtos do user. Cada lead/evento é associado a um produto via produto_id.
 * `gatewayMatch` = lista de strings que casam com o `nome do produto` que vem
 * no payload do gateway (Ticto/Stripe). Auto-detecção no parser.
 */
export const produtos = pgTable("produtos", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull().unique(),
  tipo: text("tipo").$type<ProductType>().notNull().default("indefinido"),
  cor: text("cor"),
  gatewayMatch: jsonb("gateway_match")
    .$type<string[]>()
    .notNull()
    .default([]),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em", { mode: "date" }).notNull().defaultNow(),
});

export type Produto = typeof produtos.$inferSelect;
export type NovoProduto = typeof produtos.$inferInsert;

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  produtoId: integer("produto_id").references(() => produtos.id, {
    onDelete: "set null",
  }),
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
  // Periodicidade pra normalizar MRR (anual / mensal / vitalício / grátis).
  // Default 'mensal' porque a maioria das assinaturas é. Parser preenche
  // baseado no payload do gateway (Ticto offer.recurrence, Stripe metadata).
  periodicidade: text("periodicidade").$type<Periodicidade>().notNull().default("mensal"),
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
  "assinatura_pix_pendente",
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
  produtoId: integer("produto_id").references(() => produtos.id, {
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

/**
 * Templates editaveis pelo dashboard.
 * `key` corresponde a um valor de MESSAGE_TEMPLATES — eh o que o flow agenda.
 * `conteudoDefault` permite reverter pra versao seed.
 */
export const messageTemplates = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  key: text("key").$type<MessageTemplate>().notNull().unique(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  conteudo: text("conteudo").notNull(),
  conteudoDefault: text("conteudo_default").notNull(),
  placeholdersDisponiveis: jsonb("placeholders_disponiveis")
    .$type<string[]>()
    .notNull()
    .default([]),
  atualizadoEm: timestamp("atualizado_em", { mode: "date" }).notNull().defaultNow(),
  criadoEm: timestamp("criado_em", { mode: "date" }).notNull().defaultNow(),
});

export type MessageTemplateRow = typeof messageTemplates.$inferSelect;
export type NovoMessageTemplate = typeof messageTemplates.$inferInsert;

/**
 * Passos do fluxo por GatewayEvent.
 * `gatewayEvent` casa com o tipo definido em `lib/flows.ts` (string flexivel pra suportar futuros eventos).
 * `delaySeconds` controla quando dispara apos o evento (0 = imediato).
 * `cancelPrevious` cancela mensagens pendentes (ex: cliente pagou -> cancela cobranca PIX).
 */
export const flowSteps = pgTable("flow_steps", {
  id: serial("id").primaryKey(),
  gatewayEvent: text("gateway_event").notNull(),
  ordem: integer("ordem").notNull(),
  templateKey: text("template_key").$type<MessageTemplate>().notNull(),
  delaySeconds: integer("delay_seconds").notNull(),
  cancelPrevious: boolean("cancel_previous").notNull().default(false),
  ativo: boolean("ativo").notNull().default(true),
  atualizadoEm: timestamp("atualizado_em", { mode: "date" }).notNull().defaultNow(),
  criadoEm: timestamp("criado_em", { mode: "date" }).notNull().defaultNow(),
});

export type FlowStepRow = typeof flowSteps.$inferSelect;
export type NovoFlowStep = typeof flowSteps.$inferInsert;

/**
 * Assinaturas — uma pessoa (lead) pode ter N assinaturas ativas em
 * gateways diferentes. Antes a info de subscription ficava direto em
 * `leads` (1 sub por lead), agora cada lead vira "identidade" (pessoa)
 * e cada subscription vira uma linha aqui.
 *
 * MRR = soma das assinaturas com status='ativa' (não mais leads.ativo).
 */
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  gateway: text("gateway").notNull(), // ticto | asaas | stripe
  gatewaySubscriptionId: text("gateway_subscription_id"),
  gatewayCustomerId: text("gateway_customer_id"),
  produtoId: integer("produto_id").references(() => produtos.id, {
    onDelete: "set null",
  }),
  planoNome: text("plano_nome"),
  valor: real("valor"),
  periodicidade: text("periodicidade").$type<Periodicidade>().notNull().default("mensal"),
  status: text("status").$type<SubscriptionStatus>().notNull().default("ativa"),
  pagouEm: timestamp("pagou_em", { mode: "date" }),
  proximoPagamentoEm: timestamp("proximo_pagamento_em", { mode: "date" }),
  ultimaRenovacaoEm: timestamp("ultima_renovacao_em", { mode: "date" }),
  canceladoEm: timestamp("cancelado_em", { mode: "date" }),
  criadoEm: timestamp("criado_em", { mode: "date" }).notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em", { mode: "date" }).notNull().defaultNow(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

/**
 * Movimentações de MRR — cada mudança no faturamento recorrente vira uma linha.
 *
 * `amount` é o DELTA em R$ no MRR (positivo pra new/expansion/reactivation,
 * negativo pra contraction/churn/refund). Soma desses amounts num período =
 * Net New MRR daquele período.
 *
 * Exemplo: cliente Creator R$47 dá upgrade pra Studio R$97 → 1 movimento
 * `expansion` com amount=+50, fromValue=47, toValue=97.
 */
export const MRR_MOVEMENT_TYPES = [
  "new", // primeira aquisição (lead.pagouEm era null)
  "expansion", // upgrade (valor aumentou)
  "contraction", // downgrade (valor diminuiu)
  "churn", // cancelamento de assinatura
  "reactivation", // cliente cancelado/reembolsado voltou
  "refund", // reembolso processado (retira retroativamente)
] as const;
export type MrrMovementType = (typeof MRR_MOVEMENT_TYPES)[number];

export const mrrMovements = pgTable("mrr_movements", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  produtoId: integer("produto_id").references(() => produtos.id, {
    onDelete: "set null",
  }),
  type: text("type").$type<MrrMovementType>().notNull(),
  // Delta em R$ no MRR (sinal indica direção)
  amount: real("amount").notNull(),
  // Snapshot antes/depois pra auditoria
  fromValue: real("from_value"), // null pra "new"
  toValue: real("to_value"), // null pra "churn"/"refund"
  fromPlano: text("from_plano"),
  toPlano: text("to_plano"),
  // Referência ao evento que disparou (audit trail completo)
  eventoId: integer("evento_id").references(() => eventos.id, {
    onDelete: "set null",
  }),
  // Data efetiva da movimentação (= momento do evento, NÃO do registro)
  ocorridoEm: timestamp("ocorrido_em", { mode: "date" }).notNull().defaultNow(),
  criadoEm: timestamp("criado_em", { mode: "date" }).notNull().defaultNow(),
});

export type MrrMovement = typeof mrrMovements.$inferSelect;
export type NovoMrrMovement = typeof mrrMovements.$inferInsert;
