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

/* SaaS metrics — derivado dos eventos JSONB sem migration */
export type PaymentMethod = "cartao" | "pix" | "boleto" | "indefinido";

export type MetodoBreakdown = {
  metodo: PaymentMethod;
  totalCompras: number;
  ativos: number;
  receitaTotal: number;
  mrr: number;
  arpu: number;
};

export type FunilPix = {
  gerados: number;
  pagos: number;
  expirados: number;
  recovered: number;
  taxaConversao: number;
};

export type RetencaoPorMetodo = {
  metodo: PaymentMethod;
  clientesUnicos: number;
  diasMediosAtivo: number;
  taxaRetencao30d: number;
  taxaRetencao90d: number;
};

export type SaasMetricsResponse = {
  metodos: MetodoBreakdown[];
  funilPix: FunilPix;
  retencao: RetencaoPorMetodo[];
};

export type Produto = {
  id: number;
  nome: string;
  tipo: "saas" | "curso" | "digital" | "indefinido";
  cor: string | null;
  gatewayMatch: string[];
  ativo: boolean;
};
