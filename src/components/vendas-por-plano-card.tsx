import { useMemo } from "react";
import type { VendasPorPlano } from "@shared/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Card "Vendas por Plano" — compras (compra_aprovada/assinatura_renovada)
 * agrupadas por plano NO PERÍODO selecionado. Filtra automaticamente pelos
 * dias do contexto (since/until). Anel circular ao lado.
 */
export function VendasPorPlanoCard({
  data,
  isLoading,
}: {
  data: VendasPorPlano[] | undefined;
  isLoading: boolean;
}) {
  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].filter((p) => p.vendas > 0).sort((a, b) => b.vendas - a.vendas);
  }, [data]);

  const totalVendas = sorted.reduce((acc, x) => acc + x.vendas, 0);
  const totalReceita = sorted.reduce((acc, x) => acc + x.receita, 0);

  return (
    <div className="card-soft p-5 h-full flex flex-col">
      <header className="flex items-baseline justify-between gap-2 mb-4">
        <h3 className="font-semibold">Vendas por Plano</h3>
        <span className="text-xs text-muted-foreground">
          {totalVendas} {totalVendas === 1 ? "venda" : "vendas"}
        </span>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Sem vendas no período.</p>
      ) : (
        <ul className="space-y-2.5 flex-1">
          {sorted.map((p) => {
            const pct = totalVendas > 0 ? (p.vendas / totalVendas) * 100 : 0;
            return (
              <li key={p.plano} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 text-sm">
                <span className="text-foreground/85 truncate" title={p.plano}>{p.plano}</span>
                <span className="tabular-nums text-foreground/70 text-right min-w-[2.5rem]">
                  {p.vendas}
                </span>
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
          {totalReceita > 0 ? (
            <li className="pt-3 mt-2 border-t border-border/40 flex items-baseline justify-between text-xs text-muted-foreground">
              <span>Receita no período</span>
              <span className="tabular-nums">{brl(totalReceita)}</span>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
