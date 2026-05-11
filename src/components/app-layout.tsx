import { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import {
  LayoutDashboard,
  Users,
  Workflow,
  Megaphone,
  Target,
  LogOut,
  Search,
  Bell,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ProdutoProvider } from "@/contexts/produto-context";
import { ProductSwitcher } from "@/components/product-switcher";
import { PeriodSelector } from "@/components/period-selector";
import type { SidebarCounts } from "@shared/types";

const SIDEBAR_KEY = "lead-tracker:sidebar-expanded";

function AppShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  });
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, expanded ? "1" : "0");
  }, [expanded]);

  const { data: counts } = useQuery({
    queryKey: ["sidebar", "counts"],
    queryFn: () => api.get<SidebarCounts>("/api/dashboard/sidebar-counts"),
    staleTime: 30 * 1000,
  });

  const logout = useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar — expansível com toggle. Largura anima entre collapsed (88px)
          e expanded (220px). Estado persistido em localStorage. */}
      <aside
        className={`${
          expanded ? "w-[220px]" : "w-[88px]"
        } bg-sidebar border-r border-sidebar-border py-6 flex flex-col gap-1 sticky top-0 h-screen self-start transition-[width] duration-200 ease-out relative`}
      >
        {/* Logo */}
        <div className={`flex items-center ${expanded ? "px-5" : "justify-center"} mb-4`}>
          <div className="size-11 rounded-2xl bg-forest grid place-items-center text-[oklch(0.96_0.04_130)] shrink-0">
            <Logo />
          </div>
          {expanded ? (
            <span className="ml-3 font-bold tracking-tight text-foreground">Lead Tracker</span>
          ) : null}
        </div>

        {/* Toggle button — fica na borda direita do sidebar */}
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          title={expanded ? "Recolher" : "Expandir"}
          className="absolute top-7 -right-3 size-6 rounded-full bg-card border border-border shadow-sm grid place-items-center text-foreground/60 hover:text-foreground hover:bg-muted transition-colors z-10"
        >
          {expanded ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>

        {/* Nav */}
        <nav className={`flex flex-col gap-1 flex-1 pt-4 ${expanded ? "px-3" : "items-center"}`}>
          <SideIcon to="/dashboard" icon={LayoutDashboard} label="Dashboard" expanded={expanded} />
          <SideIcon to="/leads" icon={Users} label="Leads" expanded={expanded} />
          <SideIcon
            to="/automacoes"
            icon={Workflow}
            label="Automações"
            expanded={expanded}
            badge={counts?.filaMensagens && counts.filaMensagens > 0 ? counts.filaMensagens : undefined}
          />
          <SideIcon to="/ads" icon={Megaphone} label="Meta Ads" expanded={expanded} />
          <SideIcon to="/personas" icon={Target} label="Personas" expanded={expanded} />
          <SideIcon to="/quiz" icon={HelpCircle} label="Quiz" expanded={expanded} />
        </nav>

        {/* Logout */}
        <div className={expanded ? "px-3" : "flex justify-center"}>
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            title="Sair"
            className={`${
              expanded ? "w-full justify-start px-3 gap-3" : "size-11 justify-center"
            } h-11 rounded-2xl flex items-center text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all disabled:opacity-50`}
          >
            <LogOut className="size-5 shrink-0" />
            {expanded ? <span className="text-sm font-medium">Sair</span> : null}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-4 px-8 py-5">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-2xl font-bold tracking-tight">Lead Tracker</div>
            <ProductSwitcher />
          </div>
          <div className="flex items-center gap-3">
            <PeriodSelector />
            <button className="size-11 rounded-2xl bg-card border border-border grid place-items-center text-foreground/70 hover:text-foreground transition-colors">
              <Search className="size-4" />
            </button>
            <button className="size-11 rounded-2xl bg-card border border-border grid place-items-center text-foreground/70 hover:text-foreground transition-colors">
              <MessageCircle className="size-4" />
            </button>
            <button className="size-11 rounded-2xl bg-card border border-border grid place-items-center text-foreground/70 hover:text-foreground transition-colors relative">
              <Bell className="size-4" />
              <span className="absolute top-2 right-2 size-2 rounded-full bg-destructive" />
            </button>
            <div className="size-11 rounded-2xl bg-lime-soft grid place-items-center font-semibold text-foreground text-sm">
              W
            </div>
          </div>
        </header>

        <main className="flex-1 px-8 pb-8 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SideIcon({
  to,
  icon: Icon,
  label,
  badge,
  expanded,
}: {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  badge?: number;
  expanded: boolean;
}) {
  return (
    <NavLink
      to={to}
      title={!expanded ? label : undefined}
      className={({ isActive }) =>
        [
          "h-11 rounded-2xl flex items-center transition-all relative shrink-0",
          expanded ? "px-3 gap-3 w-full" : "size-11 justify-center",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
        ].join(" ")
      }
    >
      <Icon className="size-5 shrink-0" />
      {expanded ? (
        <span className="text-sm font-medium flex-1 truncate">{label}</span>
      ) : null}
      {badge !== undefined ? (
        <span
          className={`${
            expanded ? "ml-auto" : "absolute -top-0.5 -right-0.5"
          } min-w-[18px] h-[18px] rounded-full bg-destructive text-white text-[10px] font-bold grid place-items-center px-1 tabular-nums`}
        >
          {badge}
        </span>
      ) : null}
    </NavLink>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5">
      <circle cx="6" cy="6" r="2.5" fill="currentColor" />
      <circle cx="18" cy="6" r="2.5" fill="currentColor" />
      <circle cx="6" cy="18" r="2.5" fill="currentColor" />
      <circle cx="18" cy="18" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function AppLayout() {
  return (
    <ProdutoProvider>
      <AppShell />
    </ProdutoProvider>
  );
}
