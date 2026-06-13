import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Workflow,
  MessageSquare,
  Trash2,
  Save,
  Clock,
  ToggleRight,
  ToggleLeft,
  RotateCcw,
  Shuffle,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

type Template = { key: string; nome: string; conteudo: string; conteudoDefault: string };
type FlowStep = {
  id: number;
  gatewayEvent: string;
  ordem: number;
  templateKey: string;
  delaySeconds: number;
  ativo: boolean;
  cancelPrevious: boolean;
};

type DelayUnit = "minutes" | "hours" | "days";

function delayToParts(seconds: number): { value: number; unit: DelayUnit } {
  if (seconds === 0) return { value: 0, unit: "minutes" };
  if (seconds % 86400 === 0) return { value: seconds / 86400, unit: "days" };
  if (seconds % 3600 === 0) return { value: seconds / 3600, unit: "hours" };
  return { value: Math.round(seconds / 60), unit: "minutes" };
}

function partsToSeconds(value: number, unit: DelayUnit): number {
  const m: Record<DelayUnit, number> = { minutes: 60, hours: 3600, days: 86400 };
  return Math.floor(value * m[unit]);
}

function delayLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// Variações de um template são keys no formato {base}_v{N} (ex: boas_vindas_compra_v2).
// O scheduler (server/lib/flows.ts) sorteia entre a base e as variações a cada envio.
function variantsOf(baseKey: string, templates: Template[]): Template[] {
  const escaped = baseKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}_v(\\d+)$`);
  return templates
    .filter((t) => re.test(t.key))
    .sort(
      (a, b) =>
        Number(/_v(\d+)$/.exec(a.key)?.[1] ?? 0) -
        Number(/_v(\d+)$/.exec(b.key)?.[1] ?? 0),
    );
}

export function AutomacoesPage() {
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["automacoes", "templates"],
    queryFn: () =>
      api.get<{ templates: Template[]; flowSteps: FlowStep[] }>(
        "/api/automacoes/templates",
      ),
  });

  const eventos = useMemo(() => {
    const map = new Map<string, FlowStep[]>();
    for (const s of data?.flowSteps ?? []) {
      if (!map.has(s.gatewayEvent)) map.set(s.gatewayEvent, []);
      map.get(s.gatewayEvent)!.push(s);
    }
    return Array.from(map.entries())
      .map(([nome, steps]) => ({
        nome,
        steps: steps.sort((a, b) => a.ordem - b.ordem),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [data]);

  // Auto-seleciona o primeiro evento se nada estiver selecionado
  useEffect(() => {
    if (!selectedEvent && eventos.length > 0) {
      setSelectedEvent(eventos[0].nome);
    }
  }, [selectedEvent, eventos]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["automacoes"] });

  const detail = eventos.find((e) => e.nome === selectedEvent) ?? null;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Automações</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data
              ? `${eventos.length} eventos · ${data.templates.length} templates`
              : "Carregando..."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewEvent(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-all"
        >
          <Plus className="size-4" />
          Novo evento
        </button>
      </header>

      {isLoading ? (
        <div className="card-soft p-8 text-center text-sm text-muted-foreground">
          Carregando...
        </div>
      ) : error ? (
        <div className="card-soft p-8 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : "Erro"}
        </div>
      ) : eventos.length === 0 && !showNewEvent ? (
        <div className="card-soft p-12 text-center">
          <Workflow className="size-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">Nenhuma automação ainda</p>
          <p className="text-sm text-muted-foreground mt-1">
            Crie um evento pra começar a disparar mensagens automáticas.
          </p>
          <button
            type="button"
            onClick={() => setShowNewEvent(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-all"
          >
            <Plus className="size-4" /> Criar primeiro evento
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 items-start">
          {/* Lista de eventos */}
          <aside className="card-soft p-2 sticky top-4">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Eventos
            </div>
            <ul className="space-y-1">
              {eventos.map((e) => (
                <li key={e.nome}>
                  <button
                    type="button"
                    onClick={() => setSelectedEvent(e.nome)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                      selectedEvent === e.nome
                        ? "bg-secondary"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div
                      className={`size-9 rounded-xl grid place-items-center shrink-0 ${
                        selectedEvent === e.nome
                          ? "bg-forest text-[oklch(0.86_0.18_130)]"
                          : "bg-lime-soft text-forest"
                      }`}
                    >
                      <Workflow className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{e.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.steps.length} {e.steps.length === 1 ? "msg" : "msgs"}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Detail */}
          <main className="space-y-3">
            {showNewEvent ? (
              <NewEventForm
                templates={data?.templates ?? []}
                onClose={() => setShowNewEvent(false)}
                onCreated={(eventName) => {
                  setShowNewEvent(false);
                  setSelectedEvent(eventName);
                  invalidate();
                }}
              />
            ) : null}

            {detail ? (
              <EventDetail
                event={detail.nome}
                steps={detail.steps}
                templates={data?.templates ?? []}
                onChange={invalidate}
                onDeleteEvent={() => {
                  setSelectedEvent(null);
                  invalidate();
                }}
              />
            ) : null}
          </main>
        </div>
      )}
    </div>
  );
}

/* ============================================================ */
/* Event detail — mensagens editáveis                           */
/* ============================================================ */
function EventDetail({
  event,
  steps,
  templates,
  onChange,
  onDeleteEvent,
}: {
  event: string;
  steps: FlowStep[];
  templates: Template[];
  onChange: () => void;
  onDeleteEvent: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);

  const deleteEvent = useMutation({
    mutationFn: () => api.delete(`/api/automacoes/eventos/${event}`),
    onSuccess: () => {
      toast.success(`Evento "${event}" apagado`);
      onDeleteEvent();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <div className="card-soft p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-border">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight">{event}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {steps.length} {steps.length === 1 ? "mensagem" : "mensagens"} no fluxo
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Apagar evento "${event}" e todas as mensagens?`)) {
              deleteEvent.mutate();
            }
          }}
          disabled={deleteEvent.isPending}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-destructive hover:bg-[oklch(0.95_0.04_25)] transition-colors disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
          Apagar evento
        </button>
      </div>

      <div className="space-y-3">
        {steps.map((step) => (
          <MessageEditor
            key={step.id}
            step={step}
            template={templates.find((t) => t.key === step.templateKey)}
            variants={variantsOf(step.templateKey, templates)}
            onChange={onChange}
          />
        ))}

        {showAdd ? (
          <AddMessageForm
            event={event}
            onClose={() => setShowAdd(false)}
            onCreated={() => {
              setShowAdd(false);
              onChange();
            }}
          />
        ) : steps.length < 5 ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-border text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground hover:bg-muted/30 transition-all"
          >
            <Plus className="size-4" />
            Adicionar mensagem
          </button>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-2">
            Limite de 5 mensagens por evento atingido.
          </p>
        )}
      </div>
    </div>
  );
}

/* ============================================================ */
/* Editor de uma mensagem (textarea + delay + ativo + actions)   */
/* ============================================================ */
function MessageEditor({
  step,
  template,
  variants,
  onChange,
}: {
  step: FlowStep;
  template: Template | undefined;
  variants: Template[];
  onChange: () => void;
}) {
  const initial = delayToParts(step.delaySeconds);
  const [delayValue, setDelayValue] = useState(initial.value);
  const [delayUnit, setDelayUnit] = useState<DelayUnit>(initial.unit);
  const [ativo, setAtivo] = useState(step.ativo);
  const [cancelPrevious, setCancelPrevious] = useState(step.cancelPrevious);

  const stepDirty =
    delayValue !== initial.value ||
    delayUnit !== initial.unit ||
    ativo !== step.ativo ||
    cancelPrevious !== step.cancelPrevious;

  const saveStep = useMutation({
    mutationFn: () =>
      api.patch(`/api/automacoes/flow-steps/${step.id}`, {
        delayValue,
        delayUnit,
        ativo,
        cancelPrevious,
      }),
    onSuccess: () => {
      toast.success("Configuração salva");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const deleteStep = useMutation({
    mutationFn: () => api.delete(`/api/automacoes/flow-steps/${step.id}`),
    onSuccess: () => {
      toast.success("Mensagem apagada");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const createVariation = useMutation({
    mutationFn: () =>
      api.post(`/api/automacoes/templates/${step.templateKey}/variacao`),
    onSuccess: () => {
      toast.success("Versão criada");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  // Todas as versões da mensagem: a base + as variações. Pesam igual no sorteio.
  const versoes = [template, ...variants].filter(Boolean) as Template[];

  return (
    <div className="rounded-2xl border border-border bg-background/40 p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="size-8 rounded-lg bg-lime-soft text-forest grid place-items-center shrink-0">
          <MessageSquare className="size-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {template?.nome ?? step.templateKey}
          </p>
          <p className="text-xs text-muted-foreground">
            {step.templateKey}
            {ativo ? "" : " · inativo"}
          </p>
        </div>
        <span
          className={`text-xs font-medium px-2.5 py-1 rounded-lg tabular-nums ${
            ativo
              ? "bg-[oklch(0.94_0.07_130)] text-forest"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {delayLabel(step.delaySeconds)}
        </span>
        <button
          type="button"
          onClick={() => {
            if (confirm("Apagar essa mensagem e todas as suas versões?"))
              deleteStep.mutate();
          }}
          disabled={deleteStep.isPending}
          title="Apagar mensagem"
          className="size-8 rounded-lg grid place-items-center text-destructive hover:bg-[oklch(0.95_0.04_25)] transition-colors disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Configuração de disparo — vale pra todas as versões */}
      <div className="flex items-center gap-3 flex-wrap rounded-xl bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <Clock className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Delay</span>
          <input
            type="number"
            min={0}
            value={delayValue}
            onChange={(e) => setDelayValue(Number(e.target.value))}
            className="w-16 px-2 py-1 rounded-lg bg-card border border-input text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring/30"
          />
          <select
            value={delayUnit}
            onChange={(e) => setDelayUnit(e.target.value as DelayUnit)}
            className="px-2 py-1 rounded-lg bg-card border border-input text-sm focus:outline-none focus:ring-1 focus:ring-ring/30"
          >
            <option value="minutes">min</option>
            <option value="hours">h</option>
            <option value="days">d</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => setAtivo((s) => !s)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            ativo
              ? "bg-[oklch(0.94_0.07_130)] text-forest"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {ativo ? <ToggleRight className="size-3.5" /> : <ToggleLeft className="size-3.5" />}
          {ativo ? "Ativo" : "Inativo"}
        </button>

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={cancelPrevious}
            onChange={(e) => setCancelPrevious(e.target.checked)}
            className="accent-primary"
          />
          Cancela anteriores
        </label>

        <button
          type="button"
          onClick={() => saveStep.mutate()}
          disabled={!stepDirty || saveStep.isPending}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
        >
          <Save className="size-3.5" />
          {saveStep.isPending ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {/* Versões — todas com peso igual; o sistema sorteia uma a cada envio */}
      <div className="pt-3 border-t border-border/50 space-y-2">
        <div className="flex items-center gap-1.5">
          <Shuffle className="size-3 text-muted-foreground" />
          <p className="text-xs font-medium text-muted-foreground">
            Versões ({versoes.length})
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {versoes.length > 1
            ? "Todas têm o mesmo peso — o sistema sorteia uma a cada envio, pra não repetir a mesma mensagem e reduzir risco de bloqueio no WhatsApp."
            : "Crie versões alternativas pra o sistema sortear uma a cada envio e reduzir risco de bloqueio no WhatsApp."}
        </p>
        {versoes.map((v, i) => (
          <VariationEditor
            key={v.key}
            variant={v}
            label={`Versão ${i + 1}`}
            canDelete={i > 0}
            onChange={onChange}
          />
        ))}
        {versoes.length < 6 ? (
          <button
            type="button"
            onClick={() => createVariation.mutate()}
            disabled={createVariation.isPending}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-border text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground hover:bg-muted/30 transition-all disabled:opacity-50"
          >
            <Plus className="size-3.5" />
            {createVariation.isPending ? "Criando..." : "Criar versão"}
          </button>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-1">
            Limite de 6 versões por mensagem.
          </p>
        )}
      </div>
    </div>
  );
}

/* ============================================================ */
/* Editor de uma variação (textarea + salvar/apagar/reverter)    */
/* ============================================================ */
function VariationEditor({
  variant,
  label,
  canDelete,
  onChange,
}: {
  variant: Template;
  label: string;
  canDelete: boolean;
  onChange: () => void;
}) {
  const [conteudo, setConteudo] = useState(variant.conteudo);

  useEffect(() => {
    setConteudo(variant.conteudo);
  }, [variant.conteudo]);

  const dirty = conteudo !== variant.conteudo;

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/automacoes/templates/${variant.key}`, { conteudo }),
    onSuccess: () => {
      toast.success("Versão salva");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/automacoes/templates/${variant.key}`),
    onSuccess: () => {
      toast.success("Versão apagada");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const revert = useMutation({
    mutationFn: () =>
      api.post(`/api/automacoes/templates/${variant.key}/revert`),
    onSuccess: () => {
      toast.success("Versão revertida pro padrão");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const busy = save.isPending || remove.isPending || revert.isPending;

  return (
    <div className="rounded-2xl border border-border bg-background/40 p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="size-8 rounded-lg bg-lime-soft text-forest grid place-items-center shrink-0">
          <Shuffle className="size-3.5" />
        </div>
        <p className="flex-1 min-w-0 text-sm font-medium truncate">{label}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (
                variant.conteudo !== variant.conteudoDefault &&
                confirm("Reverter essa variação pro padrão?")
              ) {
                revert.mutate();
              }
            }}
            disabled={variant.conteudo === variant.conteudoDefault || busy}
            title="Reverter pro padrão"
            className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="size-3.5" />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={() => {
                if (confirm("Apagar essa versão?")) remove.mutate();
              }}
              disabled={busy}
              title="Apagar versão"
              className="size-8 rounded-lg grid place-items-center text-destructive hover:bg-[oklch(0.95_0.04_25)] transition-colors disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!dirty || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            <Save className="size-3.5" />
            {save.isPending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
      <textarea
        value={conteudo}
        onChange={(e) => setConteudo(e.target.value)}
        rows={4}
        placeholder="Conteúdo da variação..."
        className="w-full px-3 py-2.5 rounded-xl bg-card border border-input text-sm font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50"
      />
    </div>
  );
}

/* ============================================================ */
/* Adicionar nova mensagem dentro de um evento existente         */
/* ============================================================ */
function AddMessageForm({
  event,
  onClose,
  onCreated,
}: {
  event: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [delayValue, setDelayValue] = useState(1);
  const [delayUnit, setDelayUnit] = useState<DelayUnit>("hours");

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/automacoes/messages", {
        gatewayEvent: event,
        nome,
        conteudo,
        delayValue,
        delayUnit,
      }),
    onSuccess: () => {
      toast.success("Mensagem criada");
      onCreated();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      className="rounded-2xl border-2 border-dashed border-foreground/20 p-4 space-y-3 bg-background/30"
    >
      <p className="text-sm font-medium">Nova mensagem em {event}</p>
      <input
        type="text"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nome da mensagem (ex: Lembrete 1)"
        required
        className="w-full px-3 py-2 rounded-xl bg-card border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
      <textarea
        value={conteudo}
        onChange={(e) => setConteudo(e.target.value)}
        rows={3}
        placeholder="Conteúdo (suporta {primeiroNome}, {nome}, {valor}, {link_pix}, {link_checkout})"
        required
        className="w-full px-3 py-2 rounded-xl bg-card border border-input text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Delay</span>
          <input
            type="number"
            min={0}
            value={delayValue}
            onChange={(e) => setDelayValue(Number(e.target.value))}
            className="w-16 px-2 py-1 rounded-lg bg-card border border-input text-sm tabular-nums"
          />
          <select
            value={delayUnit}
            onChange={(e) => setDelayUnit(e.target.value as DelayUnit)}
            className="px-2 py-1 rounded-lg bg-card border border-input text-sm"
          >
            <option value="minutes">min</option>
            <option value="hours">h</option>
            <option value="days">d</option>
          </select>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            {create.isPending ? "Criando..." : "Criar"}
          </button>
        </div>
      </div>
    </form>
  );
}

/* ============================================================ */
/* Criar novo evento (= primeira mensagem em evento novo)        */
/* ============================================================ */
function NewEventForm({
  onClose,
  onCreated,
}: {
  templates: Template[];
  onClose: () => void;
  onCreated: (eventName: string) => void;
}) {
  const [eventName, setEventName] = useState("");
  const [nome, setNome] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [delayValue, setDelayValue] = useState(1);
  const [delayUnit, setDelayUnit] = useState<DelayUnit>("hours");

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/automacoes/messages", {
        gatewayEvent: eventName.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
        nome,
        conteudo,
        delayValue,
        delayUnit,
      }),
    onSuccess: (_, _vars) => {
      toast.success("Evento criado");
      onCreated(eventName.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      className="card-soft p-6 space-y-4"
    >
      <div>
        <h2 className="text-lg font-bold tracking-tight">Novo evento</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Cria um novo gatilho com a primeira mensagem do fluxo.
        </p>
      </div>
      <div className="grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground/70 uppercase tracking-wider">
            Nome do evento
          </span>
          <input
            type="text"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="ex: pix_expirado"
            required
            className="px-3 py-2.5 rounded-xl bg-input/50 border border-border focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
          <span className="text-xs text-muted-foreground">
            Vai ser normalizado pra snake_case minúsculo.
          </span>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground/70 uppercase tracking-wider">
            Nome da primeira mensagem
          </span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex: Lembrete inicial"
            required
            className="px-3 py-2.5 rounded-xl bg-input/50 border border-border focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground/70 uppercase tracking-wider">
            Conteúdo
          </span>
          <textarea
            value={conteudo}
            onChange={(e) => setConteudo(e.target.value)}
            rows={4}
            placeholder="Suporta {primeiroNome}, {nome}, {valor}, {link_pix}, {link_checkout}"
            required
            className="px-3 py-2.5 rounded-xl bg-input/50 border border-border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </label>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">Delay</span>
          <input
            type="number"
            min={0}
            value={delayValue}
            onChange={(e) => setDelayValue(Number(e.target.value))}
            className="w-20 px-3 py-2 rounded-xl bg-input/50 border border-border tabular-nums"
          />
          <select
            value={delayUnit}
            onChange={(e) => setDelayUnit(e.target.value as DelayUnit)}
            className="px-3 py-2 rounded-xl bg-input/50 border border-border"
          >
            <option value="minutes">minutos</option>
            <option value="hours">horas</option>
            <option value="days">dias</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3 justify-end pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={create.isPending}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {create.isPending ? "Criando..." : "Criar evento"}
        </button>
      </div>
    </form>
  );
}
