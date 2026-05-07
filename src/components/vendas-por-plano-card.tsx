import { useMemo } from "react";
import type { PlanoBreakdown } from "@shared/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Card "Vendas por Plano" — lista compacta com nome, qtd ativos
 * e barra de proporção. Mesmo visual do screenshot de referência:
 * cada linha tem nome, número, anel circular fininho e %.
 */
export function VendasPorPlanoCard({
  data,
  isLoading,
  total,
}: {
  data: PlanoBreakdown[] | undefined;
  isLoading: boolean;
  total?: number;
}) {
  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => b.ativos - a.ativos);
  }, [data]);

  const totalAtivos = total ?? sorted.reduce((acc, x) => acc + x.ativos, 0);

  return (
    <div className="card-soft p-5 h-full flex flex-col">
      <header className="flex items-baseline justify-between gap-2 mb-4">
        <h3 className="font-semibold">Vendas por Plano</h3>
        <span className="text-xs text-muted-foreground">
          {sorted.length} {sorted.length === 1 ? "plano" : "planos"}
        </span>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Sem vendas no período.</p>
      ) : (
        <ul className="space-y-2.5 flex-1">
          {sorted.map((p) => {
            const pct = totalAtivos > 0 ? (p.ativos / totalAtivos) * 100 : 0;
            return (
              <li key={p.plano} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 text-sm">
                <span className="text-foreground/85 truncate" title={p.plano}>{p.plano}</span>
                <span className="tabular-nums text-foreground/70 text-right min-w-[2.5rem]">
                  {p.ativos}
                </span>
                {/* anel circular */}
                <span className="relative size-5 shrink-0" aria-hidden>
                  <svg viewBox="0 0 32 32" className="size-5 -rotate-90">
                    <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="3" className="text-foreground/10" />
                    <circle
                      cx="16"
                      cy="16"
                      r="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeDasharray={`${(pct / 100) * 81.68} 81.68`}
                      className="text-forest"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span className="tabular-nums text-xs text-muted-foreground min-w-[3rem] text-right">
                  {pct.toFixed(1)}%
                </span>
              </li>
            );
          })}
          {totalAtivos > 0 ? (
            <li className="pt-3 mt-2 border-t border-border/40 flex items-baseline justify-between text-xs text-muted-foreground">
              <span>MRR ativos</span>
              <span className="tabular-nums">{brl(sorted.reduce((acc, x) => acc + x.receita, 0))}</span>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
