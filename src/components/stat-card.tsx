import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Trend = { value: number; positive?: boolean };

/**
 * Stat card no estilo COINEST: branco, ícone em círculo lime claro,
 * trend opcional acima do valor, label embaixo.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  iconTone = "lime",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  trend?: Trend;
  iconTone?: "lime" | "forest" | "rose" | "amber";
}) {
  const toneClass = {
    lime: "bg-lime-soft text-forest",
    forest: "bg-forest text-[oklch(0.86_0.18_130)]",
    rose: "bg-[oklch(0.95_0.03_25)] text-[oklch(0.55_0.18_25)]",
    amber: "bg-[oklch(0.95_0.05_85)] text-[oklch(0.55_0.18_75)]",
  }[iconTone];

  return (
    <div className="card-soft p-5 sm:p-6 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        {Icon ? (
          <div className={`size-10 rounded-2xl grid place-items-center ${toneClass}`}>
            <Icon className="size-5" />
          </div>
        ) : (
          <div />
        )}
        {trend ? (
          <span
            className={[
              "text-xs font-semibold px-2 py-1 rounded-lg tabular-nums",
              trend.positive
                ? "text-[oklch(0.55_0.18_140)] bg-[oklch(0.94_0.07_130)]"
                : "text-[oklch(0.55_0.18_25)] bg-[oklch(0.95_0.04_25)]",
            ].join(" ")}
          >
            {trend.positive ? "↗" : "↘"} {trend.value > 0 ? "+" : ""}
            {trend.value}%
          </span>
        ) : null}
      </div>

      <div className="space-y-1">
        <p className="text-2xl sm:text-3xl font-bold tabular-nums tracking-tight">
          {value}
        </p>
        <p className="text-sm text-muted-foreground">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground/80">{hint}</p> : null}
      </div>
    </div>
  );
}
