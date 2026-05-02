import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToSince, PERIOD_LABELS } from "@/lib/period";

type DashboardMetrics = {
  totalLeads: number;
  vendasHoje: number;
  vendasMes: number;
  mrr: number;
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

type Faturamento = { count: number; total: number };

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function DashboardPage() {
  const { produtoId, period } = useProdutoContext();
  const since = periodToSince(period);
  const sinceParam = since ? since.toISOString() : "";
  const produtoParam = produtoId ?? "all";

  const metrics = useQuery({
    queryKey: ["dashboard", "metrics", produtoParam, sinceParam],
    queryFn: () =>
      api.get<DashboardMetrics>(
        `/api/dashboard/metrics?produtoId=${produtoParam}&since=${sinceParam}`,
      ),
  });

  const faturamento = useQuery({
    queryKey: ["dashboard", "faturamento", produtoParam, sinceParam],
    queryFn: () =>
      api.get<Faturamento>(
        `/api/dashboard/faturamento?produtoId=${produtoParam}&since=${sinceParam}`,
      ),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{PERIOD_LABELS[period]}</p>
        </div>
        {faturamento.data ? (
          <div className="px-4 py-2 rounded-2xl bg-card border border-border">
            <span className="text-xs uppercase tracking-wider text-muted-foreground mr-2">
              Faturamento
            </span>
            <span className="text-2xl font-bold tabular-nums">
              {brl(faturamento.data.total)}
            </span>
          </div>
        ) : null}
      </header>

      {metrics.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando métricas...</p>
      ) : metrics.error ? (
        <p className="text-sm text-destructive">
          Erro: {metrics.error instanceof Error ? metrics.error.message : "?"}
        </p>
      ) : metrics.data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiBox label="MRR atual" value={brl(metrics.data.mrr)} hint={`${metrics.data.clientesAtivos} ativos`} />
          <KpiBox label="Total de leads" value={String(metrics.data.totalLeads)} />
          <KpiBox label="Em risco" value={String(metrics.data.emRisco)} />
          <KpiBox label="Reembolsos" value={String(metrics.data.reembolsos)} />
        </div>
      ) : null}

      <div className="rounded-3xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          UI completa (gráficos, KPIs adaptativos por tipo de produto, period selector) vai ser portada na próxima iteração.
        </p>
      </div>
    </div>
  );
}

function KpiBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-3xl bg-card border border-border p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold tabular-nums mt-2">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  );
}
