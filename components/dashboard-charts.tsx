"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyMetric, TipoBreakdown } from "@/lib/queries";
import { TIPO_LABEL } from "@/lib/labels";

const COLORS = ["#1F4E78", "#C65911", "#BF9000", "#548235", "#7030A0", "#2E75B6"];

function formatDateLabel(d: string) {
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
}

export function DailyVolumeChart({ data }: { data: DailyMetric[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leads por dia (entradas vs convertidos)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateLabel}
              fontSize={12}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis allowDecimals={false} fontSize={12} tick={{ fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              labelFormatter={(d) => formatDateLabel(String(d))}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
              }}
            />
            <Legend />
            <Bar dataKey="entradas" name="Entradas" fill="#2E75B6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="convertidos" name="Convertidos" fill="#548235" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function ConversionTrendChart({ data }: { data: DailyMetric[] }) {
  const formatted = data.map((d) => ({ ...d, taxa: Math.round(d.taxaConversao * 1000) / 10 }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Taxa de conversao ao longo do tempo</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateLabel}
              fontSize={12}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              unit="%"
              fontSize={12}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <Tooltip
              labelFormatter={(d) => formatDateLabel(String(d))}
              formatter={(v) => [`${Number(v ?? 0).toFixed(1)}%`, "Taxa"]}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
              }}
            />
            <Line
              type="monotone"
              dataKey="taxa"
              name="Taxa conversao"
              stroke="#C65911"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function TipoBreakdownChart({ data }: { data: TipoBreakdown[] }) {
  const formatted = data.map((d) => ({
    ...d,
    label: TIPO_LABEL[d.tipo as keyof typeof TIPO_LABEL] ?? d.tipo,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Distribuicao por tipo de lead</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={formatted}
              dataKey="total"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={(entry: { name?: string; value?: number }) =>
                `${entry.name ?? ""}: ${entry.value ?? 0}`
              }
            >
              {formatted.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function ConvertedByDayChart({ data }: { data: DailyMetric[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversoes por dia</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateLabel}
              fontSize={12}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis allowDecimals={false} fontSize={12} tick={{ fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              labelFormatter={(d) => formatDateLabel(String(d))}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
              }}
            />
            <Bar dataKey="convertidos" name="Convertidos" fill="#548235" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
