import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
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
            <p className="text-xs text-muted-foreground">Pagaram ÷ tentaram (rolling 7d) · últimos 30 dias</p>
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
 * 4.5. Faturamento + Lucro por dia — area chart com 3 séries
 * Fonte: /api/dashboard/daily-revenue
 *   - total: compras + renovações − reembolsos
 *   - gasto: spend Meta Ads no dia
 *   - lucro: total − gasto
 * ============================================================ */
export type DailyRevenue = {
  date: string;
  bruto: number;
  reembolso: number;
  total: number;
  count: number;
  gasto: number;
  lucro: number;
};

export function DailyRevenueChart({ data }: { data: DailyRevenue[] }) {
  const hasData = data.some((d) => d.total > 0 || d.gasto > 0 || d.reembolso > 0);
  const totalBruto = data.reduce((acc, d) => acc + d.bruto, 0);
  const totalReembolso = data.reduce((acc, d) => acc + d.reembolso, 0);
  const totalFat = data.reduce((acc, d) => acc + d.total, 0);
  const totalGasto = data.reduce((acc, d) => acc + d.gasto, 0);
  const totalLucro = totalFat - totalGasto;
  const showGasto = totalGasto > 0;
  const showReembolso = totalReembolso > 0;

  // Cores: faturamento (lime/forest), gasto (rose/amber), lucro (emerald escuro)
  const COLOR_FAT = "oklch(0.65 0.18 145)";
  const COLOR_GASTO = "oklch(0.68 0.18 28)";
  const COLOR_LUCRO = "oklch(0.45 0.15 155)";

  return (
    <Card className="border-0 shadow-sm rounded-3xl overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-base font-semibold">
              Faturamento × Lucro
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Receita líquida vs. gasto Meta Ads · últimos 30 dias
            </p>
          </div>
          {hasData ? (
            <div className="flex items-center gap-5 text-right flex-wrap justify-end">
              <div>
                <p
                  className="text-xl font-bold tabular-nums leading-none"
                  style={{ color: COLOR_FAT }}
                >
                  {brl(totalFat)}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                  Faturamento{showReembolso ? " (líquido)" : ""}
                </p>
              </div>
              {showReembolso ? (
                <>
                  <div className="w-px h-8 bg-border" />
                  <div>
                    <p
                      className="text-xl font-bold tabular-nums leading-none"
                      style={{ color: COLOR_GASTO }}
                    >
                      −{brl(totalReembolso)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                      Reembolsos
                    </p>
                  </div>
                </>
              ) : null}
              {showGasto ? (
                <>
                  <div className="w-px h-8 bg-border" />
                  <div>
                    <p
                      className="text-xl font-bold tabular-nums leading-none"
                      style={{ color: COLOR_GASTO }}
                    >
                      −{brl(totalGasto)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                      Gasto Meta
                    </p>
                  </div>
                  <div className="w-px h-8 bg-border" />
                  <div>
                    <p
                      className="text-xl font-bold tabular-nums leading-none"
                      style={{
                        color: totalLucro >= 0 ? COLOR_LUCRO : COLOR_GASTO,
                      }}
                    >
                      {brl(totalLucro)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                      Lucro
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <AreaChart
              data={data}
              margin={{ top: 12, right: 16, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="grad-fat-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_FAT} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={COLOR_FAT} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-lucro-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_LUCRO} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={COLOR_LUCRO} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-gasto-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_GASTO} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={COLOR_GASTO} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="2 4"
                stroke="oklch(0.92 0.01 250)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateLabel}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "oklch(0.55 0.02 250)", fontSize: 11 }}
                tickMargin={8}
                interval="preserveStartEnd"
                minTickGap={32}
              />
              <YAxis
                tickFormatter={(v) => brl(Number(v))}
                width={64}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "oklch(0.55 0.02 250)", fontSize: 11 }}
              />
              <Tooltip
                cursor={{
                  stroke: "oklch(0.65 0.02 250)",
                  strokeWidth: 1,
                  strokeDasharray: "4 4",
                }}
                content={
                  <ChartTooltip
                    labelFormatter={(d) => formatDateLabel(String(d))}
                    formatter={(v, name, item) => {
                      const p = (item.payload ?? {}) as {
                        count?: number;
                        bruto?: number;
                        reembolso?: number;
                      };
                      const label = String(name ?? "");
                      if (label === "Faturamento") {
                        const parts: string[] = [
                          `${brl(Number(v ?? 0))} líquido`,
                        ];
                        if (p.count != null) {
                          parts.push(`${p.count} venda${p.count === 1 ? "" : "s"}`);
                        }
                        if (p.bruto != null && p.bruto !== Number(v)) {
                          parts.push(`${brl(p.bruto)} bruto`);
                        }
                        if (p.reembolso != null && p.reembolso > 0) {
                          parts.push(`−${brl(p.reembolso)} reembolso`);
                        }
                        return [parts.join(" · "), label];
                      }
                      return [brl(Number(v ?? 0)), label];
                    }}
                  />
                }
              />
              {/* Faturamento — área forte */}
              <Area
                type="monotone"
                dataKey="total"
                name="Faturamento"
                stroke={COLOR_FAT}
                strokeWidth={2.5}
                fill="url(#grad-fat-area)"
                dot={false}
                activeDot={{
                  r: 5,
                  strokeWidth: 2,
                  stroke: "white",
                  fill: COLOR_FAT,
                }}
              />
              {/* Gasto Meta — área discreta */}
              {showGasto ? (
                <Area
                  type="monotone"
                  dataKey="gasto"
                  name="Gasto Meta"
                  stroke={COLOR_GASTO}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  fill="url(#grad-gasto-area)"
                  dot={false}
                  activeDot={{
                    r: 4,
                    strokeWidth: 2,
                    stroke: "white",
                    fill: COLOR_GASTO,
                  }}
                />
              ) : null}
              {/* Lucro — linha principal destacada */}
              {showGasto ? (
                <Area
                  type="monotone"
                  dataKey="lucro"
                  name="Lucro"
                  stroke={COLOR_LUCRO}
                  strokeWidth={3}
                  fill="url(#grad-lucro-area)"
                  dot={false}
                  activeDot={{
                    r: 6,
                    strokeWidth: 2,
                    stroke: "white",
                    fill: COLOR_LUCRO,
                  }}
                />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        )}
        {/* Legenda inline */}
        {hasData ? (
          <div className="flex items-center gap-5 mt-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span
                className="size-3 rounded-sm"
                style={{ backgroundColor: COLOR_FAT }}
              />
              <span className="text-muted-foreground">Faturamento</span>
            </span>
            {showGasto ? (
              <>
                <span className="flex items-center gap-1.5">
                  <span
                    className="block w-4 h-0.5 border-t-2 border-dashed"
                    style={{ borderColor: COLOR_GASTO }}
                  />
                  <span className="text-muted-foreground">Gasto Meta</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-3 rounded-sm"
                    style={{ backgroundColor: COLOR_LUCRO }}
                  />
                  <span className="text-muted-foreground">Lucro</span>
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * 4.7. Vendas por LP — tabela ordenada com bullet de % participação
 * Fonte: /api/dashboard/vendas-por-lp
 * ============================================================ */
export type VendaPorLp = {
  lp: string;
  referrer: string | null;
  vendas: number;
  receita: number;
};

function formatLpLabel(lp: string): string {
  if (lp === "(sem LP rastreada)") return lp;
  if (lp === "home") return "/ (home)";
  return "/" + lp;
}

export function VendasPorLpChart({
  data,
  periodLabel,
}: {
  data: VendaPorLp[];
  periodLabel?: string;
}) {
  const total = data.reduce((acc, d) => acc + d.vendas, 0);
  const totalReceita = data.reduce((acc, d) => acc + d.receita, 0);
  const hasData = total > 0;

  // Cor lime gradiente por posição (1ª linha mais forte)
  const intensities = [
    "oklch(0.78 0.20 132)",
    "oklch(0.68 0.18 138)",
    "oklch(0.58 0.16 142)",
    "oklch(0.48 0.14 145)",
    "oklch(0.40 0.10 148)",
  ];

  return (
    <Card className="border-0 shadow-sm rounded-3xl">
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold">
              Vendas por LP
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Qual landing page originou cada venda · {periodLabel ?? "últimos 30 dias"}
            </p>
          </div>
          {hasData ? (
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums" style={{ color: PALETTE.forest }}>
                {total}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {brl(totalReceita)} total
              </p>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyChart />
        ) : (
          <div className="space-y-2">
            {data.slice(0, 10).map((d, i) => {
              const pct = total > 0 ? (d.vendas / total) * 100 : 0;
              const cor = intensities[Math.min(i, intensities.length - 1)];
              return (
                <div key={d.lp + (d.referrer ?? "")} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-mono text-xs truncate flex-1" title={formatLpLabel(d.lp)}>
                      {formatLpLabel(d.lp)}
                      {d.referrer && d.referrer !== "direct" ? (
                        <span className="text-muted-foreground"> · via {d.referrer}</span>
                      ) : null}
                    </span>
                    <span className="font-bold tabular-nums whitespace-nowrap">
                      {d.vendas}
                      <span className="text-muted-foreground font-normal">
                        {" "}({pct.toFixed(0)}%)
                      </span>
                    </span>
                    <span className="text-xs tabular-nums text-forest whitespace-nowrap">
                      {brl(d.receita)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: pct + "%", backgroundColor: cor }}
                    />
                  </div>
                </div>
              );
            })}
            {data.length > 10 ? (
              <p className="text-[10px] text-muted-foreground pt-2">
                + {data.length - 10} outras LPs
              </p>
            ) : null}
          </div>
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

export type MrrHistoryPoint = {
  date: string;
  mrr: number;
  mrrEfetivo: number;
  subs: number;
  novos: number;
  cancelados: number;
};

type MetricKey = "mrr" | "mrrEfetivo" | "subs" | "novos" | "cancelados";

const METRIC_CONFIG: Record<MetricKey, { label: string; color: string; isMoney: boolean }> = {
  mrr: { label: "MRR", color: "oklch(0.55 0.20 270)", isMoney: true },
  mrrEfetivo: { label: "MRR efetivo", color: "oklch(0.65 0.18 145)", isMoney: true },
  subs: { label: "Subs ativas", color: "oklch(0.6 0.15 200)", isMoney: false },
  novos: { label: "Novos no dia", color: "oklch(0.7 0.18 130)", isMoney: false },
  cancelados: { label: "Cancelados no dia", color: "oklch(0.65 0.20 25)", isMoney: false },
};

/**
 * Evolução do MRR ao longo do tempo. Cada ponto = snapshot de MRR no fim
 * daquele dia (subs ativas naquela data × valor mensalizado).
 *
 * Diferente do gráfico Faturamento × Lucro (fluxo de entradas no caixa),
 * aqui é stock de receita recorrente. Sobe quando entra cliente novo, cai
 * quando sai. Útil pra ver trajetória de crescimento da base.
 */
export function MrrHistoryChart({ data }: { data: MrrHistoryPoint[] }) {
  // Toggles: quais séries mostrar. MRR sempre ON por default.
  const [active, setActive] = useState<Record<MetricKey, boolean>>({
    mrr: true,
    mrrEfetivo: false,
    subs: false,
    novos: false,
    cancelados: false,
  });

  function toggle(key: MetricKey) {
    setActive((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const hasData = data.some((d) => d.mrr > 0);
  const last = data[data.length - 1] ?? null;
  const first = data[0] ?? null;
  const variacaoMrr = last && first ? last.mrr - first.mrr : 0;
  const pctVar = first && first.mrr > 0 ? (variacaoMrr / first.mrr) * 100 : 0;

  // Detecta se tem séries em dinheiro E em count (precisa eixo Y duplo)
  const anyMoney = active.mrr || active.mrrEfetivo;
  const anyCount = active.subs || active.novos || active.cancelados;

  return (
    <Card className="border-0 shadow-sm rounded-3xl overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-base font-semibold">Evolução do MRR</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Snapshot por dia · clique nas séries pra ligar/desligar
            </p>
          </div>
          {hasData && last ? (
            <div className="flex items-center gap-5 text-right">
              <div>
                <p
                  className="text-xl font-bold tabular-nums leading-none"
                  style={{ color: METRIC_CONFIG.mrr.color }}
                >
                  {brl(last.mrr)}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                  MRR atual · {last.subs} subs
                </p>
              </div>
              {variacaoMrr !== 0 && first && first.mrr > 0 ? (
                <>
                  <div className="w-px h-8 bg-border" />
                  <div>
                    <p
                      className={`text-xl font-bold tabular-nums leading-none ${
                        variacaoMrr >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {variacaoMrr >= 0 ? "+" : ""}
                      {brl(variacaoMrr)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                      Variação · {pctVar >= 0 ? "+" : ""}
                      {pctVar.toFixed(1)}%
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Toggles das séries */}
        <div className="flex flex-wrap gap-2 mt-4">
          {(Object.keys(METRIC_CONFIG) as MetricKey[]).map((key) => {
            const cfg = METRIC_CONFIG[key];
            const isActive = active[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  isActive
                    ? "bg-muted/40 text-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted/20"
                }`}
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{
                    backgroundColor: isActive ? cfg.color : "oklch(0.85 0.01 250)",
                  }}
                />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-mrr-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={METRIC_CONFIG.mrr.color} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={METRIC_CONFIG.mrr.color} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-mrr-efetivo-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={METRIC_CONFIG.mrrEfetivo.color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={METRIC_CONFIG.mrrEfetivo.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="2 4"
                stroke="oklch(0.92 0.01 250)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateLabel}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "oklch(0.55 0.02 250)", fontSize: 11 }}
                tickMargin={8}
                interval="preserveStartEnd"
                minTickGap={32}
              />
              {anyMoney ? (
                <YAxis
                  yAxisId="money"
                  tickFormatter={(v) => brl(Number(v))}
                  width={64}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "oklch(0.55 0.02 250)", fontSize: 11 }}
                />
              ) : null}
              {anyCount ? (
                <YAxis
                  yAxisId="count"
                  orientation={anyMoney ? "right" : "left"}
                  width={48}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "oklch(0.55 0.02 250)", fontSize: 11 }}
                />
              ) : null}
              <Tooltip
                cursor={{
                  stroke: "oklch(0.65 0.02 250)",
                  strokeWidth: 1,
                  strokeDasharray: "4 4",
                }}
                content={
                  <ChartTooltip
                    labelFormatter={(d) => formatDateLabel(String(d))}
                    formatter={(v, name) => {
                      const label = String(name ?? "");
                      const key = (Object.keys(METRIC_CONFIG) as MetricKey[]).find(
                        (k) => METRIC_CONFIG[k].label === label,
                      );
                      if (!key) return [String(v), label];
                      const isMoney = METRIC_CONFIG[key].isMoney;
                      return [isMoney ? brl(Number(v ?? 0)) : String(v ?? 0), label];
                    }}
                  />
                }
              />
              {active.mrr ? (
                <Area
                  yAxisId="money"
                  type="monotone"
                  dataKey="mrr"
                  name="MRR"
                  stroke={METRIC_CONFIG.mrr.color}
                  strokeWidth={2.5}
                  fill="url(#grad-mrr-area)"
                />
              ) : null}
              {active.mrrEfetivo ? (
                <Area
                  yAxisId="money"
                  type="monotone"
                  dataKey="mrrEfetivo"
                  name="MRR efetivo"
                  stroke={METRIC_CONFIG.mrrEfetivo.color}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  fill="url(#grad-mrr-efetivo-area)"
                />
              ) : null}
              {active.subs ? (
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="subs"
                  name="Subs ativas"
                  stroke={METRIC_CONFIG.subs.color}
                  strokeWidth={2}
                  dot={false}
                />
              ) : null}
              {active.novos ? (
                <Bar
                  yAxisId="count"
                  dataKey="novos"
                  name="Novos no dia"
                  fill={METRIC_CONFIG.novos.color}
                  opacity={0.7}
                />
              ) : null}
              {active.cancelados ? (
                <Bar
                  yAxisId="count"
                  dataKey="cancelados"
                  name="Cancelados no dia"
                  fill={METRIC_CONFIG.cancelados.color}
                  opacity={0.7}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
