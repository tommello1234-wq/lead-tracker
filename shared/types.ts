/**
 * Tipos compartilhados entre frontend e backend.
 * Espelha o shape das responses dos endpoints REST.
 */

export type DashboardMetrics = {
  totalLeads: number;
  vendasHoje: number;
  vendasMes: number;
  mrr: number;
  mrrPotencial: number;
  clientesAtivos: number;
  pixGerados: number;
  pixPagos: number;
  pixExpirados: number;
  taxaConversaoPix: number;
  receitaPerdidaPix: number;
  filaSuporte: number;
  mensagensEnviadasHoje: number;
  emRisco: number;
  cancelados: number;
  reembolsos: number;
  receitaTotal: number;
  ticketMedio: number;
};

export type DailyMetric = {
  date: string;
  entradas: number;
  convertidos: number;
  taxaConversao: number;
};

export type TipoBreakdown = { tipo: string; total: number };

export type PlanoBreakdown = {
  plano: string;
  total: number;
  receita: number;
  ativos: number;
};

export type Faturamento = { count: number; total: number };

export type SidebarCounts = { emRisco: number; filaMensagens: number };

export type Produto = {
  id: number;
  nome: string;
  tipo: "saas" | "curso" | "digital" | "indefinido";
  cor: string | null;
  gatewayMatch: string[];
  ativo: boolean;
};
