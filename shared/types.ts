/**
 * Tipos compartilhados entre frontend e backend.
 * Espelha o shape das responses dos endpoints REST.
 */

export type DashboardMetrics = {
  totalLeads: number;
  novosLeadsNoPeriodo: number;
  vendasHoje: number;
  vendasMes: number;
  mrr: number;
  mrrPotencial: number;
  arpu: number;
  ltv: number;
  avgLifetimeMonths: number;
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

/* Live activity feed + funil snapshot */
export type ActivityItem = {
  id: number;
  tipo: "evento" | "mensagem_enviada" | "mensagem_cancelada";
  eventType: string;
  leadId: number | null;
  leadNome: string | null;
  leadContato: string | null;
  produtoId: number | null;
  produtoNome: string | null;
  receivedAt: string;
  meta?: {
    valor?: number | null;
    template?: string | null;
    erro?: string | null;
    paymentMethod?: string | null;
  };
};

export type FunilSnapshotColumn = {
  status: string;
  count: number;
  leads: Array<{
    id: number;
    nome: string;
    contato: string | null;
    valorAssinatura: number | null;
    atualizadoEm: string;
    horasNoEstagio: number;
    mensagensEnviadas: number;
  }>;
};

/* CAC blended: Meta spend + novos clientes Lead Tracker */
export type CacMetrics = {
  adSpend: number;
  newCustomers: number;
  cac: number;
  pixelPurchases: number;
  cpaMeta: number;
  organicCount: number;
  organicPct: number;
};

/* Meta Ads */
export type MetaInsights = {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  cpc: number;
  cpm: number;
  ctr: number;
  frequency: number;
  purchases: number;
  initiateCheckout: number;
  landingPageViews: number;
  viewContent: number;
  addToCart: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
  cpic: number;
};

export type CampaignStatus =
  | "ACTIVE"
  | "PAUSED"
  | "DELETED"
  | "ARCHIVED"
  | "PENDING_REVIEW"
  | "DISAPPROVED"
  | "PREAPPROVED"
  | "PENDING_BILLING_INFO"
  | "CAMPAIGN_PAUSED"
  | "ARCHIVED_BY_USER"
  | "IN_PROCESS"
  | "WITH_ISSUES"
  | "UNKNOWN";

export type MetaCampaign = {
  campaignId: string;
  campaignName: string;
  status: CampaignStatus;
  spend: number;
  purchases: number;
  initiateCheckout: number;
  clicks: number;
  cpa: number | null;
  cpc: number;
  ctr: number;
  purchaseValue: number;
  roas: number;
  landingPageUrl: string | null;
  sampleAdId: string | null;
};

export type Produto = {
  id: number;
  nome: string;
  tipo: "saas" | "curso" | "digital" | "indefinido";
  cor: string | null;
  gatewayMatch: string[];
  ativo: boolean;
};
