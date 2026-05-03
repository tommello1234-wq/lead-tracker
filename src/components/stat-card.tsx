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
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  trend?: Trend;
  iconTone?: "lime" | "forest" | "rose" | "amber";
  onClick?: () => void;
}) {
  const toneClass = {
    lime: "bg-lime-soft text-forest",
    forest: "bg-forest text-[oklch(0.86_0.18_130)]",
    rose: "bg-[oklch(0.95_0.03_25)] text-[oklch(0.55_0.18_25)]",
    amber: "bg-[oklch(0.95_0.05_85)] text-[oklch(0.55_0.18_75)]",
  }[iconTone];

  const inner = (
    <>
      {Icon ? (
        <div className={`size-12 rounded-2xl grid place-items-center shrink-0 ${toneClass}`}>
          <Icon className="size-5" />
        </div>
      ) : null}

      <div className="flex-1 min-w-0">
        <p className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight leading-tight">
          {value}
        </p>
        <p className="text-sm text-muted-foreground">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground/80 truncate">{hint}</p> : null}
      </div>

      {trend ? (
        <span
          className={[
            "absolute top-3 right-3 text-xs font-semibold px-2 py-1 rounded-lg tabular-nums",
            trend.positive
              ? "text-[oklch(0.55_0.18_140)] bg-[oklch(0.94_0.07_130)]"
              : "text-[oklch(0.55_0.18_25)] bg-[oklch(0.95_0.04_25)]",
          ].join(" ")}
        >
          {trend.positive ? "↗" : "↘"} {trend.value > 0 ? "+" : ""}
          {trend.value}%
        </span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="card-soft p-4 flex items-center gap-4 relative text-left hover:bg-muted/20 hover:border-foreground/20 transition-colors cursor-pointer w-full"
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="card-soft p-4 flex items-center gap-4 relative">{inner}</div>
  );
}
