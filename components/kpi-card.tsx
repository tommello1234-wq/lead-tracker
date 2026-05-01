import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Props = {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  accent?: "blue" | "green" | "amber" | "violet" | "rose" | "slate";
};

const ACCENT: Record<NonNullable<Props["accent"]>, string> = {
  blue: "text-blue-600 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40",
  green: "text-emerald-600 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40",
  amber: "text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40",
  violet: "text-violet-600 bg-violet-50 dark:text-violet-300 dark:bg-violet-950/40",
  rose: "text-rose-600 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40",
  slate: "text-slate-600 bg-slate-50 dark:text-slate-300 dark:bg-slate-900",
};

export function KpiCard({ label, value, hint, icon: Icon, accent = "slate" }: Props) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold tabular-nums">{value}</p>
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          </div>
          <div className={cn("p-2.5 rounded-lg", ACCENT[accent])}>
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
