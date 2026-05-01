import {
  Users,
  TrendingUp,
  RotateCcw,
  DollarSign,
  Inbox,
  AlertTriangle,
  ShoppingCart,
  PiggyBank,
} from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import {
  ConversionTrendChart,
  ConvertedByDayChart,
  DailyVolumeChart,
  TipoBreakdownChart,
} from "@/components/dashboard-charts";
import { getDailySeries, getDashboardMetrics, getTipoBreakdown } from "@/lib/queries";

export const dynamic = "force-dynamic";

const pct = (n: number) =>
  `${(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default async function DashboardPage() {
  const [metrics, daily, tipos] = await Promise.all([
    getDashboardMetrics(),
    getDailySeries(30),
    getTipoBreakdown(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Visao geral de performance da assinatura.
        </p>
      </div>

      {/* Metricas principais — focadas em receita recorrente */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="MRR atual"
          value={brl(metrics.mrr)}
          hint={`${metrics.clientesAtivos} clientes ativos`}
          icon={DollarSign}
          accent="green"
        />
        <KpiCard
          label="Vendas hoje"
          value={metrics.vendasHoje.toLocaleString("pt-BR")}
          hint={`${metrics.vendasMes} no mes`}
          icon={ShoppingCart}
          accent="blue"
        />
        <KpiCard
          label="Tx Conversao PIX"
          value={pct(metrics.taxaConversaoPix)}
          hint={`${metrics.pixPagos}/${metrics.pixGerados} pagos`}
          icon={TrendingUp}
          accent="amber"
        />
        <KpiCard
          label="Receita perdida em PIX"
          value={brl(metrics.receitaPerdidaPix)}
          hint={`${metrics.pixExpirados} PIX expiraram`}
          icon={PiggyBank}
          accent="rose"
        />
      </div>

      {/* Linha 2: operacao e saude */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total de leads"
          value={metrics.totalLeads.toLocaleString("pt-BR")}
          hint="Acumulado historico"
          icon={Users}
          accent="slate"
        />
        <KpiCard
          label="Fila de mensagens"
          value={metrics.filaSuporte.toLocaleString("pt-BR")}
          hint={`${metrics.mensagensEnviadasHoje} enviadas hoje`}
          icon={Inbox}
          accent="blue"
        />
        <KpiCard
          label="Em risco"
          value={metrics.emRisco.toLocaleString("pt-BR")}
          hint="Clientes com sinais de churn"
          icon={AlertTriangle}
          accent="amber"
        />
        <KpiCard
          label="Cancelados"
          value={metrics.cancelados.toLocaleString("pt-BR")}
          hint={`${metrics.reembolsos} reembolsos`}
          icon={RotateCcw}
          accent="rose"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DailyVolumeChart data={daily} />
        <ConversionTrendChart data={daily} />
        <ConvertedByDayChart data={daily} />
        <TipoBreakdownChart data={tipos} />
      </div>
    </div>
  );
}
