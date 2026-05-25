import { useMemo, useState } from "react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { useProdutoContext, type CustomRange } from "@/contexts/produto-context";
import { periodToRange, PERIOD_LABELS, type Period } from "@/lib/period";

const SHORT_LABELS: Record<Period, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "hoje-ontem": "Hoje + ontem",
  "7d": "7 dias",
  "14d": "14 dias",
  "30d": "30 dias",
  month: "Mês",
  max: "Máximo",
  all: "Tudo",
  custom: "Personalizado",
};

const PRESET_ORDER: Period[] = [
  "today",
  "yesterday",
  "hoje-ontem",
  "7d",
  "14d",
  "30d",
  "month",
  "max",
];

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const MONTH_NAMES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];
const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isBetween(d: Date, a: Date, b: Date): boolean {
  const t = d.getTime();
  return t >= Math.min(a.getTime(), b.getTime()) && t <= Math.max(a.getTime(), b.getTime());
}

/** Gera a matriz de dias mostrada no calendário (6 linhas x 7 colunas) começando segunda. */
function buildCalendarDays(monthStart: Date): Date[] {
  const firstDay = monthStart.getDay(); // 0=Dom .. 6=Sáb
  // Pra começar segunda: shift = (firstDay + 6) % 7
  const shift = (firstDay + 6) % 7;
  const start = new Date(monthStart);
  start.setDate(1 - shift);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function PeriodSelector() {
  const [open, setOpen] = useState(false);
  const { period, setPeriod, customDate, customRange, setCustomRange } = useProdutoContext();

  // Mês visível no calendário (esquerdo). Direito = +1 mês.
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    if (period === "custom" && customRange) return startOfMonth(customRange.since);
    return startOfMonth(addMonths(new Date(), -1));
  });

  // Estado intermediário enquanto user clica o range
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);

  const today = new Date();

  function pick(p: Period) {
    setPeriod(p);
    setRangeStart(null);
    setHover(null);
    setOpen(false);
  }

  function pickDay(d: Date) {
    if (!rangeStart) {
      setRangeStart(d);
      return;
    }
    const start = rangeStart < d ? rangeStart : d;
    const end = rangeStart < d ? d : rangeStart;
    setCustomRange({ since: start, until: end });
    setPeriod("custom");
    setRangeStart(null);
    setHover(null);
    setOpen(false);
  }

  // Label do botão
  const buttonLabel = useMemo(() => {
    if (period === "custom" && customRange) {
      if (sameDay(customRange.since, customRange.until)) {
        return dateFmt.format(customRange.since);
      }
      return `${dateFmt.format(customRange.since)} – ${dateFmt.format(customRange.until)}`;
    }
    if (period === "custom" && customDate) return dateFmt.format(customDate);
    return SHORT_LABELS[period];
  }, [period, customRange, customDate]);

  // Preview do range na grade
  const previewRange: CustomRange | null = useMemo(() => {
    if (rangeStart && hover) {
      const a = rangeStart < hover ? rangeStart : hover;
      const b = rangeStart < hover ? hover : rangeStart;
      return { since: a, until: b };
    }
    if (period === "custom" && customRange) return customRange;
    return null;
  }, [rangeStart, hover, customRange, period]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-card border border-border text-foreground text-sm font-medium hover:border-foreground/20 transition-colors"
      >
        <Calendar className="size-4 text-foreground/70 shrink-0" />
        <span className="tabular-nums">{buttonLabel}</span>
        <ChevronDown className={`size-4 text-foreground/60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 right-0 top-full mt-2 rounded-2xl border bg-popover shadow-xl flex animate-in fade-in-0 zoom-in-95 overflow-hidden">
            {/* SIDEBAR de presets */}
            <div className="w-56 border-r border-border p-1.5 max-h-[420px] overflow-y-auto">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2">
                Atalhos
              </div>
              {PRESET_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => pick(p)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    period === p ? "bg-secondary font-semibold" : "hover:bg-muted"
                  }`}
                >
                  <span className="flex-1">{PERIOD_LABELS[p]}</span>
                  {period === p ? <Check className="size-4 text-foreground/70" /> : null}
                </button>
              ))}
            </div>

            {/* CALENDÁRIO 2 meses */}
            <div className="p-3 w-[560px]">
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  className="size-7 rounded-md hover:bg-muted flex items-center justify-center"
                  onClick={() => setViewMonth((m) => addMonths(m, -1))}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <div className="flex-1 grid grid-cols-2 gap-6 px-2">
                  <MonthHeader month={viewMonth} />
                  <MonthHeader month={addMonths(viewMonth, 1)} />
                </div>
                <button
                  type="button"
                  className="size-7 rounded-md hover:bg-muted flex items-center justify-center"
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <MonthGrid
                  month={viewMonth}
                  rangeStart={rangeStart}
                  previewRange={previewRange}
                  today={today}
                  onPick={pickDay}
                  onHover={setHover}
                />
                <MonthGrid
                  month={addMonths(viewMonth, 1)}
                  rangeStart={rangeStart}
                  previewRange={previewRange}
                  today={today}
                  onPick={pickDay}
                  onHover={setHover}
                />
              </div>

              {rangeStart ? (
                <p className="text-xs text-muted-foreground mt-3 px-1">
                  Início: <span className="font-medium text-foreground">{dateFmt.format(rangeStart)}</span> · clica no dia final
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-3 px-1">
                  Clica num dia pra começar o intervalo
                </p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MonthHeader({ month }: { month: Date }) {
  return (
    <div className="text-center text-sm font-semibold">
      {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}
    </div>
  );
}

function MonthGrid({
  month,
  rangeStart,
  previewRange,
  today,
  onPick,
  onHover,
}: {
  month: Date;
  rangeStart: Date | null;
  previewRange: CustomRange | null;
  today: Date;
  onPick: (d: Date) => void;
  onHover: (d: Date | null) => void;
}) {
  const days = buildCalendarDays(month);
  return (
    <div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="text-center text-[10px] font-medium text-muted-foreground">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => onHover(null)}>
        {days.map((d, i) => {
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = sameDay(d, today);
          const isStart = rangeStart && sameDay(d, rangeStart);
          const inRange = previewRange && isBetween(d, previewRange.since, previewRange.until);
          const isRangeStart = previewRange && sameDay(d, previewRange.since);
          const isRangeEnd = previewRange && sameDay(d, previewRange.until);

          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(d)}
              onMouseEnter={() => onHover(d)}
              className={`
                relative h-8 text-xs rounded-md transition-colors
                ${inMonth ? "text-foreground" : "text-muted-foreground/40"}
                ${inRange && !isRangeStart && !isRangeEnd ? "bg-secondary" : ""}
                ${isRangeStart || isRangeEnd || isStart ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-muted"}
                ${isToday && !inRange ? "ring-1 ring-foreground/30" : ""}
              `}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
