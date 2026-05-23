import { useMemo } from "react";

type CohortRow = {
  cohortMonth: string;
  signupCount: number;
  ticketMedio: number;
  monthsElapsed: number;
  retention: (number | null)[];
  ltvSoFar: number;
  ltvProjected: number;
  activeNow: number;
};

type CohortSummary = {
  rows: CohortRow[];
  ltvMedio: number;
  ltvProjMedio: number;
  cohortsMaduras: number;
  totalAtivos: number;
};

type Props = {
  data: CohortSummary;
  cac?: number | null;
};

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function fmtMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${months[Number(m) - 1]}/${y.slice(2)}`;
}

// Gradiente lime → forest baseado em retenção (0..1)
function bgColor(pct: number): string {
  if (pct >= 0.9) return "bg-lime-500/40 text-foreground";
  if (pct >= 0.7) return "bg-lime-500/30 text-foreground";
  if (pct >= 0.5) return "bg-lime-500/20 text-foreground";
  if (pct >= 0.3) return "bg-lime-500/10 text-foreground";
  if (pct >= 0.15) return "bg-orange-500/15 text-foreground";
  if (pct > 0) return "bg-red-500/15 text-foreground";
  return "bg-muted/30 text-muted-foreground";
}

export function CohortTable({ data, cac }: Props) {
  const maxMonthShown = useMemo(() => {
    let max = 0;
    for (const r of data.rows) {
      let lastNonNull = -1;
      for (let i = 0; i < r.retention.length; i++) {
        if (r.retention[i] !== null) lastNonNull = i;
      }
      if (lastNonNull > max) max = lastNonNull;
    }
    return Math.min(13, Math.max(3, max));
  }, [data.rows]);

  const monthCols = Array.from({ length: maxMonthShown + 1 }, (_, i) => i);
  const sortedRows = [...data.rows].reverse(); // mais recente em cima

  const ltvCacRatio = cac && cac > 0 ? data.ltvMedio / cac : null;
  const ltvProjCacRatio = cac && cac > 0 ? data.ltvProjMedio / cac : null;
  const arpu = sortedRows.length > 0
    ? sortedRows.reduce((a, r) => a + r.ticketMedio, 0) / sortedRows.length
    : 0;
  const payback = cac && arpu > 0 ? cac / arpu : null;

  return (
    <div className="card-soft p-5 space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Análise de Cohort — Retenção e LTV real</h3>
        <p className="text-sm text-muted-foreground">
          Cada linha = clientes que entraram naquele mês. % mostra quantos ainda estavam pagando N meses depois. LTV real considera ativos atuais (não só quem cancelou).
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">LTV real (observado)</div>
          <div className="text-xl font-bold">{fmtBRL(data.ltvMedio)}</div>
          <div className="text-[11px] text-muted-foreground">
            média de {data.cohortsMaduras} cohorts ≥3 meses
          </div>
        </div>
        <div className="rounded-xl bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">LTV projetado</div>
          <div className="text-xl font-bold">{fmtBRL(data.ltvProjMedio)}</div>
          <div className="text-[11px] text-muted-foreground">
            extrapola decay até churn ~0
          </div>
        </div>
        <div className="rounded-xl bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">LTV / CAC</div>
          <div className="text-xl font-bold">
            {ltvCacRatio != null ? ltvCacRatio.toFixed(1) : "—"}
            {ltvProjCacRatio != null && ltvProjCacRatio !== ltvCacRatio ? (
              <span className="text-sm font-normal text-muted-foreground"> · proj {ltvProjCacRatio.toFixed(1)}</span>
            ) : null}
          </div>
          <div className="text-[11px] text-muted-foreground">
            saudável: ≥3 · ótimo: ≥5
          </div>
        </div>
        <div className="rounded-xl bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">Payback</div>
          <div className="text-xl font-bold">
            {payback != null ? `${payback.toFixed(1)} m` : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            CAC ÷ ticket médio
          </div>
        </div>
      </div>

      {/* Tabela cohort */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium p-1.5">Cohort</th>
              <th className="text-right font-medium p-1.5">Tam</th>
              <th className="text-right font-medium p-1.5">Ticket</th>
              {monthCols.map((m) => (
                <th key={m} className="text-center font-medium p-1.5 w-12">
                  M{m}
                </th>
              ))}
              <th className="text-right font-medium p-1.5">LTV</th>
              <th className="text-right font-medium p-1.5">LTV proj</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.cohortMonth} className="border-t border-border/40">
                <td className="p-1.5 font-medium">{fmtMonth(r.cohortMonth)}</td>
                <td className="p-1.5 text-right tabular-nums">{r.signupCount}</td>
                <td className="p-1.5 text-right tabular-nums text-muted-foreground">
                  {fmtBRL(r.ticketMedio)}
                </td>
                {monthCols.map((m) => {
                  const v = r.retention[m];
                  if (v == null) {
                    return (
                      <td key={m} className="p-1.5 text-center text-muted-foreground/40">
                        —
                      </td>
                    );
                  }
                  return (
                    <td
                      key={m}
                      className={`p-1.5 text-center tabular-nums rounded ${bgColor(v)}`}
                    >
                      {(v * 100).toFixed(0)}%
                    </td>
                  );
                })}
                <td className="p-1.5 text-right tabular-nums font-medium">
                  {fmtBRL(r.ltvSoFar)}
                </td>
                <td className="p-1.5 text-right tabular-nums text-muted-foreground">
                  {fmtBRL(r.ltvProjected)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-muted-foreground">
        M0 = mês do signup (sempre próximo de 100%, pode ter reembolsados no mesmo mês). Cores: verde = boa retenção, vermelho = ruim.
        Cohorts &lt; 3 meses não contam pro LTV médio.
      </div>
    </div>
  );
}
