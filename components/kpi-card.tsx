import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Props = {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  accent?: "lime" | "forest" | "emerald" | "amber" | "rose" | "slate";
};

const ACCENT: Record<NonNullable<Props["accent"]>, string> = {
  lime: "text-[oklch(0.18_0.05_150)] bg-[oklch(0.86_0.22_130)]",
  forest: "text-white bg-[oklch(0.15_0_0)]",
  emerald: "text-emerald-700 bg-emerald-100",
  amber: "text-amber-700 bg-amber-100",
  rose: "text-rose-700 bg-rose-100",
  slate: "text-slate-700 bg-slate-100",
};

export function KpiCard({ label, value, hint, icon: Icon, accent = "slate" }: Props) {
  return (
    <Card className="overflow-hidden border-0 shadow-sm rounded-3xl">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className={cn("size-10 rounded-full grid place-items-center shrink-0", ACCENT[accent])}>
            <Icon className="size-5" />
          </div>
        </div>
        <p className="text-4xl font-bold tabular-nums tracking-tight">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground mt-2">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
