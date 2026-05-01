import type {
  LeadOrigin,
  LeadStatus,
  LeadType,
  SubscriptionStatus,
} from "@/db/schema";

export const TIPO_LABEL: Record<LeadType, string> = {
  abandono_carrinho: "Abandono de carrinho",
  pix_nao_pago: "PIX nao pago",
  indeciso: "Indeciso",
  reembolso: "Reembolso",
  compra_aprovada: "Compra aprovada",
  outro: "Outro",
};

export const STATUS_LABEL: Record<LeadStatus, string> = {
  lead_novo: "Lead novo",
  carrinho_abandonado: "Carrinho abandonado",
  pix_gerado: "PIX gerado",
  pix_expirado: "PIX expirado",
  cliente_ativo: "Cliente ativo",
  cliente_em_risco: "Cliente em risco",
  cliente_cancelado: "Cliente cancelado",
  perdido: "Perdido",
  reembolso_revertido: "Reembolso revertido",
  // legados
  novo: "Novo",
  contatado: "Contatado",
  respondeu: "Respondeu",
  convertido: "Convertido",
};

export const ORIGEM_LABEL: Record<LeadOrigin, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  email: "Email",
  site: "Site",
  indicacao: "Indicacao",
  outro: "Outro",
};

export const STATUS_COLOR: Record<LeadStatus, string> = {
  lead_novo: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  carrinho_abandonado: "bg-orange-200 text-orange-900 dark:bg-orange-800 dark:text-orange-100",
  pix_gerado: "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100",
  pix_expirado: "bg-rose-200 text-rose-900 dark:bg-rose-800 dark:text-rose-100",
  cliente_ativo: "bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100",
  cliente_em_risco: "bg-yellow-200 text-yellow-900 dark:bg-yellow-800 dark:text-yellow-100",
  cliente_cancelado: "bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100",
  perdido: "bg-rose-200 text-rose-900 dark:bg-rose-800 dark:text-rose-100",
  reembolso_revertido: "bg-violet-200 text-violet-900 dark:bg-violet-800 dark:text-violet-100",
  // legados
  novo: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  contatado: "bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-100",
  respondeu: "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100",
  convertido: "bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100",
};

export const SUBSCRIPTION_LABEL: Record<SubscriptionStatus, string> = {
  nenhuma: "—",
  aguardando_pagamento: "Aguardando pagamento",
  ativa: "Ativa",
  atrasada: "Atrasada",
  cancelada: "Cancelada",
  reembolsada: "Reembolsada",
};

/**
 * Estagios visiveis no kanban (na ordem do funil).
 * Status "legados" e "perdido" nao aparecem no board principal.
 */
export const KANBAN_STAGES: LeadStatus[] = [
  "lead_novo",
  "carrinho_abandonado",
  "pix_gerado",
  "cliente_ativo",
  "cliente_em_risco",
  "cliente_cancelado",
];
