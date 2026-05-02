"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Save,
  RotateCcw,
  Eye,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Plus,
  X,
  Info,
  Check,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  updateTemplateAction,
  revertTemplateAction,
  updateFlowStepAction,
  createMessageInEventAction,
  deleteMessageAction,
  deleteEventAction,
} from "./actions";

export type MessageRow = {
  stepId: number;
  ordem: number;
  templateKey: string;
  templateNome: string;
  conteudo: string;
  conteudoDefault: string;
  placeholders: string[];
  delaySeconds: number;
  ativo: boolean;
  cancelPrevious: boolean;
};

export type EventGroup = {
  key: string;
  nome: string;
  descricao: string;
  emoji: string;
  messages: MessageRow[];
};

export type EventOption = {
  value: string;
  label: string;
  nome: string;
  descricao: string;
  emoji: string;
};

type Props = {
  events: EventGroup[];
  allEventOptions: EventOption[];
};

const SAMPLES: Record<string, string> = {
  nome: "Maria Silva",
  primeiroNome: "Maria",
  valor: "R$ 47,00",
  link_pix: "https://pix.exemplo.com/abc",
  link_checkout: "https://checkout.exemplo.com/abc",
  link_boleto: "https://boleto.exemplo.com/abc",
  change_card_url: "https://dash.ticto.com.br/change-card/123",
  hosted_invoice_url: "https://invoice.stripe.com/abc",
  checkout_url: "https://checkout.stripe.com/abc",
};

function applyPreview(raw: string): string {
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => SAMPLES[k] ?? `{{${k}}}`);
}

type DelayUnit = "seconds" | "minutes" | "hours" | "days";

function secondsToBest(s: number): { value: number; unit: DelayUnit } {
  if (s === 0) return { value: 0, unit: "seconds" };
  if (s % 86400 === 0) return { value: s / 86400, unit: "days" };
  if (s % 3600 === 0) return { value: s / 3600, unit: "hours" };
  if (s % 60 === 0) return { value: s / 60, unit: "minutes" };
  return { value: s, unit: "seconds" };
}

const UNIT_LABEL: Record<DelayUnit, string> = {
  seconds: "seg",
  minutes: "min",
  hours: "h",
  days: "dias",
};

function delayShort(seconds: number): string {
  if (seconds === 0) return "imediato";
  if (seconds % 86400 === 0) return `+${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `+${seconds / 3600}h`;
  if (seconds % 60 === 0) return `+${seconds / 60}min`;
  return `+${seconds}s`;
}

export function TemplatesMasterDetail({ events, allEventOptions }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    events[0]?.key ?? null,
  );
  const [showAdd, setShowAdd] = useState(false);

  const selected = events.find((e) => e.key === selectedKey) ?? null;
  const cadastradosKeys = new Set(events.map((e) => e.key));
  const disponiveis = allEventOptions.filter((o) => !cadastradosKeys.has(o.value));

  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-4">
      <aside
        className={cn(
          "rounded-2xl bg-card border-0 shadow-sm overflow-hidden h-fit",
          selected && !showAdd ? "hidden lg:block" : "block",
        )}
      >
        <div className="px-3 pt-3">
          <Button
            onClick={() => {
              setShowAdd(true);
              setSelectedKey(null);
            }}
            disabled={disponiveis.length === 0}
            variant="outline"
            size="sm"
            className="w-full gap-1.5 h-8"
            title={
              disponiveis.length === 0
                ? "Todos os eventos já estão cadastrados"
                : "Adicionar um novo evento"
            }
          >
            <Plus className="size-3.5" />
            {disponiveis.length === 0 ? "Todos os eventos cadastrados" : "Adicionar evento"}
          </Button>
        </div>
        <ul className="divide-y mt-2">
          {events.map((ev) => {
            const isActive = ev.key === selectedKey && !showAdd;
            return (
              <li key={ev.key}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedKey(ev.key);
                    setShowAdd(false);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 flex items-start gap-2 transition-colors",
                    isActive
                      ? "bg-[oklch(0.86_0.22_130)]/10 border-l-2 border-[oklch(0.86_0.22_130)]"
                      : "border-l-2 border-transparent hover:bg-muted/40",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-sm flex items-center gap-1.5 truncate">
                        <span className="text-base">{ev.emoji}</span>
                        <span className="truncate">{ev.nome}</span>
                      </span>
                      <ChevronRight className="size-3.5 text-muted-foreground shrink-0 lg:hidden" />
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      <span className="text-[10px] tabular-nums px-1.5 py-0 rounded-md bg-muted text-muted-foreground">
                        {ev.messages.length}{" "}
                        {ev.messages.length === 1 ? "mensagem" : "mensagens"}
                      </span>
                      {ev.messages.slice(0, 3).map((m, i) => (
                        <span
                          key={i}
                          className="text-[10px] tabular-nums px-1.5 py-0 rounded-md bg-muted/60 text-muted-foreground"
                        >
                          {delayShort(m.delaySeconds)}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className={cn(selected || showAdd ? "block" : "hidden lg:block")}>
        {showAdd ? (
          <AddEventForm
            disponiveis={disponiveis}
            onCancel={() => setShowAdd(false)}
            onCreated={(eventKey) => {
              setShowAdd(false);
              setSelectedKey(eventKey);
            }}
          />
        ) : selected ? (
          <EventDetail
            key={selected.key}
            event={selected}
            onBack={() => setSelectedKey(null)}
            onDeleted={() => setSelectedKey(null)}
          />
        ) : (
          <div className="rounded-2xl bg-card border-0 shadow-sm p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Selecione um evento ao lado pra ver e editar suas mensagens.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function EventDetail({
  event,
  onBack,
  onDeleted,
}: {
  event: EventGroup;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [showAddMsg, setShowAddMsg] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDeleteEvent() {
    if (
      !confirm(
        `Apagar o evento "${event.nome}" e todas as suas ${event.messages.length} mensagens? Essa ação não pode ser desfeita.`,
      )
    )
      return;
    const fd = new FormData();
    fd.set("gatewayEvent", event.key);
    startTransition(async () => {
      try {
        await deleteEventAction(fd);
        toast.success(`Evento "${event.nome}" apagado`);
        onDeleted();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao apagar");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card border-0 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-2 lg:hidden">
          <Button onClick={onBack} variant="ghost" size="sm" className="h-8 px-2 -ml-2">
            <ChevronLeft className="size-4" /> Voltar
          </Button>
        </div>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span>{event.emoji}</span>
              {event.nome}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">{event.descricao}</p>
          </div>
          <Badge variant="secondary" className="text-[10px] tabular-nums px-1.5 py-0 shrink-0">
            {event.messages.length}{" "}
            {event.messages.length === 1 ? "mensagem" : "mensagens"}
          </Badge>
        </div>
      </div>

      {event.messages.length > 0 ? (
        event.messages.map((msg) => (
          <MessageEditor key={msg.stepId} message={msg} eventKey={event.key} />
        ))
      ) : (
        <div className="rounded-2xl bg-card border-0 shadow-sm p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Esse evento ainda não tem mensagens. Adicione a primeira abaixo.
          </p>
        </div>
      )}

      {event.messages.length < 5 ? (
        <>
          {showAddMsg ? (
            <AddMessageForm
              gatewayEvent={event.key}
              ordemSugerida={event.messages.length + 1}
              onCancel={() => setShowAddMsg(false)}
              onCreated={() => setShowAddMsg(false)}
            />
          ) : (
            <Button
              onClick={() => setShowAddMsg(true)}
              variant="outline"
              className="w-full gap-1.5 h-12 border-dashed"
            >
              <Plus className="size-4" /> Adicionar mensagem
            </Button>
          )}
        </>
      ) : (
        <p className="text-xs text-center text-muted-foreground italic">
          Limite de 5 mensagens por evento atingido.
        </p>
      )}

      <div className="pt-4 border-t flex justify-end">
        <Button
          onClick={handleDeleteEvent}
          disabled={pending}
          variant="ghost"
          className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="size-4" /> Apagar evento inteiro
        </Button>
      </div>
    </div>
  );
}

function MessageEditor({
  message,
  eventKey,
}: {
  message: MessageRow;
  eventKey: string;
}) {
  const [conteudo, setConteudo] = useState(message.conteudo);
  const [showPreview, setShowPreview] = useState(false);
  const initialDelay = secondsToBest(message.delaySeconds);
  const [delayValue, setDelayValue] = useState(String(initialDelay.value));
  const [delayUnit, setDelayUnit] = useState<DelayUnit>(initialDelay.unit);
  const [ativo, setAtivo] = useState(message.ativo);
  const [cancelPrevious, setCancelPrevious] = useState(message.cancelPrevious);
  const [pending, startTransition] = useTransition();

  const isContentDirty = conteudo !== message.conteudo;
  const isTimingDirty =
    delayValue !== String(initialDelay.value) ||
    delayUnit !== initialDelay.unit ||
    ativo !== message.ativo ||
    cancelPrevious !== message.cancelPrevious;
  const isCustom = message.conteudo !== message.conteudoDefault;

  function insertPlaceholder(name: string) {
    setConteudo((c) => c + `{{${name}}}`);
  }

  function handleSaveContent() {
    const fd = new FormData();
    fd.set("key", message.templateKey);
    fd.set("conteudo", conteudo);
    startTransition(async () => {
      try {
        await updateTemplateAction(fd);
        toast.success("Texto salvo");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  function handleSaveTiming() {
    const fd = new FormData();
    fd.set("id", String(message.stepId));
    fd.set("delayValue", delayValue);
    fd.set("delayUnit", delayUnit);
    if (ativo) fd.set("ativo", "on");
    if (cancelPrevious) fd.set("cancelPrevious", "on");
    startTransition(async () => {
      try {
        await updateFlowStepAction(fd);
        toast.success("Tempo atualizado");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  function handleRevert() {
    const fd = new FormData();
    fd.set("key", message.templateKey);
    startTransition(async () => {
      try {
        await revertTemplateAction(fd);
        setConteudo(message.conteudoDefault);
        toast.success("Texto restaurado");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Apagar mensagem ${message.ordem}?`)) return;
    const fd = new FormData();
    fd.set("stepId", String(message.stepId));
    startTransition(async () => {
      try {
        await deleteMessageAction(fd);
        toast.success("Mensagem apagada");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  return (
    <div
      className={cn(
        "rounded-2xl bg-card border-0 shadow-sm p-5 space-y-4",
        !ativo && "opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-full bg-[oklch(0.86_0.22_130)] grid place-items-center text-xs font-bold text-[oklch(0.18_0.05_150)]">
            {message.ordem}
          </div>
          <h3 className="font-semibold text-base">{message.templateNome}</h3>
          {isCustom ? (
            <Badge className="text-[10px] px-1.5 py-0 bg-[oklch(0.86_0.22_130)] text-[oklch(0.18_0.05_150)] hover:bg-[oklch(0.86_0.22_130)]">
              <Pencil className="size-2.5 mr-0.5" /> editado
            </Badge>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="size-8 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          title="Apagar mensagem"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {/* TIMING ROW */}
      <div className="rounded-xl border bg-muted/20 p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground shrink-0">Disparar em</span>
        <Input
          type="number"
          min={0}
          value={delayValue}
          onChange={(e) => setDelayValue(e.target.value)}
          className="w-16 h-7 text-xs px-1.5"
          disabled={pending}
        />
        <Select
          value={delayUnit}
          onValueChange={(v) => setDelayUnit((v ?? "hours") as DelayUnit)}
          disabled={pending}
        >
          <SelectTrigger className="w-[80px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="seconds">{UNIT_LABEL.seconds}</SelectItem>
            <SelectItem value="minutes">{UNIT_LABEL.minutes}</SelectItem>
            <SelectItem value="hours">{UNIT_LABEL.hours}</SelectItem>
            <SelectItem value="days">{UNIT_LABEL.days}</SelectItem>
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => setAtivo((s) => !s)}
          disabled={pending}
          className={cn(
            "flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md transition-colors",
            ativo
              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
              : "bg-muted text-muted-foreground hover:bg-muted/70",
          )}
        >
          {ativo ? <Check className="size-3" /> : <Ban className="size-3" />}
          {ativo ? "ativa" : "inativa"}
        </button>
        {message.cancelPrevious || cancelPrevious ? (
          <button
            type="button"
            onClick={() => setCancelPrevious((s) => !s)}
            disabled={pending}
            className={cn(
              "text-[10px] font-medium px-2 py-1 rounded-md transition-colors",
              cancelPrevious
                ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
            title="Cancela mensagens pendentes deste lead (ex: cliente pagou — para de cobrar)"
          >
            cancela anteriores
          </button>
        ) : null}
        <Button
          onClick={handleSaveTiming}
          disabled={!isTimingDirty || pending}
          size="sm"
          className="h-7 px-2 text-xs gap-1 ml-auto bg-[oklch(0.86_0.22_130)] hover:bg-[oklch(0.82_0.22_130)] text-[oklch(0.18_0.05_150)] disabled:bg-muted disabled:text-muted-foreground"
        >
          <Save className="size-3" /> Salvar tempo
        </Button>
      </div>

      {/* PLACEHOLDERS */}
      {message.placeholders.length > 0 && !showPreview ? (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">
            Variáveis (clique pra inserir)
          </p>
          <div className="flex flex-wrap gap-1">
            {message.placeholders.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => insertPlaceholder(p)}
                disabled={pending}
                className="text-[10px] px-1.5 py-0.5 rounded-md border bg-muted/40 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed font-mono text-muted-foreground hover:text-foreground transition-colors"
              >
                {`{{${p}}}`}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* CONTEÚDO */}
      {showPreview ? (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm whitespace-pre-wrap min-h-[180px] max-h-[360px] overflow-y-auto">
          {applyPreview(conteudo)}
        </div>
      ) : (
        <Textarea
          value={conteudo}
          onChange={(e) => setConteudo(e.target.value)}
          className="font-mono text-sm leading-relaxed min-h-[180px] max-h-[360px] resize-y"
          disabled={pending}
          maxLength={4000}
        />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          onClick={handleSaveContent}
          disabled={!isContentDirty || pending}
          size="sm"
          className="gap-1.5 bg-[oklch(0.86_0.22_130)] hover:bg-[oklch(0.82_0.22_130)] text-[oklch(0.18_0.05_150)] disabled:bg-muted disabled:text-muted-foreground"
        >
          <Save className="size-3.5" /> Salvar texto
        </Button>
        <Button
          onClick={() => setShowPreview((s) => !s)}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          <Eye className="size-3.5" /> {showPreview ? "Editar" : "Preview"}
        </Button>
        {isCustom ? (
          <Button
            onClick={handleRevert}
            disabled={pending}
            variant="ghost"
            size="sm"
            className="gap-1.5 ml-auto text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5" /> Reverter padrão
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AddMessageForm({
  gatewayEvent,
  ordemSugerida,
  onCancel,
  onCreated,
}: {
  gatewayEvent: string;
  ordemSugerida: number;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState(`Mensagem ${ordemSugerida}`);
  const [conteudo, setConteudo] = useState(
    "Oi {{primeiroNome}}!\n\n[escreva aqui sua mensagem]",
  );
  const [delayValue, setDelayValue] = useState("1");
  const [delayUnit, setDelayUnit] = useState<DelayUnit>("hours");
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    if (!nome.trim()) return toast.error("Dá um nome pra mensagem");
    if (!conteudo.trim()) return toast.error("O conteúdo não pode ficar vazio");
    const fd = new FormData();
    fd.set("gatewayEvent", gatewayEvent);
    fd.set("nome", nome);
    fd.set("conteudo", conteudo);
    fd.set("delayValue", delayValue);
    fd.set("delayUnit", delayUnit);
    startTransition(async () => {
      try {
        await createMessageInEventAction(fd);
        toast.success("Mensagem adicionada");
        onCreated();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  return (
    <div className="rounded-2xl bg-card border-2 border-dashed border-[oklch(0.86_0.22_130)] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Nova mensagem #{ordemSugerida}</h3>
        <Button onClick={onCancel} variant="ghost" size="sm" className="size-7 p-0">
          <X className="size-4" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Nome</Label>
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: Lembrete suave"
          maxLength={80}
          disabled={pending}
        />
      </div>

      <div className="rounded-xl border bg-muted/20 p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Disparar em</span>
        <Input
          type="number"
          min={0}
          value={delayValue}
          onChange={(e) => setDelayValue(e.target.value)}
          className="w-16 h-7 text-xs px-1.5"
          disabled={pending}
        />
        <Select
          value={delayUnit}
          onValueChange={(v) => setDelayUnit((v ?? "hours") as DelayUnit)}
          disabled={pending}
        >
          <SelectTrigger className="w-[80px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="seconds">{UNIT_LABEL.seconds}</SelectItem>
            <SelectItem value="minutes">{UNIT_LABEL.minutes}</SelectItem>
            <SelectItem value="hours">{UNIT_LABEL.hours}</SelectItem>
            <SelectItem value="days">{UNIT_LABEL.days}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1">
          <Info className="size-3" /> contado a partir do evento
        </span>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Conteúdo</Label>
        <Textarea
          value={conteudo}
          onChange={(e) => setConteudo(e.target.value)}
          className="font-mono text-sm leading-relaxed min-h-[160px]"
          disabled={pending}
          maxLength={4000}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={handleCreate}
          disabled={pending || !nome.trim() || !conteudo.trim()}
          className="gap-1.5 bg-[oklch(0.86_0.22_130)] hover:bg-[oklch(0.82_0.22_130)] text-[oklch(0.18_0.05_150)]"
        >
          <Plus className="size-4" />
          {pending ? "Adicionando..." : "Adicionar"}
        </Button>
        <Button onClick={onCancel} disabled={pending} variant="ghost">
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function AddEventForm({
  disponiveis,
  onCancel,
  onCreated,
}: {
  disponiveis: EventOption[];
  onCancel: () => void;
  onCreated: (eventKey: string) => void;
}) {
  const [eventKey, setEventKey] = useState<string>(disponiveis[0]?.value ?? "");
  const [nome, setNome] = useState("Mensagem 1");
  const [conteudo, setConteudo] = useState(
    "Oi {{primeiroNome}}!\n\n[escreva aqui sua mensagem]",
  );
  const [delayValue, setDelayValue] = useState("1");
  const [delayUnit, setDelayUnit] = useState<DelayUnit>("hours");
  const [pending, startTransition] = useTransition();

  const selectedOption = disponiveis.find((d) => d.value === eventKey);

  function handleCreate() {
    if (!eventKey) return toast.error("Escolha o evento");
    if (!nome.trim()) return toast.error("Dá um nome pra primeira mensagem");
    if (!conteudo.trim()) return toast.error("O conteúdo não pode ficar vazio");

    const fd = new FormData();
    fd.set("gatewayEvent", eventKey);
    fd.set("nome", nome);
    fd.set("conteudo", conteudo);
    fd.set("delayValue", delayValue);
    fd.set("delayUnit", delayUnit);
    startTransition(async () => {
      try {
        await createMessageInEventAction(fd);
        toast.success(`Evento criado com a primeira mensagem`);
        onCreated(eventKey);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  return (
    <div className="rounded-2xl bg-card border-0 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Novo evento</h3>
        <Button onClick={onCancel} variant="ghost" size="sm">
          <X className="size-4" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">
          Quando disparar <span className="text-destructive">*</span>
        </Label>
        <Select
          value={eventKey}
          onValueChange={(v) => setEventKey(v ?? "")}
          disabled={pending}
        >
          <SelectTrigger>
            <SelectValue placeholder="Escolha o evento..." />
          </SelectTrigger>
          <SelectContent>
            {disponiveis.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedOption ? (
          <p className="text-[11px] text-muted-foreground">{selectedOption.descricao}</p>
        ) : null}
      </div>

      <div className="border-t pt-4">
        <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
          Primeira mensagem do fluxo
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Lembrete suave"
              maxLength={80}
              disabled={pending}
            />
          </div>

          <div className="rounded-xl border bg-muted/20 p-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Disparar em</span>
            <Input
              type="number"
              min={0}
              value={delayValue}
              onChange={(e) => setDelayValue(e.target.value)}
              className="w-16 h-7 text-xs px-1.5"
              disabled={pending}
            />
            <Select
              value={delayUnit}
              onValueChange={(v) => setDelayUnit((v ?? "hours") as DelayUnit)}
              disabled={pending}
            >
              <SelectTrigger className="w-[80px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seconds">{UNIT_LABEL.seconds}</SelectItem>
                <SelectItem value="minutes">{UNIT_LABEL.minutes}</SelectItem>
                <SelectItem value="hours">{UNIT_LABEL.hours}</SelectItem>
                <SelectItem value="days">{UNIT_LABEL.days}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Conteúdo</Label>
            <Textarea
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
              className="font-mono text-sm leading-relaxed min-h-[160px]"
              disabled={pending}
              maxLength={4000}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          onClick={handleCreate}
          disabled={
            pending || !eventKey || !nome.trim() || !conteudo.trim()
          }
          className="gap-1.5 bg-[oklch(0.86_0.22_130)] hover:bg-[oklch(0.82_0.22_130)] text-[oklch(0.18_0.05_150)]"
        >
          <Plus className="size-4" /> {pending ? "Criando..." : "Criar evento"}
        </Button>
        <Button onClick={onCancel} disabled={pending} variant="ghost">
          Cancelar
        </Button>
      </div>
    </div>
  );
}
