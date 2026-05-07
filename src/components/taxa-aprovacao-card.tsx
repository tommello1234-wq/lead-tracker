import type { TaxaAprovacao } from "@shared/types";

const METODO_LABEL: Record<string, string> = {
  cartao: "Cartão",
  pix: "Pix",
};

/**
 * Card "Taxa de Aprovação" — % aprovação por método.
 *
 * - Cartão: aprovadas / (aprovadas + recusadas) — recusa real do banco
 * - Pix: pagos / (pagos + expirados) — conversão (cliente desistiu vs pagou)
 *
 * Boleto omitido (Gravyx não aceita boleto).
 */
export function TaxaAprovacaoCard({
  data,
  isLoading,
}: {
  data: TaxaAprovacao[] | undefined;
  isLoading: boolean;
}) {
  const order = ["cartao", "pix"];
  const map = new Map((data ?? []).map((t) => [t.metodo, t]));
  const rows = order.map((m) => map.get(m as TaxaAprovacao["metodo"]));

  return (
    <div className="card-soft p-5 h-full flex flex-col">
      <header className="flex items-baseline justify-between gap-2 mb-4">
        <h3 className="font-semibold">Taxa de Aprovação</h3>
        <span
          className="text-xs text-muted-foreground/60"
          title="Cartão: aprovação real do banco. PIX: pagos / gerados (clientes que efetivamente pagaram)."
        >
          ⓘ
        </span>
      </header>
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Carregando...</p>
      ) : (
        <ul className="space-y-3 flex-1">
          {rows.map((t, idx) => {
            const metodo = order[idx];
            const label = METODO_LABEL[metodo] ?? metodo;
            const taxa = t?.taxa ?? 0;
            const tem = t && t.total > 0;
            const pctStr = tem ? `${(taxa * 100).toFixed(1)}%` : "N/A";
            return (
              <li key={metodo} className="flex flex-col gap-1">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                  <span className="text-foreground/85">{label}</span>
                  <span className="relative size-5 shrink-0" aria-hidden>
                    <svg viewBox="0 0 32 32" className="size-5 -rotate-90">
                      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="3" className="text-foreground/10" />
                      {tem ? (
                        <circle
                          cx="16"
                          cy="16"
                          r="13"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeDasharray={`${taxa * 81.68} 81.68`}
                          className={taxa >= 0.7 ? "text-forest" : taxa >= 0.4 ? "text-amber-500" : "text-destructive"}
                          strokeLinecap="round"
                        />
                      ) : null}
                    </svg>
                  </span>
                  <span className="tabular-nums text-foreground/80 min-w-[3.5rem] text-right">
                    {pctStr}
                  </span>
                </div>
                {tem ? (
                  <span className="text-[11px] text-muted-foreground/70 pl-0.5">
                    {t.aprovadas} de {t.total}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
