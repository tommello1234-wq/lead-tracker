import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Lock, ArrowRight } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: (pwd: string) => api.post<{ ok: true }>("/api/auth/login", { password: pwd }),
    onSuccess: () => {
      const from = searchParams.get("from") ?? "/dashboard";
      navigate(from, { replace: true });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Erro inesperado");
    },
  });

  return (
    <div className="min-h-screen grid place-items-center bg-background p-6 relative overflow-hidden">
      {/* Decorative backdrop */}
      <div className="absolute -top-40 -right-40 size-[500px] rounded-full bg-lime-soft opacity-40 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 size-[400px] rounded-full bg-[oklch(0.95_0.05_140)] opacity-50 blur-3xl pointer-events-none" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          login.mutate(password);
        }}
        className="relative w-full max-w-md card-soft p-10 space-y-6"
      >
        <div className="text-center space-y-2">
          <div className="size-14 rounded-2xl bg-forest grid place-items-center mx-auto">
            <Lock className="size-6 text-[oklch(0.86_0.18_130)]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Lead Tracker</h1>
          <p className="text-sm text-muted-foreground">Entre com sua senha de acesso</p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-foreground/70 uppercase tracking-wider">
            Senha
          </label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full px-4 py-3 rounded-2xl bg-input/50 border border-border focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all text-foreground placeholder:text-muted-foreground"
          />
          {error ? (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-destructive" />
              {error}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={login.isPending || !password}
          className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 group"
        >
          {login.isPending ? (
            "Entrando..."
          ) : (
            <>
              Entrar
              <ArrowRight className="size-4 group-hover:translate-x-0.5 transition-transform" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
