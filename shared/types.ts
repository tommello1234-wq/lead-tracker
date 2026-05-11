/**
 * Tipos compartilhados entre frontend e backend.
 * Espelha o shape das responses dos endpoints REST.
 */

export type DashboardMetrics = {
  totalLeads: number;
  totalAssinantes: number; // lifetime: leads que já pagaram pelo menos 1x
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

export type VendasPorPlano = {
  plano: string;
  vendas: number;
  receita: number;
};

export type Faturamento = {
  count: number; // qtd transações positivas (compras + renovações)
  total: number; // líquido (bruto - reembolsos)
  grossTotal: number;
  refundCount: number;
  refundTotal: number;
};

export type SidebarCounts = { emRisco: number; filaMensagens: number };

/* Calendário de renovação — 31 dias com count + receita esperada */
export type RenewalDayLead = {
  id: number;
  nome: string;
  valor: number;
  plano: string | null;
  pago: boolean; // true se sub.ultima_renovacao_em (ou pagou_em) cai no mês do calendário
};
export type RenewalDay = {
  dia: number;
  count: number;
  paidCount: number; // quantos dos `count` já renovaram nesse mês
  valorEsperado: number; // soma total prevista pro dia
  valorRecebido: number; // soma já recebida pro dia
  leads: RenewalDayLead[];
};

/* MRR movements — breakdown da movimentação de receita recorrente no período */
export type MrrMovementType =
  | "new"
  | "expansion"
  | "reactivation"
  | "contraction"
  | "churn"
  | "refund";

export type MrrMovementBucket = { count: number; total: number };

export type MrrMovementsBreakdown = {
  netNewMrr: number; // soma de tudo no período
  byType: Record<MrrMovementType, MrrMovementBucket>;
};

export type MrrMovementLead = {
  movementId: number;
  leadId: number;
  nome: string;
  email: string | null;
  contato: string | null;
  gateway: string | null;
  amount: number;
  fromValue: number | null;
  toValue: number | null;
  fromPlano: string | null;
  toPlano: string | null;
  ocorridoEm: string;
};

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

export type MetaAd = {
  adId: string;
  adName: string;
  status: CampaignStatus;
  campaignId: string;
  campaignName: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
  headline: string | null;
  body: string | null;
  landingPageUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpa: number | null;
  roas: number;
  purchases: number;
  initiateCheckout: number;
  landingPageViews: number;
};

export type DetailLead = {
  id: number;
  subscriptionId?: number;
  eventoId?: number;
  eventType?: string;
  nome: string;
  contato: string | null;
  email: string | null;
  status: string;
  subscriptionStatus: string;
  planoNome: string | null;
  valorAssinatura: number | null;
  gateway: string | null;
  periodicidade: string;
  pagouEm: string | null;
  proximoPagamentoEm?: string | null;
  canceladoEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
};

export type Produto = {
  id: number;
  nome: string;
  tipo: "saas" | "curso" | "digital" | "indefinido";
  cor: string | null;
  gatewayMatch: string[];
  ativo: boolean;
};

export type PersonaPrioridade =
  | "primaria"
  | "secundaria"
  | "terciaria"
  | "descartada"
  | "explorando";

export type PersonaVolume = "baixo" | "medio" | "alto" | "muito_alto";
export type PersonaRisco = "baixo" | "medio" | "alto";

export type Persona = {
  id: number;
  produtoId: number | null;
  nome: string;
  slug: string | null;
  cor: string | null;
  descricao: string | null;
  demografia: string | null;
  dor: string | null;
  desejo: string | null;
  objecoes: string[];
  mensagemChave: string | null;
  volumeMensal: PersonaVolume | null;
  wtpEstimado: PersonaVolume | null;
  churnRisk: PersonaRisco | null;
  pctPublicoAtual: number | null;
  prioridade: PersonaPrioridade;
  lps: string[];
  canais: string[];
  notas: string | null;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
};

export type AnguloStatus =
  | "ideia"
  | "producao"
  | "rodando"
  | "vencedor"
  | "perdedor"
  | "pausado";

export type CriativoTipo = "imagem" | "video" | "carrossel";
export type CriativoStatus = "ativo" | "pausado" | "morto";

export type Criativo = {
  id: number;
  anguloId: number | null;
  tipo: CriativoTipo;
  url: string | null;
  thumbUrl: string | null;
  headlineOverlay: string | null;
  metaAdsId: string | null;
  lpUrl: string | null;
  lpScreenshot: string | null;
  status: CriativoStatus;
  ctr: number | null;
  cpa: number | null;
  impressoes: number | null;
  lpViews: number | null;
  checkouts: number | null;
  compras: number | null;
  notas: string | null;
  criadoEm: string;
  atualizadoEm: string;
};

export type Angulo = {
  id: number;
  personaId: number | null;
  produtoId: number | null;
  nome: string;
  promessa: string | null;
  hook: string | null;
  cta: string | null;
  status: AnguloStatus;
  lpUrl: string | null;
  lpScreenshot: string | null;
  ctr: number | null;
  cpa: number | null;
  roas: number | null;
  diasRodando: number | null;
  budgetMensal: number | null;
  notas: string | null;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
  /** Vem populado em GET /api/angulos */
  criativos?: Criativo[];
};
