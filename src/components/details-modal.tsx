import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToRange } from "@/lib/period";
import type { DetailLead } from "@shared/types";

function gatewayDot(gw: string): string {
  if (gw === "ticto") return "bg-blue-500";
  if (gw === "asaas") return "bg-violet-500";
  if (gw === "stripe") return "bg-amber-500";
  return "bg-foreground/30";
}

function gatewayClass(gw: string | null): string {
  if (gw === "ticto") return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  if (gw === "asaas") return "bg-violet-500/10 text-violet-600 dark:text-violet-400";
  if (gw === "stripe") return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

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
  | "cancelando"
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
  cancelando: "Cancelando em breve (cancel agendado)",
  reembolsos: "Reembolsos",
  compras: "Compras no período",
};

export function DetailsModal({
  kind,
  onClose,
  onLeadClick,
}: {
  kind: DetailsKind;
  onClose: () => void;
  onLeadClick?: (id: number) => void;
}) {
  const { produtoId, period, customDate, gateway } = useProdutoContext();
  const produtoParam = produtoId ?? "all";
  const gatewayParam = gateway ?? "all";
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
  const qs = `kind=${kind}&produtoId=${produtoParam}&since=${sinceParam}&until=${untilParam}&gateway=${gatewayParam}`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", "details", kind, produtoParam, sinceParam, untilParam, gatewayParam],
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

  const isCompras = kind === "compras";
  // Pré-seleciona o filtro local com o gateway global (se houver)
  const [gatewayFilter, setGatewayFilter] = useState<string | null>(gateway);

  // Filtro de gateway aplicado localmente
  const filtered = useMemo(() => {
    if (!data) return [];
    if (!gatewayFilter) return data;
    return data.filter((l) => (l.gateway ?? "(sem)") === gatewayFilter);
  }, [data, gatewayFilter]);

  // total + receita acumulada (já considera reembolsos como valor negativo
  // pra "compras" — daí soma bate com card "Faturamento" do dashboard)
  const total = filtered.length;
  const receita = filtered.reduce((acc, l) => acc + (l.valorAssinatura ?? 0), 0);

  // Breakdown por gateway (todos dados, antes do filtro — pros chips)
  const byGateway = useMemo(() => {
    const m: Record<string, { count: number; total: number }> = {};
    if (data) {
      for (const l of data) {
        const g = l.gateway ?? "(sem)";
        if (!m[g]) m[g] = { count: 0, total: 0 };
        m[g].count++;
        m[g].total += l.valorAssinatura ?? 0;
      }
    }
    return m;
  }, [data]);

  // Pra modal de "compras", calcular breakdown por tipo (respeita gateway filter)
  const breakdown = useMemo(() => {
    if (!isCompras) return null;
    const acc = {
      compras: { count: 0, total: 0 },
      renovacoes: { count: 0, total: 0 },
      reembolsos: { count: 0, total: 0 },
    };
    for (const l of filtered) {
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
  }, [isCompras, filtered]);

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

          {/* Filtros de gateway (chips) */}
          {!isLoading && data && data.length > 0 && Object.keys(byGateway).length > 1 ? (
            <div className="flex gap-2 flex-wrap text-xs mt-3">
              <button
                type="button"
                onClick={() => setGatewayFilter(null)}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                  gatewayFilter === null
                    ? "bg-foreground text-background font-medium"
                    : "hover:bg-muted/40 text-muted-foreground"
                }`}
              >
                <span className="font-medium uppercase tracking-wider">Todos</span>
                <span className="tabular-nums opacity-80">{data.length}</span>
              </button>
              {Object.entries(byGateway)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([gw, info]) => {
                  const active = gatewayFilter === gw;
                  return (
                    <button
                      key={gw}
                      type="button"
                      onClick={() => setGatewayFilter(active ? null : gw)}
                      className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                        active
                          ? "bg-foreground text-background font-medium"
                          : "hover:bg-muted/40 text-foreground/70"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${gatewayDot(gw)}`} />
                      <span className="font-medium uppercase tracking-wider">{gw}</span>
                      <span className="tabular-nums opacity-80">{info.count}</span>
                    </button>
                  );
                })}
            </div>
          ) : null}
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
                    <>
                      <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                        Gateway
                      </th>
                      <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                        Tipo
                      </th>
                    </>
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
                {filtered.map((l) => {
                  const isRefund = l.eventType === "reembolso";
                  const isRenewal = l.eventType === "assinatura_renovada";
                  return (
                    <tr
                      key={l.eventoId ?? l.subscriptionId ?? l.id}
                      onClick={onLeadClick ? () => onLeadClick(l.id) : undefined}
                      className={`border-b border-border/40 last:border-b-0 hover:bg-muted/20 ${onLeadClick ? "cursor-pointer" : ""}`}
                    >
                      <td className="px-5 py-2.5 font-medium truncate max-w-[200px]">{l.nome}</td>
                      <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                        {l.contato ?? "—"}
                      </td>
                      {isCompras ? (
                        <>
                          <td className="px-3 py-2.5">
                            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-semibold ${gatewayClass(l.gateway)}`}>
                              {l.gateway ?? "—"}
                            </span>
                          </td>
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
                        </>
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
