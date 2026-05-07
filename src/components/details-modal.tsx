import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToRange } from "@/lib/period";
import type { DetailLead } from "@shared/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt.format(d);
}

export type DetailsKind =
  | "ativos"
  | "novos"
  | "em_risco"
  | "pix_gerados"
  | "pix_pagos"
  | "pix_expirados"
  | "cancelados"
  | "reembolsos"
  | "compras";

const TITLES: Record<DetailsKind, string> = {
  ativos: "Clientes ativos",
  novos: "Novos leads no período",
  em_risco: "Leads em risco",
  pix_gerados: "PIX gerados no período",
  pix_pagos: "PIX gerados e pagos",
  pix_expirados: "PIX expirados",
  cancelados: "Assinaturas canceladas",
  reembolsos: "Reembolsos",
  compras: "Compras no período",
};

export function DetailsModal({
  kind,
  onClose,
}: {
  kind: DetailsKind;
  onClose: () => void;
}) {
  const { produtoId, period, customDate } = useProdutoContext();
  const produtoParam = produtoId ?? "all";
  // Memoiza o range pra estabilizar queryKey — pra periodos com `until=NOW`
  // (ex: "hoje"), sem memo o until vira new Date() a cada render → ISO string
  // diferente a cada vez → React Query cancela e refaz o fetch infinitamente,
  // travando em "Carregando..." pra sempre. Mesmo bug que o dashboard fixou.
  const { since, until } = useMemo(
    () => periodToRange(period, customDate),
    [period, customDate],
  );
  const sinceParam = since ? since.toISOString() : "";
  const untilParam = until.toISOString();
  const qs = `kind=${kind}&produtoId=${produtoParam}&since=${sinceParam}&until=${untilParam}`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", "details", kind, produtoParam, sinceParam, untilParam],
    queryFn: () => api.get<DetailLead[]>(`/api/dashboard/details?${qs}`),
  });

  // ESC fecha
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // total + receita acumulada (já considera reembolsos como valor negativo
  // pra "compras" — daí soma bate com card "Faturamento" do dashboard)
  const total = data?.length ?? 0;
  const receita = data?.reduce((acc, l) => acc + (l.valorAssinatura ?? 0), 0) ?? 0;
  const isCompras = kind === "compras";

  // Pra modal de "compras", calcular breakdown por tipo
  const breakdown = useMemo(() => {
    if (!isCompras || !data) return null;
    const acc = {
      compras: { count: 0, total: 0 },
      renovacoes: { count: 0, total: 0 },
      reembolsos: { count: 0, total: 0 },
    };
    for (const l of data) {
      const v = l.valorAssinatura ?? 0;
      if (l.eventType === "reembolso") {
        acc.reembolsos.count++;
        acc.reembolsos.total += Math.abs(v);
      } else if (l.eventType === "assinatura_renovada") {
        acc.renovacoes.count++;
        acc.renovacoes.total += v;
      } else {
        acc.compras.count++;
        acc.compras.total += v;
      }
    }
    return acc;
  }, [isCompras, data]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-foreground/30 backdrop-blur-sm animate-in fade-in-0">
      <div
        className={`bg-card border border-border rounded-3xl shadow-2xl w-full ${isCompras ? "max-w-5xl" : "max-w-4xl"} max-h-[88vh] flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold">{TITLES[kind]}</h2>
            <button
              type="button"
              onClick={onClose}
              className="size-9 rounded-xl hover:bg-muted/40 grid place-items-center transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando...</p>
          ) : isCompras && breakdown ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="card-soft p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                  Compras
                </p>
                <p className="font-bold tabular-nums text-forest">
                  {brl(breakdown.compras.total)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {breakdown.compras.count} transações
                </p>
              </div>
              <div className="card-soft p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                  Renovações
                </p>
                <p className="font-bold tabular-nums text-blue-600 dark:text-blue-400">
                  {brl(breakdown.renovacoes.total)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {breakdown.renovacoes.count} transações
                </p>
              </div>
              <div className="card-soft p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                  Reembolsos
                </p>
                <p className="font-bold tabular-nums text-destructive">
                  −{brl(breakdown.reembolsos.total)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {breakdown.reembolsos.count} transações
                </p>
              </div>
              <div className="card-soft p-3 bg-lime-soft/40">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                  Líquido total
                </p>
                <p className="font-bold tabular-nums">{brl(receita)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {total} no total
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {`${total} ${total === 1 ? "lead" : "leads"}${receita > 0 ? ` · ${brl(receita)} acumulado` : ""}`}
            </p>
          )}
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Carregando...</p>
          ) : isError ? (
            <div className="py-12 px-6 text-center">
              <AlertCircle className="size-8 text-destructive mx-auto mb-3" />
              <p className="text-sm font-medium text-destructive mb-1">
                Erro ao carregar
              </p>
              <p className="text-xs text-muted-foreground">
                {error instanceof Error ? error.message : "Erro desconhecido"}
              </p>
            </div>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Sem dados pra esse filtro.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card/95 backdrop-blur">
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                    Nome
                  </th>
                  <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                    Contato
                  </th>
                  {isCompras ? (
                    <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Tipo
                    </th>
                  ) : null}
                  <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                    Plano
                  </th>
                  <th className="text-right px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                    Valor
                  </th>
                  <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                    {isCompras ? "Data" : "Pagou"}
                  </th>
                  {!isCompras ? (
                    <th className="text-left px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Cancelou
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.map((l) => {
                  const isRefund = l.eventType === "reembolso";
                  const isRenewal = l.eventType === "assinatura_renovada";
                  return (
                    <tr
                      key={l.eventoId ?? l.subscriptionId ?? l.id}
                      className="border-b border-border/40 last:border-b-0 hover:bg-muted/20"
                    >
                      <td className="px-5 py-2.5 font-medium truncate max-w-[200px]">{l.nome}</td>
                      <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                        {l.contato ?? "—"}
                      </td>
                      {isCompras ? (
                        <td className="px-3 py-2.5">
                          <span
                            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-semibold ${
                              isRefund
                                ? "bg-destructive/10 text-destructive"
                                : isRenewal
                                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                  : "bg-lime-soft text-forest"
                            }`}
                          >
                            {isRefund ? "Reembolso" : isRenewal ? "Renovação" : "Compra"}
                          </span>
                        </td>
                      ) : null}
                      <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[180px]">
                        {l.planoNome ?? "—"}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${isRefund ? "text-destructive" : ""}`}>
                        {l.valorAssinatura != null
                          ? l.valorAssinatura < 0
                            ? `−${brl(Math.abs(l.valorAssinatura))}`
                            : brl(l.valorAssinatura)
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                        {formatDate(l.pagouEm)}
                      </td>
                      {!isCompras ? (
                        <td className="px-5 py-2.5 text-muted-foreground tabular-nums">
                          {formatDate(l.canceladoEm)}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div
        className="fixed inset-0 -z-10"
        onClick={onClose}
      />
    </div>
  );
}
