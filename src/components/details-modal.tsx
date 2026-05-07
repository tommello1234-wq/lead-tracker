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

  // total + receita acumulada
  const total = data?.length ?? 0;
  const receita = data?.reduce((acc, l) => acc + (l.valorAssinatura ?? 0), 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-foreground/30 backdrop-blur-sm animate-in fade-in-0">
      <div
        className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">{TITLES[kind]}</h2>
            <p className="text-xs text-muted-foreground">
              {isLoading
                ? "Carregando..."
                : `${total} ${total === 1 ? "lead" : "leads"}${receita > 0 ? ` · ${brl(receita)} acumulado` : ""}`}
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
                  <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                    Plano
                  </th>
                  <th className="text-right px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                    Valor
                  </th>
                  <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                    Pagou
                  </th>
                  <th className="text-left px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                    Cancelou
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((l) => (
                  <tr
                    key={l.subscriptionId ?? l.id}
                    className="border-b border-border/40 last:border-b-0 hover:bg-muted/20"
                  >
                    <td className="px-5 py-2.5 font-medium truncate max-w-[200px]">{l.nome}</td>
                    <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                      {l.contato ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[180px]">
                      {l.planoNome ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {l.valorAssinatura ? brl(l.valorAssinatura) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                      {formatDate(l.pagouEm)}
                    </td>
                    <td className="px-5 py-2.5 text-muted-foreground tabular-nums">
                      {formatDate(l.canceladoEm)}
                    </td>
                  </tr>
                ))}
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
