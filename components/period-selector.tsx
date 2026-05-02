"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { persistPeriodCookie } from "@/lib/produto-context";
import { PERIODS, PERIOD_LABELS, type Period } from "@/lib/period";

const SHORT_LABELS: Record<Period, string> = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Mês",
  all: "Tudo",
};

export function PeriodSelector({ selected }: { selected: Period }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function pick(p: Period) {
    setOpen(false);
    if (p === selected) return;

    // 1. Atualiza URL imediatamente (dispara re-fetch dos RSCs e loading.tsx)
    const params = new URLSearchParams(searchParams);
    params.set("period", p);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });

    // 2. Persiste no cookie em background (fire-and-forget, sem revalidate)
    void persistPeriodCookie(p);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all",
          "bg-sidebar-accent/40 hover:bg-sidebar-accent text-sidebar-foreground",
          pending && "opacity-70",
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <Calendar className="size-3.5 shrink-0" />
        )}
        <span>{SHORT_LABELS[selected]}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 right-0 top-full mt-1 min-w-[180px] rounded-xl border bg-popover text-popover-foreground shadow-md py-1 animate-in fade-in-0 zoom-in-95">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => pick(p)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left",
                  selected === p && "font-medium",
                )}
              >
                <span className="flex-1">{PERIOD_LABELS[p]}</span>
                {selected === p ? <Check className="size-3.5" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
