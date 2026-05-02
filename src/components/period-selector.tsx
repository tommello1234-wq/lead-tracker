import { useState } from "react";
import { Calendar, ChevronDown, Check } from "lucide-react";
import { useProdutoContext } from "@/contexts/produto-context";
import { PERIODS, PERIOD_LABELS, type Period } from "@/lib/period";

const SHORT_LABELS: Record<Period, string> = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Mês",
  all: "Tudo",
};

/**
 * Period selector global — fica no top bar.
 * Estado vive no ProdutoProvider, então qualquer página que ler
 * `useProdutoContext().period` reage automaticamente.
 */
export function PeriodSelector() {
  const [open, setOpen] = useState(false);
  const { period, setPeriod } = useProdutoContext();

  function pick(p: Period) {
    setPeriod(p);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-card border border-border text-foreground text-sm font-medium hover:border-foreground/20 transition-colors"
      >
        <Calendar className="size-4 text-foreground/70 shrink-0" />
        <span className="tabular-nums">{SHORT_LABELS[period]}</span>
        <ChevronDown
          className={`size-4 text-foreground/60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 right-0 top-full mt-2 min-w-[200px] rounded-2xl border bg-popover shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => pick(p)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-colors ${
                  period === p ? "bg-secondary font-semibold" : "hover:bg-muted"
                }`}
              >
                <span className="flex-1">{PERIOD_LABELS[p]}</span>
                {period === p ? <Check className="size-4 text-foreground/70" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
