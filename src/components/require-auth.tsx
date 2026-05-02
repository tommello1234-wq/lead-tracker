import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router";
import { api } from "@/lib/api";
import type { ReactNode } from "react";

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<{ authenticated: boolean }>("/api/auth/me"),
    staleTime: 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!data?.authenticated) {
    const search = new URLSearchParams({ from: location.pathname }).toString();
    return <Navigate to={`/login?${search}`} replace />;
  }

  return <>{children}</>;
}
