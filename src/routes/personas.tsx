import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Target,
  Trash2,
  TrendingUp,
  AlertTriangle,
  Pencil,
  Tag,
  Heart,
  Frown,
  Megaphone,
  ChevronRight,
  LayoutGrid,
  Network,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProdutoContext } from "@/contexts/produto-context";
import { PersonaMindMap } from "@/components/persona-mind-map";
import { PersonaAnglesBoard } from "@/components/persona-angles-board";
import type {
  Persona,
  PersonaPrioridade,
  PersonaVolume,
  PersonaRisco,
} from "@shared/types";

const PRIORIDADE_LABEL: Record<PersonaPrioridade, string> = {
  primaria: "Primária",
  secundaria: "Secundária",
  terciaria: "Terciária",
  explorando: "Explorando",
  descartada: "Descartada",
};

const PRIORIDADE_COR: Record<PersonaPrioridade, string> = {
  primaria: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  secundaria: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  terciaria: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  explorando: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  descartada: "bg-red-500/15 text-red-400 border-red-500/30",
};

const VOLUME_LABEL: Record<PersonaVolume, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
  muito_alto: "Muito alto",
};

const RISCO_LABEL: Record<PersonaRisco, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
};

const CORES_PADRAO = [
  "#FF5566",
  "#FFA500",
  "#FFD60A",
  "#34A853",
  "#00A1FF",
  "#7D2AE8",
  "#EC4899",
  "#06B6D4",
];

type FilterPrioridade = PersonaPrioridade | "todas";
type ViewMode = "board" | "cards" | "mapa";

const VIEW_KEY = "personas:view";

export function PersonasPage() {
  const { produtoId } = useProdutoContext();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterPrioridade>("todas");
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "board";
    const v = localStorage.getItem(VIEW_KEY) as ViewMode | null;
    return v && ["board", "cards", "mapa"].includes(v) ? v : "board";
  });
  const [editing, setEditing] = useState<Persona | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: personas = [] } = useQuery({
    queryKey: ["personas", produtoId],
    queryFn: () =>
      api.get<Persona[]>(
        `/api/personas${produtoId ? `?produtoId=${produtoId}` : ""}`,
      ),
    enabled: produtoId != null,
  });

  const filtered = useMemo(() => {
    if (filter === "todas") return personas;
    return personas.filter((p) => p.prioridade === filter);
  }, [personas, filter]);

  const stats = useMemo(() => {
    const total = personas.length;
    const primarias = personas.filter((p) => p.prioridade === "primaria").length;
    const exp = personas.filter((p) => p.prioridade === "explorando").length;
    const cobertura = personas.reduce(
      (acc, p) => acc + (p.pctPublicoAtual ?? 0),
      0,
    );
    return { total, primarias, explorando: exp, cobertura };
  }, [personas]);

  const filterButtons: { value: FilterPrioridade; label: string; count: number }[] = [
    { value: "todas", label: "Todas", count: personas.length },
    {
      value: "primaria",
      label: "Primárias",
      count: personas.filter((p) => p.prioridade === "primaria").length,
    },
    {
      value: "secundaria",
      label: "Secundárias",
      count: personas.filter((p) => p.prioridade === "secundaria").length,
    },
    {
      value: "terciaria",
      label: "Terciárias",
      count: personas.filter((p) => p.prioridade === "terciaria").length,
    },
    {
      value: "explorando",
      label: "Explorando",
      count: personas.filter((p) => p.prioridade === "explorando").length,
    },
    {
      value: "descartada",
      label: "Descartadas",
      count: personas.filter((p) => p.prioridade === "descartada").length,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto w-full">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="size-6 text-foreground/60" />
            Personas
          </h1>
          <p className="text-sm text-foreground/60 mt-1">
            Mapa estratégico dos ICPs do produto. Conecta dor → mensagem → LP →
            criativo.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4 mr-1" /> Nova persona
        </Button>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Total" value={String(stats.total)} icon={Target} />
        <StatTile
          label="Primárias"
          value={String(stats.primarias)}
          icon={TrendingUp}
        />
        <StatTile
          label="Explorando"
          value={String(stats.explorando)}
          icon={AlertTriangle}
        />
        <StatTile
          label="Cobertura mapeada"
          value={`${Math.round(stats.cobertura)}%`}
          icon={Tag}
        />
      </section>

      {/* Toolbar — view toggle + filtros */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {filterButtons.map((b) => (
            <button
              key={b.value}
              onClick={() => setFilter(b.value)}
              className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                filter === b.value
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-foreground/70 border-border hover:bg-muted"
              }`}
            >
              {b.label}
              <span className="ml-1.5 opacity-60">{b.count}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-1 bg-card border border-border rounded-md p-1">
          <button
            onClick={() => {
              setView("board");
              localStorage.setItem(VIEW_KEY, "board");
            }}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
              view === "board"
                ? "bg-muted text-foreground"
                : "text-foreground/60 hover:text-foreground"
            }`}
            title="Board de ângulos"
          >
            <LayoutGrid className="size-3.5" /> Board
          </button>
          <button
            onClick={() => {
              setView("cards");
              localStorage.setItem(VIEW_KEY, "cards");
            }}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
              view === "cards"
                ? "bg-muted text-foreground"
                : "text-foreground/60 hover:text-foreground"
            }`}
            title="Cards de personas"
          >
            <Tag className="size-3.5" /> Cards
          </button>
          <button
            onClick={() => {
              setView("mapa");
              localStorage.setItem(VIEW_KEY, "mapa");
            }}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
              view === "mapa"
                ? "bg-muted text-foreground"
                : "text-foreground/60 hover:text-foreground"
            }`}
            title="Mapa Mental"
          >
            <Network className="size-3.5" /> Mapa
          </button>
        </div>
      </div>

      {/* Conteúdo — board (default), cards ou mapa */}
      {!produtoId ? (
        <EmptyState text="Selecione um produto pra ver suas personas." />
      ) : filtered.length === 0 ? (
        <EmptyState
          text={
            personas.length === 0
              ? "Nenhuma persona criada ainda."
              : "Nenhuma persona nesse filtro."
          }
        />
      ) : view === "board" ? (
        <PersonaAnglesBoard
          personas={filtered}
          produtoId={produtoId ?? null}
          onEditPersona={(p) => setEditing(p)}
        />
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <PersonaCard
              key={p.id}
              persona={p}
              onClick={() => setEditing(p)}
            />
          ))}
        </div>
      ) : (
        <PersonaMindMap
          personas={filtered}
          onSelect={(p) => setEditing(p)}
        />
      )}

      {/* Dialog edicao/criacao */}
      <PersonaDialog
        open={creating}
        onClose={() => setCreating(false)}
        produtoId={produtoId ?? null}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["personas"] });
          setCreating(false);
        }}
      />
      <PersonaDialog
        open={!!editing}
        persona={editing ?? undefined}
        onClose={() => setEditing(null)}
        produtoId={produtoId ?? null}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["personas"] });
          setEditing(null);
        }}
      />
    </div>
  );
}

// =============== Sub-components ===============

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
      <div className="size-10 rounded-md bg-muted grid place-items-center text-foreground/60">
        <Icon className="size-5" />
      </div>
      <div>
        <div className="text-xs text-foreground/60">{label}</div>
        <div className="text-xl font-bold">{value}</div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 p-12 text-center text-sm text-foreground/60">
      {text}
    </div>
  );
}

function PersonaCard({
  persona,
  onClick,
}: {
  persona: Persona;
  onClick: () => void;
}) {
  const cor = persona.cor ?? "#71717a";
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border border-border bg-card hover:border-foreground/30 hover:bg-card/80 transition-colors group overflow-hidden"
    >
      {/* Color stripe */}
      <div className="h-1.5" style={{ background: cor }} />
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-bold text-base">{persona.nome}</div>
            {persona.descricao ? (
              <div className="text-xs text-foreground/60 mt-0.5 line-clamp-1">
                {persona.descricao}
              </div>
            ) : null}
          </div>
          <Badge
            className={`${PRIORIDADE_COR[persona.prioridade]} border text-[10px] uppercase tracking-wide`}
            variant="outline"
          >
            {PRIORIDADE_LABEL[persona.prioridade]}
          </Badge>
        </div>

        {persona.dor ? (
          <div className="flex items-start gap-2 text-xs">
            <Frown className="size-3.5 text-red-400/80 shrink-0 mt-0.5" />
            <span className="text-foreground/80 line-clamp-2">{persona.dor}</span>
          </div>
        ) : null}

        {persona.mensagemChave ? (
          <div className="flex items-start gap-2 text-xs">
            <Heart className="size-3.5 text-emerald-400/80 shrink-0 mt-0.5" />
            <span className="text-foreground/80 italic line-clamp-2">
              "{persona.mensagemChave}"
            </span>
          </div>
        ) : null}

        <div className="flex items-center gap-3 text-[11px] text-foreground/50 pt-1 border-t border-border">
          {persona.volumeMensal ? (
            <span className="flex items-center gap-1">
              <TrendingUp className="size-3" />
              {VOLUME_LABEL[persona.volumeMensal]}
            </span>
          ) : null}
          {persona.pctPublicoAtual != null ? (
            <span>{Math.round(persona.pctPublicoAtual)}% do público</span>
          ) : null}
          {persona.lps.length > 0 ? (
            <span className="flex items-center gap-1">
              <Megaphone className="size-3" />
              {persona.lps.length} LP{persona.lps.length > 1 ? "s" : ""}
            </span>
          ) : null}
          <ChevronRight className="size-3.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </button>
  );
}

// =============== Dialog ===============

type FormState = {
  nome: string;
  cor: string;
  descricao: string;
  demografia: string;
  dor: string;
  desejo: string;
  objecoesText: string; // textarea, 1 por linha
  mensagemChave: string;
  volumeMensal: PersonaVolume | "";
  wtpEstimado: PersonaVolume | "";
  churnRisk: PersonaRisco | "";
  pctPublicoAtual: string;
  prioridade: PersonaPrioridade;
  lpsText: string; // 1 por linha
  canaisText: string; // 1 por linha
  notas: string;
};

const EMPTY_FORM: FormState = {
  nome: "",
  cor: CORES_PADRAO[0],
  descricao: "",
  demografia: "",
  dor: "",
  desejo: "",
  objecoesText: "",
  mensagemChave: "",
  volumeMensal: "",
  wtpEstimado: "",
  churnRisk: "",
  pctPublicoAtual: "",
  prioridade: "explorando",
  lpsText: "",
  canaisText: "",
  notas: "",
};

function personaToForm(p: Persona): FormState {
  return {
    nome: p.nome,
    cor: p.cor ?? CORES_PADRAO[0],
    descricao: p.descricao ?? "",
    demografia: p.demografia ?? "",
    dor: p.dor ?? "",
    desejo: p.desejo ?? "",
    objecoesText: p.objecoes.join("\n"),
    mensagemChave: p.mensagemChave ?? "",
    volumeMensal: p.volumeMensal ?? "",
    wtpEstimado: p.wtpEstimado ?? "",
    churnRisk: p.churnRisk ?? "",
    pctPublicoAtual: p.pctPublicoAtual != null ? String(p.pctPublicoAtual) : "",
    prioridade: p.prioridade,
    lpsText: p.lps.join("\n"),
    canaisText: p.canais.join("\n"),
    notas: p.notas ?? "",
  };
}

function formToPayload(f: FormState, produtoId: number | null) {
  return {
    produtoId,
    nome: f.nome.trim(),
    cor: f.cor || null,
    descricao: f.descricao || null,
    demografia: f.demografia || null,
    dor: f.dor || null,
    desejo: f.desejo || null,
    objecoes: f.objecoesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    mensagemChave: f.mensagemChave || null,
    volumeMensal: f.volumeMensal || null,
    wtpEstimado: f.wtpEstimado || null,
    churnRisk: f.churnRisk || null,
    pctPublicoAtual:
      f.pctPublicoAtual.trim() === "" ? null : Number(f.pctPublicoAtual),
    prioridade: f.prioridade,
    lps: f.lpsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    canais: f.canaisText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    notas: f.notas || null,
  };
}

function PersonaDialog({
  open,
  onClose,
  persona,
  produtoId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  persona?: Persona;
  produtoId: number | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const qc = useQueryClient();

  // Resetar form quando muda persona ou abre/fecha
  useMemo(() => {
    if (open) {
      setForm(persona ? personaToForm(persona) : EMPTY_FORM);
    }
  }, [open, persona]);

  const isEdit = !!persona;

  const save = useMutation({
    mutationFn: async () => {
      const payload = formToPayload(form, produtoId);
      if (isEdit) {
        return api.patch<Persona>(`/api/personas/${persona!.id}`, payload);
      }
      return api.post<Persona>("/api/personas", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personas"] });
      onSaved();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/personas/${persona!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personas"] });
      onSaved();
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? <Pencil className="size-4" /> : <Plus className="size-4" />}
            {isEdit ? "Editar persona" : "Nova persona"}
          </DialogTitle>
        </DialogHeader>

        <form
          className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.nome.trim()) return;
            save.mutate();
          }}
        >
          <Field label="Nome" required>
            <Input
              value={form.nome}
              onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))}
              placeholder="ex: Gestor de tráfego"
            />
          </Field>

          <Field label="Prioridade">
            <Select
              value={form.prioridade}
              onValueChange={(v) =>
                setForm((s) => ({ ...s, prioridade: v as PersonaPrioridade }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORIDADE_LABEL).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Cor">
            <div className="flex gap-1.5 flex-wrap">
              {CORES_PADRAO.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((s) => ({ ...s, cor: c }))}
                  className={`size-7 rounded-md border-2 transition-all ${
                    form.cor === c
                      ? "border-foreground scale-110"
                      : "border-transparent"
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>

          <Field label="% do público atual">
            <Input
              type="number"
              min={0}
              max={100}
              value={form.pctPublicoAtual}
              onChange={(e) =>
                setForm((s) => ({ ...s, pctPublicoAtual: e.target.value }))
              }
              placeholder="ex: 25"
            />
          </Field>

          <Field label="Descrição (1-2 linhas — quem é)" full>
            <Input
              value={form.descricao}
              onChange={(e) =>
                setForm((s) => ({ ...s, descricao: e.target.value }))
              }
              placeholder="Ex: Profissional que gerencia campanhas pagas pra clientes ou negócio próprio."
            />
          </Field>

          <Field label="Demografia (opcional)" full>
            <Input
              value={form.demografia}
              onChange={(e) =>
                setForm((s) => ({ ...s, demografia: e.target.value }))
              }
              placeholder="ex: 25-45 anos · Brasil · faturamento R$5-50k/mês"
            />
          </Field>

          <Field label="Dor principal" full>
            <Textarea
              value={form.dor}
              onChange={(e) => setForm((s) => ({ ...s, dor: e.target.value }))}
              placeholder="O que essa pessoa está sofrendo hoje?"
              rows={2}
            />
          </Field>

          <Field label="Desejo / o que ela quer" full>
            <Textarea
              value={form.desejo}
              onChange={(e) =>
                setForm((s) => ({ ...s, desejo: e.target.value }))
              }
              placeholder="O que ela quer alcançar?"
              rows={2}
            />
          </Field>

          <Field label="Mensagem-chave (promessa do criativo)" full>
            <Textarea
              value={form.mensagemChave}
              onChange={(e) =>
                setForm((s) => ({ ...s, mensagemChave: e.target.value }))
              }
              placeholder='Ex: "Teste 30 criativos por campanha sem depender de designer."'
              rows={2}
            />
          </Field>

          <Field label="Objeções (1 por linha)" full>
            <Textarea
              value={form.objecoesText}
              onChange={(e) =>
                setForm((s) => ({ ...s, objecoesText: e.target.value }))
              }
              placeholder={"Ex:\nIA não tem qualidade visual suficiente\nTenho medo de perder o controle do criativo"}
              rows={3}
            />
          </Field>

          <Field label="Volume mensal de criativo">
            <Select
              value={form.volumeMensal || "_"}
              onValueChange={(v) =>
                setForm((s) => ({
                  ...s,
                  volumeMensal: v === "_" ? "" : (v as PersonaVolume),
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">—</SelectItem>
                {Object.entries(VOLUME_LABEL).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="WTP estimado">
            <Select
              value={form.wtpEstimado || "_"}
              onValueChange={(v) =>
                setForm((s) => ({
                  ...s,
                  wtpEstimado: v === "_" ? "" : (v as PersonaVolume),
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">—</SelectItem>
                {Object.entries(VOLUME_LABEL).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Risco de churn">
            <Select
              value={form.churnRisk || "_"}
              onValueChange={(v) =>
                setForm((s) => ({
                  ...s,
                  churnRisk: v === "_" ? "" : (v as PersonaRisco),
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">—</SelectItem>
                {Object.entries(RISCO_LABEL).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="LPs conectadas (1 por linha)">
              <Textarea
                value={form.lpsText}
                onChange={(e) =>
                  setForm((s) => ({ ...s, lpsText: e.target.value }))
                }
                placeholder={"/emp-v1\n/captura-video"}
                rows={3}
              />
            </Field>
            <Field label="Canais (1 por linha)">
              <Textarea
                value={form.canaisText}
                onChange={(e) =>
                  setForm((s) => ({ ...s, canaisText: e.target.value }))
                }
                placeholder={"meta_ads\ninstagram_organico\ncomunidade_telegram"}
                rows={3}
              />
            </Field>
          </div>

          <Field label="Notas internas" full>
            <Textarea
              value={form.notas}
              onChange={(e) =>
                setForm((s) => ({ ...s, notas: e.target.value }))
              }
              placeholder="Anotações livres, hipóteses, links de prova, etc."
              rows={2}
            />
          </Field>

          <DialogFooter className="md:col-span-2 mt-2 flex flex-row items-center justify-between">
            {isEdit ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (
                    confirm(`Apagar persona "${persona!.nome}"? Não dá pra desfazer.`)
                  )
                    remove.mutate();
                }}
                disabled={remove.isPending}
                className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
              >
                <Trash2 className="size-4 mr-1" /> Apagar
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={save.isPending || !form.nome.trim()}
              >
                {save.isPending ? "Salvando…" : isEdit ? "Salvar" : "Criar"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  required,
  full,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  full?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${full ? "md:col-span-2" : ""}`}>
      <Label className="text-xs text-foreground/70">
        {label}
        {required ? <span className="text-red-400 ml-0.5">*</span> : null}
      </Label>
      {children}
    </div>
  );
}
