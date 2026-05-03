import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
  Target,
} from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToRange, PERIOD_LABELS, PERIODS, type Period } from "@/lib/period";
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
  const { produtoId, period, customDate } = useProdutoContext();
  // Memoiza pra estabilizar o queryKey: senão `until=NOW` muda a cada render
  // e dispara refetch infinito (descoberto via DevTools — 364 requests num refresh).
  const { since, until } = useMemo(
    () => periodToRange(period, customDate),
    [period, customDate],
  );
  const sinceParam = since ? since.toISOString() : "";
  const untilParam = until.toISOString();
  const produtoParam = produtoId ?? "all";
  // baseQs agora carrega since + until — antes só since, então "Ontem" e
  // "Personalizado" (que precisam de upper bound) pegavam até NOW e o
  // filtro virava ineficaz.
  const baseQs = `produtoId=${produtoParam}&since=${sinceParam}&until=${untilParam}`;
  const cacQs = baseQs;

  const metrics = useQuery({
    queryKey: ["dashboard", "metrics", produtoParam, sinceParam, untilParam],
    queryFn: () => api.get<DashboardMetrics>(`/api/dashboard/metrics?${baseQs}`),
  });
  const faturamento = useQuery({
    queryKey: ["dashboard", "faturamento", produtoParam, sinceParam, untilParam],
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
    queryKey: ["dashboard", "saas", produtoParam, sinceParam, untilParam],
    queryFn: () =>
      api.get<SaasMetricsResponse>(`/api/dashboard/saas?${baseQs}`),
    enabled: isSaasView,
  });

  // CAC: só faz sentido pra "all" ou produtos saas (que têm Meta tracking)
  const cac = useQuery({
    queryKey: ["dashboard", "cac", produtoParam, sinceParam, untilParam],
    queryFn: () => api.get<CacMetrics>(`/api/dashboard/cac?${cacQs}`),
    enabled: isSaasView,
    retry: 0,
  });

  const m = metrics.data;

  return (
    <div className="space-y-5">
      <HeroCard
        greeting={`${greeting()}, Washington 👋`}
        title="Lead Tracker"
        hint={`Visão consolidada · ${PERIOD_LABELS[period]}`}
      />

      {/* KPI grid principal */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="MRR atual"
          value={m ? brl(m.mrr) : "—"}
          hint={m ? `${m.clientesAtivos} ativos · ARPU ${brl(m.arpu)}` : undefined}
          icon={DollarSign}
          iconTone="lime"
        />
        <StatCard
          label="LTV (lifetime value)"
          value={m ? brl(m.ltv) : "—"}
          hint={
            m
              ? `${m.avgLifetimeMonths.toFixed(1)} meses médios de assinatura`
              : undefined
          }
          icon={TrendingUp}
          iconTone="forest"
        />
        <StatCard
          label="Faturamento no período"
          value={faturamento.data ? brl(faturamento.data.total) : "—"}
          hint={
            faturamento.data
              ? `${faturamento.data.count} transações${m ? ` · ${m.novosLeadsNoPeriodo} leads novos` : ""}`
              : undefined
          }
          icon={Banknote}
          iconTone="forest"
        />
      </div>

      {/* PIX */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      {/* Linha de aquisição: CAC blended (gasto Meta + clientes Lead Tracker) */}
      {isSaasView ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="CAC (real, blended)"
            value={cac.data && cac.data.cac > 0 ? brl(cac.data.cac) : "—"}
            hint={
              cac.isError
                ? "Erro ao buscar Meta"
                : cac.data
                  ? `${brl(cac.data.adSpend)} gasto / ${cac.data.newCustomers} novos`
                  : "Carregando..."
            }
            icon={Target}
            iconTone="forest"
          />
          <StatCard
            label="Novos clientes"
            value={cac.data ? cac.data.newCustomers.toLocaleString("pt-BR") : "—"}
            hint={
              cac.isError
                ? "—"
                : cac.data
                  ? `${cac.data.organicCount} via orgânico/outros`
                  : "Carregando..."
            }
            icon={Users}
            iconTone="lime"
          />
          <StatCard
            label="% Orgânico"
            value={cac.data ? `${cac.data.organicPct.toFixed(1)}%` : "—"}
            hint={
              cac.isError
                ? "Meta API falhou (timeout/limite)"
                : cac.data && cac.data.adSpend === 0
                  ? "Sem gasto Meta no período"
                  : "Sem atribuição Meta"
            }
            icon={TrendingUp}
            iconTone={cac.data && cac.data.organicPct > 30 ? "forest" : "lime"}
          />
        </div>
      ) : null}

      {/* Reembolsos isolado (Total leads/Fila/Em risco moveram pra /leads) */}
      {m && m.reembolsos > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Reembolsos no período"
            value={m.reembolsos.toLocaleString("pt-BR")}
            hint="Cliente pediu dinheiro de volta"
            icon={RotateCcw}
            iconTone="rose"
          />
        </div>
      ) : null}

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
