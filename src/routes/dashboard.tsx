import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  DollarSign,
  TrendingUp,
  PiggyBank,
  Users,
  Inbox,
  AlertTriangle,
  RotateCcw,
  Calendar,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToSince, PERIOD_LABELS, PERIODS, type Period } from "@/lib/period";
import { HeroCard } from "@/components/hero-card";
import { StatCard } from "@/components/stat-card";
import {
  ConversionTrendChart,
  DailyVolumeChart,
  PlanoBreakdownChart,
  TipoBreakdownChart,
} from "@/components/dashboard-charts";
import { SaasDashboard } from "@/components/saas-dashboard";
import type {
  DashboardMetrics,
  Faturamento,
  DailyMetric,
  PlanoBreakdown,
  TipoBreakdown,
  SaasMetricsResponse,
  Produto,
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
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Mês",
  all: "Tudo",
};

function PeriodPicker() {
  const { period, setPeriod } = useProdutoContext();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[oklch(0.96_0.04_130)]/10 hover:bg-[oklch(0.96_0.04_130)]/20 text-[oklch(0.96_0.04_130)] text-sm font-medium border border-[oklch(0.96_0.04_130)]/15 transition-all"
      >
        <Calendar className="size-4" />
        <span>{SHORT_LABELS[period]}</span>
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 right-0 top-full mt-2 min-w-[160px] rounded-2xl border bg-popover text-popover-foreground shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPeriod(p);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-sm rounded-xl text-left transition-colors ${
                  period === p ? "bg-secondary font-semibold" : "hover:bg-muted"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function DashboardPage() {
  const { produtoId, period } = useProdutoContext();
  const since = periodToSince(period);
  const sinceParam = since ? since.toISOString() : "";
  const produtoParam = produtoId ?? "all";
  const baseQs = `produtoId=${produtoParam}&since=${sinceParam}`;

  const metrics = useQuery({
    queryKey: ["dashboard", "metrics", produtoParam, sinceParam],
    queryFn: () => api.get<DashboardMetrics>(`/api/dashboard/metrics?${baseQs}`),
  });
  const faturamento = useQuery({
    queryKey: ["dashboard", "faturamento", produtoParam, sinceParam],
    queryFn: () => api.get<Faturamento>(`/api/dashboard/faturamento?${baseQs}`),
  });
  const daily = useQuery({
    queryKey: ["dashboard", "daily", produtoParam],
    queryFn: () => api.get<DailyMetric[]>(`/api/dashboard/daily?produtoId=${produtoParam}&days=30`),
  });
  const breakdowns = useQuery({
    queryKey: ["dashboard", "breakdowns", produtoParam],
    queryFn: () =>
      api.get<{ planos: PlanoBreakdown[]; tipos: TipoBreakdown[] }>(
        `/api/dashboard/breakdowns?produtoId=${produtoParam}`,
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

  const saasMetrics = useQuery({
    queryKey: ["dashboard", "saas", produtoParam, sinceParam],
    queryFn: () =>
      api.get<SaasMetricsResponse>(`/api/dashboard/saas?${baseQs}`),
    enabled: isSaasView,
  });

  const m = metrics.data;

  return (
    <div className="space-y-5">
      <HeroCard
        greeting={`${greeting()}, Washington 👋`}
        title="Lead Tracker"
        hint={`Visão consolidada · ${PERIOD_LABELS[period]}`}
        topRight={<PeriodPicker />}
      />

      {/* KPI grid principal — 4 colunas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="MRR atual"
          value={m ? brl(m.mrr) : "—"}
          hint={m ? `${m.clientesAtivos} ativos` : undefined}
          icon={DollarSign}
          iconTone="lime"
        />
        <StatCard
          label="Faturamento no período"
          value={faturamento.data ? brl(faturamento.data.total) : "—"}
          hint={faturamento.data ? `${faturamento.data.count} transações` : undefined}
          icon={Banknote}
          iconTone="forest"
        />
        <StatCard
          label="Tx Conversão PIX"
          value={m ? pct(m.taxaConversaoPix) : "—"}
          hint={m ? `${m.pixPagos}/${m.pixGerados} pagos` : undefined}
          icon={TrendingUp}
          iconTone="lime"
        />
        <StatCard
          label="Receita perdida em PIX"
          value={m ? brl(m.receitaPerdidaPix) : "—"}
          hint={m ? `${m.pixExpirados} PIX expiraram` : undefined}
          icon={PiggyBank}
          iconTone="rose"
        />
      </div>

      {/* Linha 2: operação */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total de leads"
          value={m ? m.totalLeads.toLocaleString("pt-BR") : "—"}
          hint="Acumulado histórico"
          icon={Users}
          iconTone="lime"
        />
        <StatCard
          label="Fila de mensagens"
          value={m ? m.filaSuporte.toLocaleString("pt-BR") : "—"}
          hint={m ? `${m.mensagensEnviadasHoje} enviadas hoje` : undefined}
          icon={Inbox}
          iconTone="lime"
        />
        <StatCard
          label="Em risco"
          value={m ? m.emRisco.toLocaleString("pt-BR") : "—"}
          hint="Sinais de churn"
          icon={AlertTriangle}
          iconTone="amber"
        />
        <StatCard
          label="Reembolsos"
          value={m ? m.reembolsos.toLocaleString("pt-BR") : "—"}
          hint="No período"
          icon={RotateCcw}
          iconTone="rose"
        />
      </div>

      {/* SaaS metrics — só pra produtos saas ou visão Todos */}
      {isSaasView && saasMetrics.data ? (
        <SaasDashboard data={saasMetrics.data} />
      ) : null}

      {/* Charts */}
      {breakdowns.data && daily.data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PlanoBreakdownChart data={breakdowns.data.planos} />
          <DailyVolumeChart data={daily.data} />
          <ConversionTrendChart data={daily.data} />
          <TipoBreakdownChart data={breakdowns.data.tipos} />
        </div>
      ) : (
        <div className="card-soft p-6">
          <p className="text-sm text-muted-foreground">Carregando gráficos...</p>
        </div>
      )}
    </div>
  );
}
