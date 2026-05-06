import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToRange } from "@/lib/period";
import type { MrrMovementType, MrrMovementLead } from "@shared/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlSigned = (n: number) => (n >= 0 ? `+${brl(n)}` : `−${brl(Math.abs(n))}`);

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

const TYPE_LABELS: Record<MrrMovementType, string> = {
  new: "New MRR",
  expansion: "Expansion (upgrades)",
  reactivation: "Reativações",
  contraction: "Contraction (downgrades)",
  churn: "Churn (cancelamentos)",
  refund: "Reembolsos",
};

export function MrrMovementsModal({
  type,
  onClose,
}: {
  type: MrrMovementType;
  onClose: () => void;
}) {
  const { produtoId, period, customDate } = useProdutoContext();
  const produtoParam = produtoId ?? "all";
  // Memoiza o range pra estabilizar queryKey (mesmo bug do DetailsModal)
  const { since, until } = useMemo(
    () => periodToRange(period, customDate),
    [period, customDate],
  );
  const sinceParam = since ? since.toISOString() : "";
  const untilParam = until.toISOString();
  const qs = `type=${type}&produtoId=${produtoParam}&since=${sinceParam}&until=${untilParam}`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", "mrr-leads", type, produtoParam, sinceParam, untilParam],
    queryFn: () => api.get<MrrMovementLead[]>(`/api/dashboard/mrr-movements/leads?${qs}`),
  });

  // ESC fecha
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const total = data?.length ?? 0;
  const totalAmount = data?.reduce((acc, m) => acc + m.amount, 0) ?? 0;

  // Quebra por gateway
  const byGateway = (data ?? []).reduce<Record<string, { count: number; total: number }>>(
    (acc, m) => {
      const g = m.gateway ?? "(sem gateway)";
      if (!acc[g]) acc[g] = { count: 0, total: 0 };
      acc[g].count++;
      acc[g].total += m.amount;
      return acc;
    },
    {},
  );
  const gatewayEntries = Object.entries(byGateway).sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));

  // Pra expansion/contraction, mostra "de → pra". Pros outros, mostra plano.
  const showFromTo = type === "expansion" || type === "contraction";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-foreground/30 backdrop-blur-sm animate-in fade-in-0">
      <div
        className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">{TYPE_LABELS[type]}</h2>
            <p className="text-xs text-muted-foreground">
              {isLoading
                ? "Carregando..."
                : `${total} ${total === 1 ? "movimento" : "movimentos"} · ${brlSigned(totalAmount)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-9 rounded-xl hover:bg-muted/40 grid place-items-center transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Carregando...</p>
          ) : isError ? (
            <div className="py-12 px-6 text-center">
              <AlertCircle className="size-8 text-destructive mx-auto mb-3" />
              <p className="text-sm font-medium text-destructive mb-1">Erro ao carregar</p>
              <p className="text-xs text-muted-foreground">
                {error instanceof Error ? error.message : "Erro desconhecido"}
              </p>
            </div>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Sem movimentos nesse tipo no período.
            </p>
          ) : (
            <>
              {/* Quebra por gateway */}
              {gatewayEntries.length > 1 ? (
                <div className="px-5 py-3 border-b border-border bg-muted/20 flex gap-4 flex-wrap text-xs">
                  {gatewayEntries.map(([gw, info]) => (
                    <div key={gw} className="flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          gw === "ticto" ? "bg-blue-500" : gw === "asaas" ? "bg-violet-500" : gw === "stripe" ? "bg-amber-500" : "bg-foreground/30"
                        }`}
                      />
                      <span className="font-medium uppercase tracking-wider text-foreground/70">
                        {gw}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {info.count} · {brlSigned(info.total)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card/95 backdrop-blur">
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Lead
                    </th>
                    <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Gateway
                    </th>
                    <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      {showFromTo ? "De → Pra" : "Plano"}
                    </th>
                    <th className="text-right px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Valor
                    </th>
                    <th className="text-left px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Quando
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((m) => (
                    <tr
                      key={m.movementId}
                      className="border-b border-border/40 last:border-b-0 hover:bg-muted/20"
                    >
                      <td className="px-5 py-2.5 font-medium truncate max-w-[220px]">
                        <div>{m.nome}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {m.contato ?? m.email ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-xs uppercase font-semibold tracking-wider px-2 py-0.5 rounded-md ${
                            m.gateway === "ticto"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                              : m.gateway === "asaas"
                                ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                                : m.gateway === "stripe"
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {m.gateway ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[220px]">
                        {showFromTo ? (
                          <span>
                            {m.fromPlano ?? "—"}{" "}
                            <span className="text-foreground/40">→</span>{" "}
                            <span className="font-medium text-foreground">
                              {m.toPlano ?? "—"}
                            </span>
                          </span>
                        ) : (
                          (m.toPlano ?? m.fromPlano ?? "—")
                        )}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                          m.amount >= 0 ? "text-forest" : "text-destructive"
                        }`}
                      >
                        {brlSigned(m.amount)}
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground tabular-nums">
                        {formatDate(m.ocorridoEm)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
      <div className="fixed inset-0 -z-10" onClick={onClose} />
    </div>
  );
}
