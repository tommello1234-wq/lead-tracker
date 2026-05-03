import { useState } from "react";
import { Calendar, ChevronDown, Check } from "lucide-react";
import { useProdutoContext } from "@/contexts/produto-context";
import { PERIODS, PERIOD_LABELS, type Period } from "@/lib/period";

const SHORT_LABELS: Record<Period, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Mês",
  all: "Tudo",
  custom: "Personalizado",
};

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function toInputValue(d: Date): string {
  // YYYY-MM-DD em São Paulo TZ pra <input type="date">
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

function fromInputValue(v: string): Date {
  // Interpreta YYYY-MM-DD como dia local (BRT)
  return new Date(v + "T00:00:00");
}

/**
 * Period selector global — fica no top bar.
 * Estado vive no ProdutoProvider, então qualquer página que ler
 * `useProdutoContext().period` reage automaticamente.
 */
export function PeriodSelector() {
  const [open, setOpen] = useState(false);
  const { period, setPeriod, customDate, setCustomDate } = useProdutoContext();

  function pick(p: Period) {
    if (p === "custom") {
      // Mantém aberto pra user escolher data
      setPeriod(p);
      if (!customDate) {
        setCustomDate(new Date());
      }
      return;
    }
    setPeriod(p);
    setOpen(false);
  }

  function onCustomDateChange(v: string) {
    if (!v) return;
    setCustomDate(fromInputValue(v));
    setPeriod("custom");
  }

  const buttonLabel =
    period === "custom" && customDate
      ? dateFmt.format(customDate)
      : SHORT_LABELS[period];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-card border border-border text-foreground text-sm font-medium hover:border-foreground/20 transition-colors"
      >
        <Calendar className="size-4 text-foreground/70 shrink-0" />
        <span className="tabular-nums">{buttonLabel}</span>
        <ChevronDown
          className={`size-4 text-foreground/60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 right-0 top-full mt-2 min-w-[240px] rounded-2xl border bg-popover shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95">
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

            {period === "custom" ? (
              <div className="border-t border-border mt-1 pt-2 px-2 pb-2">
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  Escolha o dia:
                </label>
                <input
                  type="date"
                  value={customDate ? toInputValue(customDate) : ""}
                  onChange={(e) => onCustomDateChange(e.target.value)}
                  max={toInputValue(new Date())}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm"
                />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
