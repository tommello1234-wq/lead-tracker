import { NavLink, Outlet, useNavigate } from "react-router";
import { LayoutDashboard, Users, Workflow, LogOut } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ProdutoProvider } from "@/contexts/produto-context";

type SidebarCounts = { emRisco: number; filaMensagens: number };

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
      {/* Sidebar */}
      <aside className="w-60 bg-sidebar text-sidebar-foreground p-4 flex flex-col gap-1">
        <div className="flex items-center gap-2 px-2 py-3 mb-4">
          <div className="size-8 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center font-bold text-sm">
            LT
          </div>
          <span className="font-semibold">Lead Tracker</span>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
          <SidebarItem to="/leads" icon={Users} label="Leads" />
          <SidebarItem
            to="/automacoes"
            icon={Workflow}
            label="Automações"
            badge={counts?.filaMensagens}
          />
        </nav>

        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all"
        >
          <LogOut className="size-4" />
          <span>Sair</span>
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function SidebarItem({
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
      className={({ isActive }) =>
        [
          "flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        ].join(" ")
      }
    >
      <span className="flex items-center gap-2.5">
        <Icon className="size-4 shrink-0" />
        {label}
      </span>
      {badge && badge > 0 ? (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-sidebar-accent tabular-nums">
          {badge}
        </span>
      ) : null}
    </NavLink>
  );
}

export function AppLayout() {
  return (
    <ProdutoProvider>
      <AppShell />
    </ProdutoProvider>
  );
}
