import type { TaxaAprovacao } from "@shared/types";

const METODO_LABEL: Record<string, string> = {
  cartao: "Cartão",
  pix: "Pix",
  boleto: "Boleto",
  indefinido: "Outros",
};

/**
 * Card "Taxa de Aprovação" — % aprovação por método de pagamento.
 * Aprovadas / total tentativas. Anel circular ao lado de cada linha.
 */
export function TaxaAprovacaoCard({
  data,
  isLoading,
}: {
  data: TaxaAprovacao[] | undefined;
  isLoading: boolean;
}) {
  // Garante que sempre exibe cartao/pix/boleto, mesmo sem dados (NA)
  const order = ["cartao", "pix", "boleto"];
  const map = new Map((data ?? []).map((t) => [t.metodo, t]));
  const rows = order.map((m) => map.get(m as TaxaAprovacao["metodo"]));

  return (
    <div className="card-soft p-5 h-full flex flex-col">
      <h3 className="font-semibold mb-4">Taxa de Aprovação</h3>
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
              <li key={metodo} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
