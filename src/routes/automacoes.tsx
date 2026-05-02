import { useQuery } from "@tanstack/react-query";
import { Workflow, Plus, MessageSquare } from "lucide-react";
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
      api.get<{ templates: Template[]; flowSteps: FlowStep[] }>("/api/automacoes/templates"),
  });

  // Agrupa flow steps por gatewayEvent (eventos)
  const eventos = new Map<string, FlowStep[]>();
  for (const s of data?.flowSteps ?? []) {
    if (!eventos.has(s.gatewayEvent)) eventos.set(s.gatewayEvent, []);
    eventos.get(s.gatewayEvent)!.push(s);
  }
  const eventosList = Array.from(eventos.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Automações</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data
              ? `${eventosList.length} eventos · ${data.templates.length} templates`
              : "Carregando..."}
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-all">
          <Plus className="size-4" />
          Novo evento
        </button>
      </div>

      {isLoading ? (
        <div className="card-soft p-8 text-center text-sm text-muted-foreground">Carregando...</div>
      ) : error ? (
        <div className="card-soft p-8 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : "Erro"}
        </div>
      ) : (
        <div className="grid gap-3">
          {eventosList.map(([evt, steps]) => (
            <div key={evt} className="card-soft p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-2xl bg-lime-soft text-forest grid place-items-center">
                    <Workflow className="size-5" />
                  </div>
                  <div>
                    <p className="font-semibold">{evt}</p>
                    <p className="text-xs text-muted-foreground">
                      {steps.length} {steps.length === 1 ? "mensagem" : "mensagens"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid gap-2 pl-13">
                {steps
                  .sort((a, b) => a.ordem - b.ordem)
                  .map((s) => {
                    const tpl = data?.templates.find((t) => t.key === s.templateKey);
                    const minutes = Math.floor(s.delaySeconds / 60);
                    return (
                      <div
                        key={s.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-xl bg-muted/40 text-sm"
                      >
                        <MessageSquare className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate flex-1">{tpl?.nome ?? s.templateKey}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-md tabular-nums ${
                            s.ativo
                              ? "bg-[oklch(0.94_0.07_130)] text-forest"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {minutes < 60
                            ? `${minutes}min`
                            : minutes < 1440
                              ? `${Math.floor(minutes / 60)}h`
                              : `${Math.floor(minutes / 1440)}d`}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
          {eventosList.length === 0 ? (
            <div className="card-soft p-12 text-center">
              <Workflow className="size-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">Nenhuma automação ainda</p>
              <p className="text-sm text-muted-foreground mt-1">
                Crie um evento pra começar a disparar mensagens automáticas.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
