"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  href: string;
  children: React.ReactNode;
  label: string;
  collapsed?: boolean;
  badge?: string | number;
};

/**
 * Indicador de loading durante navegação (Next 16 useLinkStatus).
 * Aparece como spinner pequeno depois de 80ms — evita flash em navegações instantâneas.
 */
function NavLoadingIndicator() {
  const { pending } = useLinkStatus();
  return pending ? (
    <Loader2 className="size-3.5 animate-spin shrink-0" style={{ animationDuration: "0.6s" }} />
  ) : null;
}

export function SidebarLink({ href, children, label, collapsed, badge }: Props) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");

  if (collapsed) {
    return (
      <Link
        href={href}
        title={label}
        prefetch
        className={cn(
          "relative size-10 mx-auto grid place-items-center rounded-xl transition-all",
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        {children}
        {badge !== undefined ? (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] text-[10px] font-semibold px-1 rounded-full grid place-items-center tabular-nums bg-[oklch(0.86_0.22_130)] text-[oklch(0.18_0.05_150)]">
            {badge}
          </span>
        ) : null}
        <span className="absolute -bottom-0.5 -right-0.5">
          <NavLoadingIndicator />
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      prefetch
      className={cn(
        "group flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {children}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <NavLoadingIndicator />
        {badge !== undefined ? (
          <span
            className={cn(
              "text-[10px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums",
              active
                ? "bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground"
                : "bg-sidebar-accent text-sidebar-accent-foreground/80",
            )}
          >
            {badge}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
