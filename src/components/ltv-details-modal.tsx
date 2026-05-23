import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, TrendingUp, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import type { DashboardMetrics } from "@shared/types";

type CohortData = {
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
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function fmtMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${months[Number(m) - 1]}/${y.slice(2)}`;
}

export function LtvDetailsModal({
  metrics,
  onClose,
}: {
  metrics: DashboardMetrics | null;
  onClose: () => void;
}) {
  const { produtoId } = useProdutoContext();
  const produtoParam = produtoId ?? "all";

  const cohort = useQuery({
    queryKey: ["dashboard", "cohort", produtoParam],
    queryFn: () =>
      api.get<CohortData>(`/api/dashboard/cohort?produtoId=${produtoParam}`),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const ltvBlended = metrics?.ltv ?? 0;
  const arpu = metrics?.arpu ?? 0;
  const avgMonths = metrics?.avgLifetimeMonths ?? 0;

  const ltvReal = cohort.data?.ltvMedio ?? 0;
  const ltvProj = cohort.data?.ltvProjMedio ?? 0;
  const cohortsMaduras = cohort.data?.cohortsMaduras ?? 0;

  // Maior cohort pra exemplificar
  const maiorCohort = cohort.data?.rows.reduce(
    (max, r) => (r.signupCount > (max?.signupCount ?? 0) ? r : max),
    null as CohortData["rows"][0] | null,
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-foreground/30 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-2xl bg-forest-100 dark:bg-forest-900/30 grid place-items-center">
              <TrendingUp className="size-5 text-forest-600 dark:text-forest-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">LTV — Como é calculado</h2>
              <p className="text-xs text-muted-foreground">
                Lifetime Value: receita total que um cliente médio gera enquanto está pagando
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-9 rounded-xl hover:bg-muted/40 grid place-items-center transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Conceito */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">O que é LTV?</h3>
            <p className="text-sm text-muted-foreground">
              É a <strong>receita total que UM cliente médio gera</strong>, somando todos os meses que ele fica pagando.
              Se o cliente paga R$ 67/mês e fica 8 meses, o LTV dele é R$ 536.
              O LTV do negócio é a <em>média</em> de todos os clientes.
            </p>
          </section>

          {/* Comparativo dos 2 métodos */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                  Antigo (blended)
                </span>
              </div>
              <div className="text-3xl font-bold">{brl(ltvBlended)}</div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div><strong>Fórmula:</strong> ARPU × meses médios de quem cancelou</div>
                <div className="font-mono">
                  {brl(arpu)} × {avgMonths.toFixed(1)} = {brl(ltvBlended)}
                </div>
                <div className="pt-2 text-red-600 dark:text-red-400">
                  ⚠️ Só conta quem JÁ cancelou. Ignora os {cohort.data?.totalAtivos ?? "?"} clientes ativos
                  que ainda pagam — enviesa pra baixo.
                </div>
              </div>
            </div>

            <div className="rounded-2xl border-2 border-forest-500/40 bg-forest-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-forest-500/15 text-forest-600 dark:text-forest-400">
                  Novo (cohort real)
                </span>
              </div>
              <div className="text-3xl font-bold text-forest-600 dark:text-forest-400">
                {brl(ltvReal)}
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div><strong>Fórmula:</strong> Σ (% retido no mês N × ticket)</div>
                <div className="font-mono">
                  observado: {brl(ltvReal)} · projetado: {brl(ltvProj)}
                </div>
                <div className="pt-2 text-forest-700 dark:text-forest-300">
                  ✅ Conta TODOS os clientes — ativos + cancelados. Média de {cohortsMaduras} cohorts ≥3 meses.
                </div>
              </div>
            </div>
          </section>

          {/* Exemplo prático: maior cohort */}
          {maiorCohort ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">
                Exemplo: cohort {fmtMonth(maiorCohort.cohortMonth)} ({maiorCohort.signupCount} clientes, ticket {brl(maiorCohort.ticketMedio)})
              </h3>
              <div className="rounded-2xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left p-2.5 font-medium">Mês</th>
                      <th className="text-right p-2.5 font-medium">% Retido</th>
                      <th className="text-right p-2.5 font-medium">Receita por cliente</th>
                      <th className="text-right p-2.5 font-medium">LTV acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maiorCohort.retention.map((r, i) => {
                      if (r == null) return null;
                      const receitaMes = r * maiorCohort.ticketMedio;
                      const acumulado = maiorCohort.retention
                        .slice(0, i + 1)
                        .reduce<number>((acc, v) => acc + (v ?? 0) * maiorCohort.ticketMedio, 0);
                      return (
                        <tr key={i} className="border-t border-border/40">
                          <td className="p-2.5 font-medium">M{i}</td>
                          <td className="p-2.5 text-right tabular-nums">
                            {(r * 100).toFixed(0)}%
                          </td>
                          <td className="p-2.5 text-right tabular-nums text-muted-foreground">
                            {(r * 100).toFixed(0)}% × {brl(maiorCohort.ticketMedio)} = {brl(receitaMes)}
                          </td>
                          <td className="p-2.5 text-right tabular-nums font-medium">
                            {brl(acumulado)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-border bg-muted/20">
                      <td className="p-2.5 font-semibold" colSpan={3}>
                        LTV observado (soma)
                      </td>
                      <td className="p-2.5 text-right font-bold">
                        {brl(maiorCohort.ltvSoFar)}
                      </td>
                    </tr>
                    {maiorCohort.ltvProjected > maiorCohort.ltvSoFar ? (
                      <tr className="bg-muted/10">
                        <td className="p-2.5 text-muted-foreground" colSpan={3}>
                          + extrapolação até churn ~0
                        </td>
                        <td className="p-2.5 text-right text-muted-foreground">
                          {brl(maiorCohort.ltvProjected)}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Cada linha é "% de clientes que ainda pagavam × ticket". Soma de todos os meses = LTV.
              </p>
            </section>
          ) : null}

          {/* Breakdown todas cohorts */}
          {cohort.data && cohort.data.rows.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Todas as cohorts</h3>
              <div className="rounded-2xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left p-2.5 font-medium">Cohort</th>
                      <th className="text-right p-2.5 font-medium">Clientes</th>
                      <th className="text-right p-2.5 font-medium">Ticket</th>
                      <th className="text-right p-2.5 font-medium">Idade</th>
                      <th className="text-right p-2.5 font-medium">Ativos hoje</th>
                      <th className="text-right p-2.5 font-medium">LTV observ.</th>
                      <th className="text-right p-2.5 font-medium">LTV projet.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...cohort.data.rows].reverse().map((r) => {
                      const madura = r.monthsElapsed >= 3;
                      return (
                        <tr
                          key={r.cohortMonth}
                          className={`border-t border-border/40 ${madura ? "" : "opacity-50"}`}
                        >
                          <td className="p-2.5 font-medium">{fmtMonth(r.cohortMonth)}</td>
                          <td className="p-2.5 text-right tabular-nums">{r.signupCount}</td>
                          <td className="p-2.5 text-right tabular-nums text-muted-foreground">
                            {brl(r.ticketMedio)}
                          </td>
                          <td className="p-2.5 text-right tabular-nums">
                            {r.monthsElapsed}m
                          </td>
                          <td className="p-2.5 text-right tabular-nums">
                            {r.activeNow}/{r.signupCount}
                          </td>
                          <td className="p-2.5 text-right tabular-nums font-medium">
                            {brl(r.ltvSoFar)}
                          </td>
                          <td className="p-2.5 text-right tabular-nums text-muted-foreground">
                            {brl(r.ltvProjected)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-border bg-forest-500/5">
                      <td className="p-2.5 font-semibold" colSpan={5}>
                        Média (cohorts ≥3 meses)
                      </td>
                      <td className="p-2.5 text-right font-bold text-forest-600 dark:text-forest-400">
                        {brl(ltvReal)}
                      </td>
                      <td className="p-2.5 text-right font-bold text-forest-600 dark:text-forest-400">
                        {brl(ltvProj)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Cohorts com idade &lt; 3 meses (em cinza) ainda são imaturas — não entram na média do LTV pra
                evitar enviesar pra cima (todo cliente está vivo no mês 0).
              </p>
            </section>
          ) : null}

          {cohort.isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Carregando cohorts...</div>
          ) : null}
          {cohort.isError ? (
            <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 flex gap-3">
              <AlertCircle className="size-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs text-red-600 dark:text-red-400">
                Erro ao carregar análise de cohort.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
