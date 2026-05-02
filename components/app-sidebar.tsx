"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  LogOut,
  Workflow,
  CircleDot,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { SidebarLink } from "@/components/sidebar-link";
import { ProductSwitcher } from "@/components/product-switcher";
import { cn } from "@/lib/utils";
import type { Produto } from "@/db/schema";

type Counts = {
  emRisco: number;
  filaMensagens: number;
};

const STORAGE_KEY = "lt-sidebar-collapsed";

export function AppSidebar({
  counts,
  produtos,
  selectedProdutoId,
}: {
  counts: Counts;
  produtos: Produto[];
  selectedProdutoId: number | null;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "1") setCollapsed(true);
    setHydrated(true);
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  // Pre-hidratação: render como expanded por default (evita flash)
  // Após hidratação: aplica preferência salva
  const isCollapsed = hydrated && collapsed;

  return (
    <aside
      className={cn(
        "shrink-0 rounded-3xl bg-sidebar text-sidebar-foreground flex flex-col transition-[width] duration-200 ease-out",
        isCollapsed ? "w-[72px]" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-5 transition-all",
          isCollapsed ? "justify-center" : "justify-between px-5",
        )}
      >
        {!isCollapsed ? (
          <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
            <div className="size-8 rounded-lg bg-[oklch(0.86_0.22_130)] grid place-items-center shrink-0">
              <span className="text-[oklch(0.18_0.05_150)] font-bold text-sm">
                LT
              </span>
            </div>
            <span className="font-bold tracking-tight text-base truncate">
              Lead Tracker
            </span>
          </Link>
        ) : (
          <Link href="/dashboard">
            <div className="size-9 rounded-lg bg-[oklch(0.86_0.22_130)] grid place-items-center">
              <span className="text-[oklch(0.18_0.05_150)] font-bold text-sm">
                LT
              </span>
            </div>
          </Link>
        )}

        {!isCollapsed ? (
          <button
            onClick={toggle}
            className="size-7 grid place-items-center rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            title="Recolher menu"
          >
            <PanelLeftClose className="size-4" />
          </button>
        ) : null}
      </div>

      {isCollapsed ? (
        <button
          onClick={toggle}
          className="mx-auto mb-2 size-7 grid place-items-center rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          title="Expandir menu"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      ) : null}

      <div className={cn("px-3 mb-3", isCollapsed && "px-0")}>
        <ProductSwitcher
          produtos={produtos}
          selectedId={selectedProdutoId}
          collapsed={isCollapsed}
        />
      </div>

      <nav className="flex-1 px-3 flex flex-col gap-5 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col gap-1">
          {!isCollapsed ? (
            <p className="px-3 text-[10px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase">
              Principal
            </p>
          ) : null}
          <SidebarLink
            href="/dashboard"
            collapsed={isCollapsed}
            label="Dashboard"
          >
            <LayoutDashboard className="size-4 shrink-0" />
          </SidebarLink>
          <SidebarLink
            href="/leads"
            collapsed={isCollapsed}
            label="Leads"
            badge={counts.emRisco > 0 ? counts.emRisco : undefined}
          >
            <Users className="size-4 shrink-0" />
          </SidebarLink>
        </div>

        <div className="flex flex-col gap-1">
          {!isCollapsed ? (
            <p className="px-3 text-[10px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase">
              Automação
            </p>
          ) : null}
          <SidebarLink
            href="/automacoes"
            collapsed={isCollapsed}
            label="Automações"
            badge={counts.filaMensagens > 0 ? counts.filaMensagens : undefined}
          >
            <Workflow className="size-4 shrink-0" />
          </SidebarLink>
        </div>
      </nav>

      <div className="p-3 space-y-2">
        {!isCollapsed ? (
          <div className="rounded-xl bg-sidebar-accent/40 p-3 text-xs">
            <div className="flex items-center gap-1.5 text-sidebar-foreground/90 font-medium">
              <CircleDot className="size-3 text-[oklch(0.86_0.22_130)]" />
              Sistema operacional
            </div>
            <p className="mt-1 text-sidebar-foreground/60 text-[11px]">
              WhatsApp conectado · Cron 5min
            </p>
          </div>
        ) : (
          <div
            className="size-9 mx-auto rounded-xl bg-sidebar-accent/40 grid place-items-center"
            title="Sistema operacional · WhatsApp conectado · Cron 5min"
          >
            <CircleDot className="size-4 text-[oklch(0.86_0.22_130)]" />
          </div>
        )}

        <form action="/api/auth/logout" method="POST">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className={cn(
              "w-full gap-2 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isCollapsed ? "justify-center px-0" : "justify-start",
            )}
            title="Sair"
          >
            <LogOut className="size-4" />
            {!isCollapsed ? <span>Sair</span> : null}
          </Button>
        </form>
      </div>
    </aside>
  );
}
