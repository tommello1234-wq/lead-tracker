import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, TrendingDown, AlertCircle, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";

type ChurnData = {
  customerChurnMensal: number;
  cancelamentos: number;
  cancelamentosAgendados: number;
  revenueChurnMensal: number;
  mrrPerdido: number;
  mrrSaindo: number;
  reembolsos: number;
  reembolsoTaxa: number;
  vendasNoPeriodo: number;
  ltvViaChurn: number;
  vidaMediaMeses: number;
  ativosAtuais: number;
  ativosInicio: number;
  arpuAtual: number;
  diasAnalisados: number;
  amostraPequena: boolean;
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function ChurnDetailsModal({ onClose }: { onClose: () => void }) {
  const { produtoId, gateway } = useProdutoContext();
  const produtoParam = produtoId ?? "all";
  const gatewayParam = gateway ?? "all";

  const churn = useQuery({
    queryKey: ["dashboard", "churn-modal", produtoParam, gatewayParam],
    queryFn: () =>
      api.get<ChurnData>(
        `/api/dashboard/churn?produtoId=${produtoParam}&gateway=${gatewayParam}&days=30`,
      ),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const d = churn.data;

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
            <div className="size-10 rounded-2xl bg-rose-100 dark:bg-rose-900/30 grid place-items-center">
              <TrendingDown className="size-5 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Churn — Análise de saídas</h2>
              <p className="text-xs text-muted-foreground">
                Últimos {d?.diasAnalisados ?? 30} dias · {gateway ? `Gateway: ${gateway}` : "Todos gateways"}
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
          {!d ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Carregando...</div>
          ) : (
            <>
              {/* Aviso amostra pequena */}
              {d.amostraPequena ? (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3">
                  <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-amber-900 dark:text-amber-200">
                      Amostra muito jovem
                    </p>
                    <p className="text-amber-800/80 dark:text-amber-200/80 mt-1">
                      Só tinham <strong>{d.ativosInicio}</strong> subs ativas no início do período
                      (30 dias atrás). Calcular churn % em base pequena é enganoso — o número pode
                      explodir. Os <strong>números absolutos</strong> abaixo são confiáveis;
                      <strong> a % de churn</strong> use só como referência.
                    </p>
                    <p className="text-amber-800/80 dark:text-amber-200/80 mt-2 text-xs">
                      Sugestão: olhe a <strong>tabela de Cohort</strong> mais abaixo no dashboard
                      pra ver retenção real por mês de signup.
                    </p>
                  </div>
                </div>
              ) : null}

              {/* O que é churn — explicação */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">O que é Churn?</h3>
                <p className="text-sm text-muted-foreground">
                  É <strong>quantos clientes saíram</strong> da base num período. Cliente sai
                  quando: <strong>cancela</strong> a assinatura (decidiu não renovar) ou
                  <strong> pede reembolso</strong> (7 dias de garantia). Reembolso e cancelamento
                  são tratados <strong>separadamente</strong> porque medem coisas diferentes —
                  reembolso é "qualidade da venda" (cliente arrependido), cancelamento é
                  "qualidade do produto" (cliente usou e desistiu).
                </p>
              </section>

              {/* Métricas principais — números absolutos */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">No período (últimos {d.diasAnalisados}d)</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-border p-4">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Cancelamentos
                    </div>
                    <div className="text-2xl font-bold mt-1">{d.cancelamentos}</div>
                    <div className="text-xs text-rose-600 dark:text-rose-400 mt-1 font-medium">
                      −{brl(d.mrrPerdido)} de MRR
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border p-4">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Cancel. agendados
                    </div>
                    <div className="text-2xl font-bold mt-1">{d.cancelamentosAgendados}</div>
                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">
                      −{brl(d.mrrSaindo)} sairá nos próximos dias
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border p-4">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Reembolsos
                    </div>
                    <div className="text-2xl font-bold mt-1">{d.reembolsos}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {(d.reembolsoTaxa * 100).toFixed(1)}% das {d.vendasNoPeriodo} vendas
                    </div>
                  </div>
                </div>
              </section>

              {/* Métricas calculadas — % e LTV via churn */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Métricas derivadas</h3>
                <div className="rounded-2xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <Row
                        label="Customer churn mensal"
                        value={`${(d.customerChurnMensal * 100).toFixed(1)}%`}
                        hint={`${d.cancelamentos} cancelaram de ${d.ativosAtuais + d.cancelamentos} clientes no período`}
                        warning={d.amostraPequena}
                      />
                      <Row
                        label="Revenue churn mensal"
                        value={`${(d.revenueChurnMensal * 100).toFixed(1)}%`}
                        hint={`MRR perdido ÷ MRR total (ativos + perdido)`}
                        warning={d.amostraPequena}
                      />
                      <Row
                        label="Vida média do cliente"
                        value={d.vidaMediaMeses > 0 ? `${d.vidaMediaMeses.toFixed(1)} meses` : "—"}
                        hint="1 ÷ churn mensal"
                        warning={d.amostraPequena}
                      />
                      <Row
                        label="LTV via churn"
                        value={d.ltvViaChurn > 0 ? brl(d.ltvViaChurn) : "—"}
                        hint={`ARPU R$ ${d.arpuAtual.toFixed(0)} ÷ churn mensal`}
                        warning={d.amostraPequena}
                      />
                      <Row
                        label="Taxa de reembolso"
                        value={`${(d.reembolsoTaxa * 100).toFixed(1)}%`}
                        hint="% das vendas no período que reembolsaram"
                      />
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Como é calculado */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Como calculamos</h3>
                <div className="rounded-2xl bg-muted/20 p-4 text-xs text-muted-foreground space-y-2 font-mono">
                  <p>
                    <strong className="text-foreground">Customer churn = </strong>
                    cancelamentos no período ÷ (ativos hoje + cancelamentos)
                    <br/>
                    <span className="text-[10px]">= % da base total do período que saiu</span>
                  </p>
                  <p>
                    <strong className="text-foreground">Revenue churn = </strong>
                    MRR perdido ÷ (MRR atual + MRR perdido)
                  </p>
                  <p>
                    <strong className="text-foreground">LTV via churn = </strong>
                    ARPU ÷ churn mensal (fórmula clássica SaaS)
                  </p>
                  <p>
                    <strong className="text-foreground">Reembolso ≠ Churn:</strong> reembolso é
                    cliente que arrependeu da compra (dentro de 7d). Churn é cliente que usou e
                    decidiu sair. Mostramos separados.
                  </p>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  warning,
}: {
  label: string;
  value: string;
  hint?: string;
  warning?: boolean;
}) {
  return (
    <tr className="border-t border-border/40 first:border-t-0">
      <td className="px-4 py-3">
        <div className="font-medium flex items-center gap-2">
          {label}
          {warning ? (
            <AlertCircle className="size-3.5 text-amber-500" />
          ) : null}
        </div>
        {hint ? <div className="text-xs text-muted-foreground mt-0.5">{hint}</div> : null}
      </td>
      <td className="px-4 py-3 text-right font-bold tabular-nums">{value}</td>
    </tr>
  );
}
