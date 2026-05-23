import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Banknote,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Calendar,
  ChevronDown,
  Target,
  ArrowDownCircle,
  Wallet,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToRange, PERIOD_LABELS, PERIODS, type Period } from "@/lib/period";
import { HeroCard } from "@/components/hero-card";
import { StatCard } from "@/components/stat-card";
import { DetailsModal, type DetailsKind } from "@/components/details-modal";
import {
  ConversionTrendChart,
  DailyRevenueChart,
  DailyVolumeChart,
  MrrHistoryChart,
  PlanoBreakdownChart,
  TipoBreakdownChart,
  VendasPorLpChart,
  type DailyRevenue,
  type MrrHistoryPoint,
  type VendaPorLp,
} from "@/components/dashboard-charts";
import { MrrAtualModal } from "@/components/mrr-atual-modal";
import { LeadDetailsModal } from "@/components/lead-details-modal";
import { CohortTable } from "@/components/cohort-table";
import { LtvDetailsModal } from "@/components/ltv-details-modal";
import type {
  DashboardMetrics,
  Faturamento,
  DailyMetric,
  PlanoBreakdown,
  TipoBreakdown,
  Produto,
  CacMetrics,
} from "@shared/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (n: number) =>
  `${(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

const SHORT_LABELS: Record<Period, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Mês",
  all: "Tudo",
  custom: "Dia",
};

export function DashboardPage() {
  const [details, setDetails] = useState<DetailsKind | null>(null);
  const [mrrAtualOpen, setMrrAtualOpen] = useState(false);
  const [ltvOpen, setLtvOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const { produtoId, period, customDate, gateway } = useProdutoContext();
  // Memoiza pra estabilizar o queryKey: senão `until=NOW` muda a cada render
  // e dispara refetch infinito (descoberto via DevTools — 364 requests num refresh).
  const { since, until } = useMemo(
    () => periodToRange(period, customDate),
    [period, customDate],
  );
  const sinceParam = since ? since.toISOString() : "";
  const untilParam = until.toISOString();
  const produtoParam = produtoId ?? "all";
  const gatewayParam = gateway ?? "all";
  // baseQs agora carrega since + until — antes só since, então "Ontem" e
  // "Personalizado" (que precisam de upper bound) pegavam até NOW e o
  // filtro virava ineficaz.
  const baseQs = `produtoId=${produtoParam}&since=${sinceParam}&until=${untilParam}&gateway=${gatewayParam}`;

  const metrics = useQuery({
    queryKey: ["dashboard", "metrics", produtoParam, sinceParam, untilParam, gatewayParam],
    queryFn: () => api.get<DashboardMetrics>(`/api/dashboard/metrics?${baseQs}`),
  });
  const faturamento = useQuery({
    queryKey: ["dashboard", "faturamento", produtoParam, sinceParam, untilParam, gatewayParam],
    queryFn: () => api.get<Faturamento>(`/api/dashboard/faturamento?${baseQs}`),
  });
  const daily = useQuery({
    queryKey: ["dashboard", "daily", produtoParam, gatewayParam],
    queryFn: () => api.get<DailyMetric[]>(`/api/dashboard/daily?produtoId=${produtoParam}&days=30&gateway=${gatewayParam}`),
  });
  const dailyRevenue = useQuery({
    queryKey: ["dashboard", "daily-revenue", produtoParam, gatewayParam],
    queryFn: () =>
      api.get<DailyRevenue[]>(
        `/api/dashboard/daily-revenue?produtoId=${produtoParam}&days=30&gateway=${gatewayParam}`,
      ),
  });
  const mrrHistory = useQuery({
    queryKey: ["dashboard", "mrr-history", produtoParam, gatewayParam],
    queryFn: () =>
      api.get<MrrHistoryPoint[]>(
        `/api/dashboard/mrr-history?produtoId=${produtoParam}&days=30&gateway=${gatewayParam}`,
      ),
  });
  const vendasPorLp = useQuery({
    queryKey: ["dashboard", "vendas-por-lp", produtoParam, sinceParam, untilParam, gatewayParam],
    queryFn: () =>
      api.get<VendaPorLp[]>(
        `/api/dashboard/vendas-por-lp?${baseQs}`,
      ),
  });
  const cohort = useQuery({
    queryKey: ["dashboard", "cohort", produtoParam, gatewayParam],
    queryFn: () =>
      api.get<{
        rows: Array<{
          cohortMonth: string;
          signupCount: number;
          ticketMedio: number;
          monthsElapsed: number;
          retention: (number | null)[];
          ltvSoFar: number;
          ltvProjected: number;
          activeNow: number;
        }>;
        ltvMedio: number;
        ltvProjMedio: number;
        cohortsMaduras: number;
        totalAtivos: number;
      }>(`/api/dashboard/cohort?produtoId=${produtoParam}&gateway=${gatewayParam}`),
  });
  const breakdowns = useQuery({
    queryKey: ["dashboard", "breakdowns", produtoParam, gatewayParam],
    queryFn: () =>
      api.get<{ planos: PlanoBreakdown[]; tipos: TipoBreakdown[] }>(
        `/api/dashboard/breakdowns?produtoId=${produtoParam}&gateway=${gatewayParam}`,
      ),
  });

  // Pra decidir se mostra SaaS dashboard: precisa do produto.tipo
  const produtos = useQuery({
    queryKey: ["produtos"],
    queryFn: () => api.get<Produto[]>("/api/produtos"),
    staleTime: 5 * 60 * 1000,
  });
  const produtoSel = produtos.data?.find((p) => p.id === produtoId);
  const isSaasView = produtoId == null || produtoSel?.tipo === "saas";

  // CAC: só faz sentido pra "all" ou produtos saas (que têm Meta tracking)
  const cac = useQuery({
    queryKey: ["dashboard", "cac", produtoParam, sinceParam, untilParam],
    queryFn: () => api.get<CacMetrics>(`/api/dashboard/cac?${baseQs}`),
    enabled: isSaasView,
    retry: 0,
  });

  const m = metrics.data;

  return (
    <div className="space-y-5">
      <HeroCard
        greeting={`${greeting()}, Washington 👋`}
        title="Lead Tracker"
        hint={`${gateway ? `Gateway: ${gateway[0].toUpperCase() + gateway.slice(1)}` : "Visão consolidada"} · ${PERIOD_LABELS[period]}`}
      />

      {/* Snapshot consolidado: 2 linhas × 3 cards.
       *  L1: MRR | LTV | Faturamento (estado e receita do período)
       *  L2: Saídas | Lucro | CAC (custo e resultado do período)
       *  Saídas usa iconTone rose pra deixar claro que é débito — não
       *  precisa do sinal "−" no número. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="MRR atual"
          value={m ? brl(m.mrr) : "—"}
          hint={m ? `${m.clientesAtivos} subs ativas` : undefined}
          icon={DollarSign}
          iconTone="lime"
          onClick={() => setMrrAtualOpen(true)}
        />
        <StatCard
          label="MRR efetivo"
          value={m ? brl(m.mrrEfetivo) : "—"}
          hint={
            m && m.cancelandoCount > 0
              ? `${m.cancelandoCount} sub${m.cancelandoCount === 1 ? "" : "s"} cancelando · −${brl(m.mrrCancelando)}`
              : m
                ? "Nenhum cancelamento anunciado"
                : undefined
          }
          icon={DollarSign}
          iconTone={m && m.cancelandoCount > 0 ? "rose" : "lime"}
          onClick={() => m && m.cancelandoCount > 0 ? setDetails("cancelando") : undefined}
        />
        <StatCard
          label="ARPU (por sub)"
          value={m ? brl(m.arpu) : "—"}
          hint={m ? `MRR ÷ ${m.clientesAtivos} subs · média por cliente/mês` : undefined}
          icon={Users}
          iconTone="lime"
        />
        <StatCard
          label="LTV (lifetime value)"
          value={m ? brl(m.ltv) : "—"}
          hint={
            m
              ? `${m.avgLifetimeMonths.toFixed(1)} meses médios · clique pra entender`
              : undefined
          }
          icon={TrendingUp}
          iconTone="forest"
          onClick={() => setLtvOpen(true)}
        />
        <StatCard
          label="Faturamento"
          value={faturamento.data ? brl(faturamento.data.total) : "—"}
          hint={
            faturamento.data
              ? `${faturamento.data.count} venda${faturamento.data.count === 1 ? "" : "s"}${
                  faturamento.data.refundCount > 0
                    ? ` · −${brl(faturamento.data.refundTotal)} em ${faturamento.data.refundCount} reembolso${faturamento.data.refundCount === 1 ? "" : "s"}`
                    : ""
                }${m ? ` · ${m.novosLeadsNoPeriodo} leads novos` : ""}`
              : undefined
          }
          icon={Banknote}
          iconTone="forest"
          onClick={() => setDetails("compras")}
        />
        <StatCard
          label="Saídas"
          value={cac.data ? brl(cac.data.adSpend ?? 0) : "—"}
          hint={
            cac.isError
              ? "Erro Meta API"
              : cac.data
                ? "Tráfego pago (Meta Ads)"
                : "Carregando..."
          }
          icon={ArrowDownCircle}
          iconTone="rose"
        />
        <StatCard
          label="Lucro"
          value={
            faturamento.data && cac.data
              ? brl(faturamento.data.total - (cac.data.adSpend ?? 0))
              : faturamento.data
                ? brl(faturamento.data.total)
                : "—"
          }
          hint="Faturamento − Saídas"
          icon={Wallet}
          iconTone={
            faturamento.data
              ? (faturamento.data.total - (cac.data?.adSpend ?? 0)) >= 0
                ? "lime"
                : "rose"
              : "lime"
          }
        />
        {isSaasView ? (
          <StatCard
            label="CAC (real, blended)"
            value={cac.data && cac.data.cac > 0 ? brl(cac.data.cac) : "—"}
            hint={
              cac.isError
                ? "Erro ao buscar Meta"
                : gateway
                  ? "Global · não filtra por gateway"
                  : cac.data
                    ? `${brl(cac.data.adSpend)} gasto / ${cac.data.newCustomers} novos`
                    : "Carregando..."
            }
            icon={Target}
            iconTone="forest"
          />
        ) : null}
      </div>

      {/* Charts */}
      {breakdowns.data && daily.data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Evolução MRR — full width (snapshot estoque de receita recorrente) */}
          {mrrHistory.data ? (
            <div className="lg:col-span-2">
              <MrrHistoryChart data={mrrHistory.data} />
            </div>
          ) : null}
          {/* Faturamento por dia — full width (fluxo de entradas no caixa) */}
          {dailyRevenue.data ? (
            <div className="lg:col-span-2">
              <DailyRevenueChart data={dailyRevenue.data} />
            </div>
          ) : null}
          <PlanoBreakdownChart data={breakdowns.data.planos} />
          <DailyVolumeChart data={daily.data} />
          {vendasPorLp.data ? (
            <VendasPorLpChart
              data={vendasPorLp.data}
              periodLabel={PERIOD_LABELS[period].toLowerCase()}
            />
          ) : null}
          <ConversionTrendChart data={daily.data} />
          <TipoBreakdownChart data={breakdowns.data.tipos} />
          {cohort.data ? (
            <div className="lg:col-span-2">
              <CohortTable data={cohort.data} cac={cac.data?.cac ?? null} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="card-soft p-6">
          <p className="text-sm text-muted-foreground">Carregando gráficos...</p>
        </div>
      )}

      {details ? (
        <DetailsModal kind={details} onClose={() => setDetails(null)} onLeadClick={(id) => { setSelectedLeadId(id); setDetails(null); }} />
      ) : null}
      {mrrAtualOpen ? (
        <MrrAtualModal
          onClose={() => setMrrAtualOpen(false)}
          onLeadClick={(id) => setSelectedLeadId(id)}
        />
      ) : null}
      {ltvOpen ? (
        <LtvDetailsModal
          metrics={m ?? null}
          onClose={() => setLtvOpen(false)}
        />
      ) : null}
      {selectedLeadId !== null ? (
        <LeadDetailsModal
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
        />
      ) : null}
    </div>
  );
}
