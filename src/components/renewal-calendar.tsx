import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar as CalendarIcon, X, Check } from "lucide-react";
import { api } from "@/lib/api";
import type { RenewalDay } from "@shared/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * Gera células do calendário pra um (year, month) específico — incluindo
 * placeholders pros dias do mês anterior na primeira semana, pra alinhar
 * com weekday corretamente.
 */
function buildMonthGrid(year: number, month: number): Array<{ dia: number | null; weekday: number }> {
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay(); // 0 = Dom
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ dia: number | null; weekday: number }> = [];
  // Placeholders antes do dia 1
  for (let i = 0; i < firstWeekday; i++) cells.push({ dia: null, weekday: i });
  // Dias do mês
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dia: d, weekday: (firstWeekday + d - 1) % 7 });
  }
  return cells;
}

export function RenewalCalendar({
  produtoParam,
  onLeadClick,
}: {
  produtoParam: string | number;
  onLeadClick?: (id: number) => void;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<RenewalDay | null>(null);

  // Sempre passa referenceDate = último dia do mês visualizado EM UTC.
  // Bug histórico: `new Date(year, month+1, 0, 23, 59, 59)` cria a data no
  // timezone LOCAL. .toISOString() converte pra UTC e em fusos negativos
  // (UTC-3 do Brasil) o "31/5 23:59 BRT" vira "1/6 02:59 UTC" — o backend
  // ao chamar `.getUTCMonth()` retornava Junho em vez de Maio, e o paidCount
  // do calendário ficava 0/X pros dias do mês visualizado. Fix: usar Date.UTC.
  const referenceDate = new Date(
    Date.UTC(viewYear, viewMonth + 1, 0, 23, 59, 59),
  ).toISOString();

  const { data, isLoading } = useQuery({
    queryKey: ["leads", "renewal-calendar", produtoParam, referenceDate],
    queryFn: () => {
      const qs = new URLSearchParams({
        produtoId: String(produtoParam),
        referenceDate,
      });
      return api.get<RenewalDay[]>(`/api/leads/renewal-calendar?${qs}`);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Mapa dia → RenewalDay pra acesso rápido
  const byDay = useMemo(() => {
    const m = new Map<number, RenewalDay>();
    if (data) for (const d of data) m.set(d.dia, d);
    return m;
  }, [data]);

  const cells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const totalMes = useMemo(() => {
    if (!data) return { count: 0, valor: 0, maxValor: 0 };
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    let count = 0;
    let valor = 0;
    let maxValor = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const r = byDay.get(d);
      if (r) {
        count += r.count;
        valor += r.valorEsperado;
        if (r.valorEsperado > maxValor) maxValor = r.valorEsperado;
      }
    }
    return { count, valor, maxValor };
  }, [byDay, viewYear, viewMonth, data]);

  // Intensidade de cor (tons pastel) baseada em valor relativo ao máximo do mês.
  // Texto sempre em forest pra contraste sutil sem agredir.
  function intensityClass(valor: number): string {
    if (!totalMes.maxValor || valor === 0) return "bg-card border-border/40 text-foreground/60";
    const ratio = valor / totalMes.maxValor;
    if (ratio >= 0.75) return "bg-[oklch(0.87_0.12_140)] text-forest border-transparent";
    if (ratio >= 0.5) return "bg-[oklch(0.92_0.09_140)] text-forest border-transparent";
    if (ratio >= 0.25) return "bg-[oklch(0.96_0.06_140)] text-forest border-transparent";
    return "bg-lime-soft/35 text-forest border-transparent";
  }

  const isToday = (d: number) =>
    d === today.getDate() &&
    viewMonth === today.getMonth() &&
    viewYear === today.getFullYear();

  // Range: até 24 meses pra trás e 12 pra frente. Pra meses passados,
  // o backend filtra leads que JÁ existiam até aquela data (passa
  // referenceDate = último dia do mês). Pra atual/futuro, snapshot atual.
  const minDate = new Date(today.getFullYear(), today.getMonth() - 24, 1);
  const maxDate = new Date(today.getFullYear(), today.getMonth() + 12, 1);
  const viewDate = new Date(viewYear, viewMonth, 1);
  const canPrev = viewDate > minDate;
  const canNext = viewDate < maxDate;
  const prevMonth = () => {
    if (!canPrev) return;
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (!canNext) return;
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else setViewMonth(viewMonth + 1);
  };

  return (
    <div className="card-soft p-5">
      <header className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-2xl bg-lime-soft text-forest grid place-items-center">
            <CalendarIcon className="size-4" />
          </div>
          <div>
            <h3 className="font-semibold">Calendário de renovação</h3>
            <p className="text-xs text-muted-foreground">
              Quando seus assinantes ativos vão pagar de novo · só mensais
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            disabled={!canPrev}
            className="size-8 rounded-xl hover:bg-muted/40 grid place-items-center transition-colors text-foreground/70 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            ‹
          </button>
          <span className="text-sm font-medium tabular-nums min-w-[140px] text-center">
            {MONTHS_PT[viewMonth]} {viewYear}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            disabled={!canNext}
            className="size-8 rounded-xl hover:bg-muted/40 grid place-items-center transition-colors text-foreground/70 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            ›
          </button>
        </div>
      </header>

      {/* Resumo do mês */}
      <div className="flex gap-4 text-sm mb-4 pb-4 border-b border-border/50">
        <div>
          <span className="text-muted-foreground">Renovações no mês:</span>{" "}
          <span className="font-semibold tabular-nums">{totalMes.count}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Receita esperada:</span>{" "}
          <span className="font-semibold tabular-nums text-forest">
            {brl(totalMes.valor)}
          </span>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          Carregando calendário...
        </p>
      ) : (
        <>
          {/* Header weekdays */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="text-xs text-muted-foreground text-center py-1 font-medium"
              >
                {w}
              </div>
            ))}
          </div>

          {/* Grid de dias — heatmap compacto */}
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((c, i) => {
              if (c.dia === null) {
                return <div key={`empty-${i}`} className="h-12" />;
              }
              const r = byDay.get(c.dia);
              const has = r && r.count > 0;
              const todayCell = isToday(c.dia);
              const colors = has ? intensityClass(r!.valorEsperado) : "bg-muted/20 border-border/30 text-muted-foreground/60";
              return (
                <button
                  key={c.dia}
                  type="button"
                  onClick={() => has && setSelectedDay(r)}
                  disabled={!has}
                  title={has ? `${r!.count} renovaç${r!.count === 1 ? "ão" : "ões"} · ${brl(r!.valorEsperado)}` : undefined}
                  className={[
                    "h-12 rounded-lg border px-2 py-1 text-left flex flex-col justify-between transition-all",
                    colors,
                    todayCell ? "ring-2 ring-forest ring-offset-1 ring-offset-card" : "",
                    has ? "hover:scale-[1.05] cursor-pointer" : "",
                  ].join(" ")}
                >
                  <span
                    className={`text-[10px] tabular-nums leading-none uppercase tracking-wide opacity-60 ${
                      todayCell ? "font-bold opacity-100" : "font-medium"
                    }`}
                  >
                    {c.dia}
                  </span>
                  {has && r ? (
                    <div className="flex items-baseline gap-1 justify-end">
                      <span className="text-[14px] font-bold tabular-nums leading-none">
                        {r.paidCount}/{r.count}
                      </span>
                      <span className="text-[8px] uppercase tracking-wider opacity-60 leading-none">
                        {r.count === 1 ? "renov" : "renovs"}
                      </span>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Legenda heatmap */}
          <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
            <span>Receita por dia:</span>
            <div className="size-3 rounded bg-card border border-border/40" />
            <div className="size-3 rounded bg-lime-soft/35" />
            <div className="size-3 rounded bg-[oklch(0.96_0.06_140)]" />
            <div className="size-3 rounded bg-[oklch(0.92_0.09_140)]" />
            <div className="size-3 rounded bg-[oklch(0.87_0.12_140)]" />
            <span>menos → mais</span>
          </div>
        </>
      )}

      {/* Modal de detalhes do dia */}
      {selectedDay ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-foreground/30 backdrop-blur-sm animate-in fade-in-0"
          onClick={() => setSelectedDay(null)}
        >
          <div
            className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold">
                  Renovações — dia {selectedDay.dia}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {selectedDay.paidCount}/{selectedDay.count} pagos ·{" "}
                  {brl(selectedDay.valorRecebido)} recebido / {brl(selectedDay.valorEsperado)} previsto
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="size-9 rounded-xl hover:bg-muted/40 grid place-items-center"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card/95 backdrop-blur">
                  <tr className="border-b border-border">
                    <th className="text-center px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider w-12">
                      Pago
                    </th>
                    <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Lead
                    </th>
                    <th className="text-left px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Plano
                    </th>
                    <th className="text-right px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Valor
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...selectedDay.leads]
                    .sort((a, b) => Number(b.pago) - Number(a.pago))
                    .map((l) => (
                    <tr
                      key={l.id}
                      onClick={onLeadClick ? () => { onLeadClick(l.id); setSelectedDay(null); } : undefined}
                      className={`border-b border-border/40 last:border-b-0 hover:bg-muted/20 ${onLeadClick ? "cursor-pointer" : ""} ${l.pago ? "" : "opacity-70"}`}
                    >
                      <td className="px-3 py-2.5 text-center">
                        {l.pago ? (
                          <span
                            className="inline-flex items-center justify-center size-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            title="Pago este mês"
                          >
                            <Check className="size-3.5 stroke-[3]" />
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center justify-center size-5 rounded-full border border-border bg-muted/30"
                            title="Aguardando pagamento"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-medium truncate max-w-[260px]">
                        {l.nome}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[200px]">
                        {l.plano ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-semibold">
                        {brl(l.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
