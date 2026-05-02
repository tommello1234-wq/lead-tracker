import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
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
    <div className="min-h-screen grid place-items-center bg-background p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          login.mutate(password);
        }}
        className="w-full max-w-sm bg-card rounded-3xl shadow-sm border border-border p-8 space-y-4"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lead Tracker</h1>
          <p className="text-sm text-muted-foreground mt-1">Entre com sua senha</p>
        </div>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha"
          className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={login.isPending || !password}
          className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {login.isPending ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
