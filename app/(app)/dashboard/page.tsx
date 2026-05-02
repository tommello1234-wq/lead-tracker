import {
  Users,
  TrendingUp,
  RotateCcw,
  DollarSign,
  Inbox,
  AlertTriangle,
  ShoppingCart,
  PiggyBank,
  Banknote,
  Wallet,
} from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import {
  ConversionTrendChart,
  ConvertedByDayChart,
  DailyVolumeChart,
  PlanoBreakdownChart,
  TipoBreakdownChart,
} from "@/components/dashboard-charts";
import {
  getDailySeries,
  getDashboardMetrics,
  getFaturamento,
  getPlanoBreakdown,
  getTipoBreakdown,
} from "@/lib/queries";
import { getSelectedProdutoId, getSelectedPeriod } from "@/lib/produto-context";
import { periodToSince, PERIOD_LABELS, PERIODS, type Period } from "@/lib/period";
import { PeriodSelector } from "@/components/period-selector";
import { db } from "@/db/client";
import { produtos as produtosTable } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const pct = (n: number) =>
  `${(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const produtoId = await getSelectedProdutoId();
  const sp = await searchParams;
  // URL search param tem prioridade (mudança instantânea via PeriodSelector).
  // Cookie é fallback pra carregamento inicial / persistência cross-session.
  const period: Period =
    sp.period && (PERIODS as readonly string[]).includes(sp.period)
      ? (sp.period as Period)
      : await getSelectedPeriod();
  const since = periodToSince(period);
  const produto = produtoId
    ? await db.query.produtos.findFirst({ where: eq(produtosTable.id, produtoId) })
    : null;

  const [metrics, daily, tipos, planos, faturamento] = await Promise.all([
    getDashboardMetrics(produtoId, since),
    getDailySeries(30, produtoId),
    getTipoBreakdown(produtoId),
    getPlanoBreakdown(produtoId),
    getFaturamento(produtoId, since),
  ]);

  // Estratégia de métricas: SaaS prioriza recorrência, curso prioriza vendas avulsas, "Todos" mostra agregado
  const tipo = produto?.tipo ?? "todos";
  const isSaas = tipo === "saas";
  const isCurso = tipo === "curso" || tipo === "digital";

  const headerLabel = produto ? produto.nome : "Todos os produtos";
  const headerHint = produto
    ? `${produto.tipo === "saas" ? "Assinatura recorrente" : produto.tipo === "curso" ? "Curso / produto digital" : produto.tipo === "digital" ? "Produto digital" : "Sem classificação"}`
    : "Visão agregada de todos os produtos";

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-sidebar text-sidebar-foreground p-8 sm:p-10">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-sm text-sidebar-foreground/60 mb-1">
              {greeting()}, Washington 👋
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-3">
              {produto ? (
                <span
                  className="size-3 rounded-full inline-block"
                  style={{ backgroundColor: produto.cor ?? "#A4E440" }}
                />
              ) : null}
              {headerLabel}
            </h1>
            <p className="text-sidebar-foreground/70 mt-1 text-sm">
              {headerHint} · {PERIOD_LABELS[period]}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <PeriodSelector selected={period} />
            <div className="flex items-baseline gap-2 px-4 py-2 rounded-2xl bg-sidebar-accent">
              <span className="text-xs uppercase tracking-wider text-sidebar-foreground/60">
                Faturamento
              </span>
              <span className="text-2xl font-bold text-[oklch(0.86_0.22_130)] tabular-nums">
                {brl(faturamento.total)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* KPIs principais — varia conforme tipo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isSaas ? (
          <>
            <KpiCard
              label="MRR atual"
              value={brl(metrics.mrr)}
              hint={`${metrics.clientesAtivos} ativos · sempre snapshot`}
              icon={DollarSign}
              accent="lime"
            />
            <KpiCard
              label="Faturamento no período"
              value={brl(faturamento.total)}
              hint={`${faturamento.count} transações`}
              icon={Banknote}
              accent="forest"
            />
            <KpiCard
              label="Tx Conversão PIX"
              value={pct(metrics.taxaConversaoPix)}
              hint={`${metrics.pixPagos}/${metrics.pixGerados} pagos`}
              icon={TrendingUp}
              accent="emerald"
            />
            <KpiCard
              label="Receita perdida em PIX"
              value={brl(metrics.receitaPerdidaPix)}
              hint={`${metrics.pixExpirados} PIX expiraram`}
              icon={PiggyBank}
              accent="rose"
            />
          </>
        ) : isCurso ? (
          <>
            <KpiCard
              label="Faturamento no período"
              value={brl(faturamento.total)}
              hint={`${faturamento.count} transações`}
              icon={Banknote}
              accent="lime"
            />
            <KpiCard
              label="Vendas no período"
              value={faturamento.count.toLocaleString("pt-BR")}
              hint={`${metrics.vendasHoje} hoje`}
              icon={ShoppingCart}
              accent="forest"
            />
            <KpiCard
              label="Ticket médio"
              value={brl(faturamento.count > 0 ? faturamento.total / faturamento.count : 0)}
              hint="Por venda no período"
              icon={Wallet}
              accent="emerald"
            />
            <KpiCard
              label="Reembolsos"
              value={metrics.reembolsos.toLocaleString("pt-BR")}
              hint={`${pct(metrics.pixPagos > 0 ? metrics.reembolsos / metrics.pixPagos : 0)} de taxa`}
              icon={RotateCcw}
              accent="rose"
            />
          </>
        ) : (
          // Todos / indefinido — visão agregada
          <>
            <KpiCard
              label="Faturamento no período"
              value={brl(faturamento.total)}
              hint={`${faturamento.count} transações`}
              icon={Banknote}
              accent="lime"
            />
            <KpiCard
              label="MRR atual"
              value={brl(metrics.mrr)}
              hint={`${metrics.clientesAtivos} ativos · snapshot`}
              icon={DollarSign}
              accent="forest"
            />
            <KpiCard
              label="Total de leads"
              value={metrics.totalLeads.toLocaleString("pt-BR")}
              hint="Acumulado histórico"
              icon={Users}
              accent="emerald"
            />
            <KpiCard
              label="Em risco"
              value={metrics.emRisco.toLocaleString("pt-BR")}
              hint={`${metrics.reembolsos} reembolsos`}
              icon={AlertTriangle}
              accent="rose"
            />
          </>
        )}
      </div>

      {/* Linha 2: operação */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total de leads"
          value={metrics.totalLeads.toLocaleString("pt-BR")}
          hint="Acumulado histórico"
          icon={Users}
          accent="slate"
        />
        <KpiCard
          label="Fila de mensagens"
          value={metrics.filaSuporte.toLocaleString("pt-BR")}
          hint={`${metrics.mensagensEnviadasHoje} enviadas hoje`}
          icon={Inbox}
          accent="emerald"
        />
        <KpiCard
          label="Em risco"
          value={metrics.emRisco.toLocaleString("pt-BR")}
          hint="Sinais de churn"
          icon={AlertTriangle}
          accent="amber"
        />
        <KpiCard
          label={isSaas ? "Cancelados" : "Reembolsos"}
          value={(isSaas ? metrics.cancelados : metrics.reembolsos).toLocaleString("pt-BR")}
          hint={isSaas ? `${metrics.reembolsos} reembolsos` : "no período"}
          icon={RotateCcw}
          accent="rose"
        />
      </div>

      {/* Charts: pizza dos planos sempre + outros */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PlanoBreakdownChart data={planos} />
        <DailyVolumeChart data={daily} />
        <ConversionTrendChart data={daily} />
        <ConvertedByDayChart data={daily} />
        <TipoBreakdownChart data={tipos} />
      </div>
    </div>
  );
}
