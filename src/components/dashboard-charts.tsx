import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyMetric, PlanoBreakdown, TipoBreakdown } from "@shared/types";
import { TIPO_LABEL } from "@shared/labels";

/**
 * Paleta de marca — alinhada com KpiCard (lime/forest/emerald/rose).
 * Lime é a cor principal (sidebar/destaque), forest/emerald complementam.
 */
const PALETTE = {
  lime: "oklch(0.86 0.22 130)",
  forest: "oklch(0.55 0.18 142)",
  emerald: "oklch(0.70 0.16 162)",
  rose: "oklch(0.75 0.15 20)",
  amber: "oklch(0.82 0.16 80)",
  slate: "oklch(0.55 0.02 250)",
  ink: "oklch(0.22 0.01 240)",
};

// Pizza por plano: gradação lime → forest pra dar leitura visual hierárquica
const LIME_RAMP = [
  "oklch(0.86 0.22 130)",
  "oklch(0.78 0.20 132)",
  "oklch(0.68 0.18 138)",
  "oklch(0.58 0.16 142)",
  "oklch(0.48 0.14 145)",
  "oklch(0.38 0.10 148)",
];

// Pizza por tipo: paleta multi-tom (cada tipo merece cor própria)
const TIPO_RAMP = [
  PALETTE.lime,
  PALETTE.forest,
  PALETTE.emerald,
  PALETTE.amber,
  PALETTE.rose,
  PALETTE.slate,
];

const brl = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

function formatDateLabel(d: string) {
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
}

/* ---------- Tooltip custom (glassmorphism dark) ---------- */
function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: Record<string, unknown> }>;
  label?: string | number;
  formatter?: (value: unknown, name: unknown, entry: { payload?: Record<string, unknown> }) => [string, string];
  labelFormatter?: (l: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/50 bg-popover/95 backdrop-blur-md shadow-lg px-3 py-2 text-xs">
      {label != null ? (
        <p className="font-medium text-foreground mb-1">
          {labelFormatter ? labelFormatter(label) : String(label)}
        </p>
      ) : null}
      <div className="space-y-0.5">
        {payload.map((p, i) => {
          const [val, name] = formatter
            ? formatter(p.value, p.name, { payload: p.payload })
            : [String(p.value ?? 0), String(p.name ?? "")];
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              {name ? <span className="text-muted-foreground">{name}</span> : null}
              <span className="font-medium text-foreground tabular-nums ml-auto">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Empty state ---------- */
function EmptyChart({ message = "Sem dados ainda" }: { message?: string }) {
  return (
    <div className="h-[300px] flex items-center justify-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/* ---------- Eixos comuns ---------- */
const axisProps = {
  fontSize: 11,
  tick: { fill: "oklch(0.55 0.02 250)" },
  axisLine: false,
  tickLine: false,
};

const gridProps = {
  strokeDasharray: "0",
  stroke: "oklch(0.92 0.01 250)",
  vertical: false,
};

/* ============================================================
 * 1. Distribuição por plano (donut com stat no centro + legenda)
 * ============================================================ */
export function PlanoBreakdownChart({ data }: { data: PlanoBreakdown[] }) {
  const filtered = data.filter((d) => d.total > 0);
  const formatted = filtered.map((d) => ({
    name: d.plano,
    value: d.total,
    receita: d.receita,
    ativos: d.ativos,
  }));
  const totalLeads = formatted.reduce((acc, d) => acc + d.value, 0);

  return (
    <Card className="border-0 shadow-sm rounded-3xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Distribuição por plano</CardTitle>
        <p className="text-xs text-muted-foreground">{formatted.length} planos · {totalLeads} leads</p>
      </CardHeader>
      <CardContent>
        {formatted.length === 0 ? (
          <EmptyChart />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-center">
            <div className="relative">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={formatted}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={68}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {formatted.map((_, i) => (
                      <Cell key={i} fill={LIME_RAMP[i % LIME_RAMP.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    content={
                      <ChartTooltip
                        formatter={(value, _name, item) => {
                          const p = (item.payload ?? {}) as { name?: string; receita?: number; ativos?: number };
                          return [
                            `${value} leads · ${p.ativos ?? 0} ativos · ${brl(p.receita ?? 0)}`,
                            String(p.name ?? ""),
                          ];
                        }}
                      />
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Center stat */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-bold tabular-nums text-foreground">
                  {totalLeads}
                </span>
                <span className="text-xs text-muted-foreground">leads</span>
              </div>
            </div>
            {/* Legenda lateral com truncate */}
            <ul className="space-y-2 sm:min-w-[140px] sm:max-w-[200px]">
              {formatted.map((d, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: LIME_RAMP[i % LIME_RAMP.length] }}
                  />
                  <span className="truncate flex-1 text-foreground" title={d.name}>
                    {d.name}
                  </span>
                  <span className="text-muted-foreground tabular-nums shrink-0">{d.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * 2. Leads por dia — barras agrupadas com gradiente
 * ============================================================ */
export function DailyVolumeChart({ data }: { data: DailyMetric[] }) {
  const hasData = data.some((d) => d.entradas > 0 || d.convertidos > 0);
  return (
    <Card className="border-0 shadow-sm rounded-3xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Leads por dia</CardTitle>
        <p className="text-xs text-muted-foreground">Entradas vs convertidos · últimos 30 dias</p>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} barGap={2} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-entradas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PALETTE.lime} stopOpacity={1} />
                  <stop offset="100%" stopColor={PALETTE.lime} stopOpacity={0.4} />
                </linearGradient>
                <linearGradient id="grad-convertidos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PALETTE.forest} stopOpacity={1} />
                  <stop offset="100%" stopColor={PALETTE.forest} stopOpacity={0.5} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" tickFormatter={formatDateLabel} {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip
                cursor={{ fill: "oklch(0.92 0.01 250 / 0.5)" }}
                content={
                  <ChartTooltip
                    labelFormatter={(d) => formatDateLabel(String(d))}
                    formatter={(v, n) => [String(v ?? 0), String(n ?? "")]}
                  />
                }
              />
              <Bar
                dataKey="entradas"
                name="Entradas"
                fill="url(#grad-entradas)"
                radius={[6, 6, 0, 0]}
                maxBarSize={20}
              />
              <Bar
                dataKey="convertidos"
                name="Convertidos"
                fill="url(#grad-convertidos)"
                radius={[6, 6, 0, 0]}
                maxBarSize={20}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
        {/* Legenda manual */}
        <div className="flex items-center gap-4 mt-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: PALETTE.lime }} />
            <span className="text-muted-foreground">Entradas</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: PALETTE.forest }} />
            <span className="text-muted-foreground">Convertidos</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * 3. Taxa de conversão — area chart com fade lime
 * ============================================================ */
export function ConversionTrendChart({ data }: { data: DailyMetric[] }) {
  const formatted = data.map((d) => ({ ...d, taxa: Math.round(d.taxaConversao * 1000) / 10 }));
  const hasData = formatted.some((d) => d.taxa > 0);
  const avg = formatted.length
    ? formatted.reduce((acc, d) => acc + d.taxa, 0) / formatted.length
    : 0;

  return (
    <Card className="border-0 shadow-sm rounded-3xl">
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold">Taxa de conversão</CardTitle>
            <p className="text-xs text-muted-foreground">Tendência diária · últimos 30 dias</p>
          </div>
          {hasData ? (
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums" style={{ color: PALETTE.forest }}>
                {avg.toFixed(1)}%
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">média</p>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={formatted} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-taxa" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PALETTE.forest} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={PALETTE.forest} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" tickFormatter={formatDateLabel} {...axisProps} />
              <YAxis unit="%" {...axisProps} />
              <Tooltip
                cursor={{ stroke: PALETTE.forest, strokeWidth: 1, strokeDasharray: "4 4" }}
                content={
                  <ChartTooltip
                    labelFormatter={(d) => formatDateLabel(String(d))}
                    formatter={(v) => [`${Number(v ?? 0).toFixed(1)}%`, "Taxa"]}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="taxa"
                stroke={PALETTE.forest}
                strokeWidth={2.5}
                fill="url(#grad-taxa)"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "white", fill: PALETTE.forest }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * 4. Conversões por dia — bars com gradiente lime
 * ============================================================ */
export function ConvertedByDayChart({ data }: { data: DailyMetric[] }) {
  const hasData = data.some((d) => d.convertidos > 0);
  const total = data.reduce((acc, d) => acc + d.convertidos, 0);
  return (
    <Card className="border-0 shadow-sm rounded-3xl">
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold">Conversões por dia</CardTitle>
            <p className="text-xs text-muted-foreground">Pagamentos confirmados · últimos 30 dias</p>
          </div>
          {hasData ? (
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {total}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">no período</p>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-conv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PALETTE.lime} stopOpacity={1} />
                  <stop offset="100%" stopColor={PALETTE.lime} stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" tickFormatter={formatDateLabel} {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip
                cursor={{ fill: "oklch(0.92 0.01 250 / 0.5)" }}
                content={
                  <ChartTooltip
                    labelFormatter={(d) => formatDateLabel(String(d))}
                    formatter={(v) => [String(v ?? 0), "Convertidos"]}
                  />
                }
              />
              <Bar
                dataKey="convertidos"
                fill="url(#grad-conv)"
                radius={[6, 6, 0, 0]}
                maxBarSize={24}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * 5. Distribuição por tipo — donut igual ao plano (paleta multi)
 * ============================================================ */
export function TipoBreakdownChart({ data }: { data: TipoBreakdown[] }) {
  const formatted = data
    .filter((d) => d.total > 0)
    .map((d) => ({
      ...d,
      label: TIPO_LABEL[d.tipo as keyof typeof TIPO_LABEL] ?? d.tipo,
    }));
  const total = formatted.reduce((acc, d) => acc + d.total, 0);

  return (
    <Card className="border-0 shadow-sm rounded-3xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Distribuição por tipo</CardTitle>
        <p className="text-xs text-muted-foreground">{formatted.length} categorias · {total} leads</p>
      </CardHeader>
      <CardContent>
        {formatted.length === 0 ? (
          <EmptyChart />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-center">
            <div className="relative">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={formatted}
                    dataKey="total"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={68}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {formatted.map((_, i) => (
                      <Cell key={i} fill={TIPO_RAMP[i % TIPO_RAMP.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    content={
                      <ChartTooltip
                        formatter={(value, _name, item) => {
                          const p = (item.payload ?? {}) as { label?: string };
                          return [`${value} leads`, String(p.label ?? "")];
                        }}
                      />
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-bold tabular-nums text-foreground">{total}</span>
                <span className="text-xs text-muted-foreground">leads</span>
              </div>
            </div>
            <ul className="space-y-2 sm:min-w-[140px] sm:max-w-[200px]">
              {formatted.map((d, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: TIPO_RAMP[i % TIPO_RAMP.length] }}
                  />
                  <span className="truncate flex-1 text-foreground" title={d.label}>
                    {d.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums shrink-0">{d.total}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
