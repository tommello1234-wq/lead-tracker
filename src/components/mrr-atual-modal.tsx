import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import type { DetailLead } from "@shared/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

function gatewayClass(gw: string | null): string {
  if (gw === "ticto") return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  if (gw === "asaas") return "bg-violet-500/10 text-violet-600 dark:text-violet-400";
  if (gw === "stripe") return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

function gatewayDot(gw: string): string {
  if (gw === "ticto") return "bg-blue-500";
  if (gw === "asaas") return "bg-violet-500";
  if (gw === "stripe") return "bg-amber-500";
  return "bg-foreground/30";
}

// Calcula impacto MRR (anual/12, vitalício/grátis = 0)
function leadMrr(l: DetailLead): number {
  const v = l.valorAssinatura ?? 0;
  if (l.periodicidade === "anual") return v / 12;
  if (l.periodicidade === "vitalicio" || l.periodicidade === "gratis") return 0;
  return v;
}

export function MrrAtualModal({ onClose, onLeadClick }: { onClose: () => void; onLeadClick?: (id: number) => void }) {
  const { produtoId, gateway } = useProdutoContext();
  const produtoParam = produtoId ?? "all";
  const gatewayParam = gateway ?? "all";
  // Inicia o filtro local sincronizado com o filtro GLOBAL do dashboard.
  // Usuário ainda pode trocar dentro do modal — esse é o estado inicial só.
  const [gatewayFilter, setGatewayFilter] = useState<string | null>(gateway);
  const [planoFilter, setPlanoFilter] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", "details", "ativos", produtoParam, gatewayParam],
    queryFn: () =>
      api.get<DetailLead[]>(
        `/api/dashboard/details?kind=ativos&produtoId=${produtoParam}&gateway=${gatewayParam}`,
      ),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Quebras (sempre baseadas em TODOS os dados)
  const byGateway = useMemo(() => {
    const m: Record<string, { count: number; mrr: number }> = {};
    if (data) for (const l of data) {
      const g = l.gateway ?? "(sem gateway)";
      if (!m[g]) m[g] = { count: 0, mrr: 0 };
      m[g].count++;
      m[g].mrr += leadMrr(l);
    }
    return m;
  }, [data]);

  const byPlano = useMemo(() => {
    const m: Record<string, { count: number; mrr: number; gateway: string | null }> = {};
    if (data) {
      const filtered = gatewayFilter
        ? data.filter((l) => (l.gateway ?? "(sem gateway)") === gatewayFilter)
        : data;
      for (const l of filtered) {
        const p = l.planoNome ?? "(sem plano)";
        if (!m[p]) m[p] = { count: 0, mrr: 0, gateway: l.gateway };
        m[p].count++;
        m[p].mrr += leadMrr(l);
      }
    }
    return m;
  }, [data, gatewayFilter]);

  // Lista filtrada
  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((l) => {
      if (gatewayFilter && (l.gateway ?? "(sem gateway)") !== gatewayFilter) return false;
      if (planoFilter && (l.planoNome ?? "(sem plano)") !== planoFilter) return false;
      return true;
    });
  }, [data, gatewayFilter, planoFilter]);

  const totalMrr = filtered.reduce((acc, l) => acc + leadMrr(l), 0);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-foreground/30 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">MRR atual — clientes ativos</h2>
            <p className="text-xs text-muted-foreground">
              {isLoading
                ? "Carregando..."
                : `${filtered.length} ativos · ${brl(totalMrr)} MRR`}
              {gatewayFilter ? ` · gateway: ${gatewayFilter}` : ""}
              {planoFilter ? ` · plano: ${planoFilter}` : ""}
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
              <p className="text-sm font-medium text-destructive mb-1">Erro</p>
              <p className="text-xs text-muted-foreground">
                {error instanceof Error ? error.message : "Erro desconhecido"}
              </p>
            </div>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Nenhum cliente ativo.
            </p>
          ) : (
            <>
              {/* Filtros gateway */}
              <div className="px-5 py-3 border-b border-border bg-muted/20">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                  Gateway
                </p>
                <div className="flex gap-2 flex-wrap text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setGatewayFilter(null);
                      setPlanoFilter(null);
                    }}
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
                    .sort((a, b) => b[1].mrr - a[1].mrr)
                    .map(([gw, info]) => {
                      const active = gatewayFilter === gw;
                      return (
                        <button
                          key={gw}
                          type="button"
                          onClick={() => {
                            setGatewayFilter(active ? null : gw);
                            setPlanoFilter(null);
                          }}
                          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                            active
                              ? "bg-foreground text-background font-medium"
                              : "hover:bg-muted/40 text-foreground/70"
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${gatewayDot(gw)}`} />
                          <span className="font-medium uppercase tracking-wider">{gw}</span>
                          <span className="tabular-nums opacity-80">
                            {info.count} · {brl(info.mrr)}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Filtros plano (apenas dos planos no gateway selecionado) */}
              <div className="px-5 py-3 border-b border-border bg-muted/10">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                  Plano {gatewayFilter ? `(em ${gatewayFilter})` : ""}
                </p>
                <div className="flex gap-2 flex-wrap text-xs">
                  <button
                    type="button"
                    onClick={() => setPlanoFilter(null)}
                    className={`px-3 py-1.5 rounded-lg transition-colors ${
                      planoFilter === null
                        ? "bg-foreground text-background font-medium"
                        : "hover:bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    <span className="font-medium uppercase tracking-wider">Todos</span>
                  </button>
                  {Object.entries(byPlano)
                    .sort((a, b) => b[1].mrr - a[1].mrr)
                    .map(([plano, info]) => {
                      const active = planoFilter === plano;
                      return (
                        <button
                          key={plano}
                          type="button"
                          onClick={() => setPlanoFilter(active ? null : plano)}
                          className={`px-3 py-1.5 rounded-lg transition-colors ${
                            active
                              ? "bg-foreground text-background font-medium"
                              : "hover:bg-muted/40 text-foreground/70"
                          }`}
                        >
                          <span className="font-medium">{plano}</span>
                          <span className="tabular-nums opacity-80 ml-1.5">
                            {info.count} · {brl(info.mrr)}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>

              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card/95 backdrop-blur z-10">
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">Lead</th>
                    <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">Gateway</th>
                    <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">Plano</th>
                    <th className="text-right px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">MRR</th>
                    <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">Pagou em</th>
                    <th className="text-left px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">Próx. cobrança</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr
                      key={l.subscriptionId ?? l.id}
                      onClick={() => onLeadClick?.(l.id)}
                      className="border-b border-border/40 last:border-b-0 hover:bg-muted/20 cursor-pointer"
                    >
                      <td className="px-5 py-2.5">
                        <div className="font-medium truncate max-w-[220px]">{l.nome}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {l.contato ?? l.email ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs uppercase font-semibold tracking-wider px-2 py-0.5 rounded-md ${gatewayClass(l.gateway)}`}>
                          {l.gateway ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[220px]">
                        {l.planoNome ?? "—"}
                        {l.periodicidade !== "mensal" ? (
                          <span className="ml-1 text-[10px] uppercase opacity-60">
                            ({l.periodicidade})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                        {brl(leadMrr(l))}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                        {fmtDate(l.pagouEm)}
                      </td>
                      <td className="px-5 py-2.5 tabular-nums">
                        {l.cancelAt ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                            <span className="size-1.5 rounded-full bg-red-500" />
                            Cancela em {fmtDate(l.cancelAt)}
                          </span>
                        ) : l.proximoPagamentoEm ? (
                          <span className="text-foreground/85">{fmtDate(l.proximoPagamentoEm)}</span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
