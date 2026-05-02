import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Template = { key: string; nome: string; conteudo: string };
type FlowStep = {
  id: number;
  gatewayEvent: string;
  ordem: number;
  templateKey: string;
  delaySeconds: number;
  ativo: boolean;
};

export function AutomacoesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["automacoes", "templates"],
    queryFn: () =>
      api.get<{ templates: Template[]; flowSteps: FlowStep[] }>(
        "/api/automacoes/templates",
      ),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Automações</h1>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : error ? (
        <p className="text-sm text-destructive">
          Erro: {error instanceof Error ? error.message : "?"}
        </p>
      ) : data ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            {data.templates.length} templates · {data.flowSteps.length} passos de fluxo
          </p>
          {data.templates.map((t) => (
            <div key={t.key} className="rounded-2xl border border-border bg-card p-4">
              <p className="font-medium">{t.nome}</p>
              <p className="text-xs text-muted-foreground mt-1">{t.key}</p>
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Master-detail UI completa vem na próxima iteração.
      </p>
    </div>
  );
}
