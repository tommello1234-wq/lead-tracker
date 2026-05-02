import { NavLink, Outlet, useNavigate } from "react-router";
import {
  LayoutDashboard,
  Users,
  Workflow,
  Megaphone,
  LogOut,
  Search,
  Bell,
  MessageCircle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ProdutoProvider } from "@/contexts/produto-context";
import { ProductSwitcher } from "@/components/product-switcher";
import { PeriodSelector } from "@/components/period-selector";
import type { SidebarCounts } from "@shared/types";

function AppShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
      {/* Sidebar light cream */}
      <aside className="w-[88px] bg-sidebar border-r border-sidebar-border py-6 flex flex-col items-center gap-1">
        {/* Logo */}
        <div className="size-11 rounded-2xl bg-forest grid place-items-center text-[oklch(0.96_0.04_130)] mb-4">
          <Logo />
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-2 flex-1 items-center pt-4">
          <SideIcon to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
          <SideIcon to="/leads" icon={Users} label="Leads" />
          <SideIcon
            to="/automacoes"
            icon={Workflow}
            label="Automações"
            badge={counts?.filaMensagens && counts.filaMensagens > 0 ? counts.filaMensagens : undefined}
          />
          <SideIcon to="/ads" icon={Megaphone} label="Meta Ads" />
        </nav>

        {/* Logout */}
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          title="Sair"
          className="size-11 rounded-2xl grid place-items-center text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all disabled:opacity-50"
        >
          <LogOut className="size-5" />
        </button>
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
}: {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        [
          "size-11 rounded-2xl grid place-items-center transition-all relative",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
        ].join(" ")
      }
    >
      <Icon className="size-5" />
      {badge !== undefined ? (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-white text-[10px] font-bold grid place-items-center px-1 tabular-nums">
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
