import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
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
  data,
  isLoading,
}: {
  data: RenewalDay[] | undefined;
  isLoading: boolean;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<RenewalDay | null>(null);

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

  // Intensidade de cor baseada em valor relativo ao máximo do mês
  function intensityClass(valor: number): string {
    if (!totalMes.maxValor || valor === 0) return "bg-card border-border/40";
    const ratio = valor / totalMes.maxValor;
    if (ratio >= 0.75) return "bg-forest text-[oklch(0.86_0.18_130)] border-forest";
    if (ratio >= 0.5) return "bg-[oklch(0.55_0.18_140)] text-white border-transparent";
    if (ratio >= 0.25) return "bg-[oklch(0.7_0.16_140)] text-white border-transparent";
    return "bg-lime-soft text-forest border-transparent";
  }

  const isToday = (d: number) =>
    d === today.getDate() &&
    viewMonth === today.getMonth() &&
    viewYear === today.getFullYear();

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
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
            className="size-8 rounded-xl hover:bg-muted/40 grid place-items-center transition-colors text-foreground/70"
          >
            ‹
          </button>
          <span className="text-sm font-medium tabular-nums min-w-[140px] text-center">
            {MONTHS_PT[viewMonth]} {viewYear}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            className="size-8 rounded-xl hover:bg-muted/40 grid place-items-center transition-colors text-foreground/70"
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
                    className={`text-[11px] tabular-nums leading-none ${
                      todayCell ? "font-bold" : "font-medium opacity-80"
                    }`}
                  >
                    {c.dia}
                  </span>
                  {has && r ? (
                    <span className="text-[11px] font-bold tabular-nums leading-none text-right">
                      {r.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Legenda heatmap */}
          <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
            <span>Receita por dia:</span>
            <div className="size-3 rounded bg-muted/20 border border-border/30" />
            <div className="size-3 rounded bg-lime-soft" />
            <div className="size-3 rounded bg-[oklch(0.7_0.16_140)]" />
            <div className="size-3 rounded bg-[oklch(0.55_0.18_140)]" />
            <div className="size-3 rounded bg-forest" />
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
                  {selectedDay.count} leads · {brl(selectedDay.valorEsperado)} esperado
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
                    <th className="text-left px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
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
                  {selectedDay.leads.map((l) => (
                    <tr
                      key={l.id}
                      className="border-b border-border/40 last:border-b-0 hover:bg-muted/20"
                    >
                      <td className="px-5 py-2.5 font-medium truncate max-w-[260px]">
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
