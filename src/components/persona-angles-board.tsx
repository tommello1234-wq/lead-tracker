import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ImageIcon,
  ExternalLink,
  Pencil,
  Trash2,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  Download,
} from "lucide-react";
import { ImportMetaAdsDialog } from "@/components/import-meta-ads-dialog";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import type { Angulo, AnguloStatus, Persona } from "@shared/types";

// ====================== Constants ======================

const STATUS_LABEL: Record<AnguloStatus, string> = {
  ideia: "💡 Ideia",
  producao: "🟡 Em produção",
  rodando: "🟢 Rodando",
  vencedor: "🏆 Vencedor",
  perdedor: "❌ Perdedor",
  pausado: "⏸️ Pausado",
};

const STATUS_COR: Record<AnguloStatus, string> = {
  ideia: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  producao: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  rodando: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  vencedor: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
  perdedor: "bg-red-500/15 text-red-300 border-red-500/30",
  pausado: "bg-blue-500/10 text-blue-300 border-blue-500/30",
};

// ====================== Main ======================

export function PersonaAnglesBoard({
  personas,
  produtoId,
  onEditPersona,
}: {
  personas: Persona[];
  produtoId: number | null;
  onEditPersona: (p: Persona) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Angulo | null>(null);
  const [creatingFor, setCreatingFor] = useState<Persona | null>(null);
  const [importing, setImporting] = useState(false);
  const [collapsedPersonas, setCollapsedPersonas] = useState<Set<number>>(
    new Set(),
  );

  const { data: angulos = [] } = useQuery({
    queryKey: ["angulos", produtoId],
    queryFn: () =>
      api.get<Angulo[]>(
        `/api/angulos${produtoId ? `?produtoId=${produtoId}` : ""}`,
      ),
    enabled: produtoId != null,
  });

  // Agrupa ângulos por persona
  const byPersona = useMemo(() => {
    const m = new Map<number, Angulo[]>();
    for (const a of angulos) {
      if (a.personaId == null) continue;
      if (!m.has(a.personaId)) m.set(a.personaId, []);
      m.get(a.personaId)!.push(a);
    }
    return m;
  }, [angulos]);

  // Ângulos sem persona definida (órfãos)
  const orfaos = angulos.filter((a) => a.personaId == null);

  const togglePersona = (id: number) => {
    setCollapsedPersonas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!produtoId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-12 text-center text-sm text-foreground/60">
        Selecione um produto pra ver o board.
      </div>
    );
  }

  if (personas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-12 text-center text-sm text-foreground/60">
        Crie uma persona primeiro pra começar a cadastrar ângulos.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar do board */}
      <div className="flex items-center justify-between gap-3 -mb-2">
        <div className="text-xs text-foreground/60">
          Cada persona vira swim lane. Cadastre ângulos pra testar promessas
          diferentes pro mesmo público.
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setImporting(true)}
        >
          <Download className="size-3.5 mr-1.5" />
          Importar do Meta Ads
        </Button>
      </div>

      {personas.map((p) => {
        const personaAngulos = byPersona.get(p.id) ?? [];
        const collapsed = collapsedPersonas.has(p.id);
        const cor = p.cor ?? "#71717a";
        return (
          <section
            key={p.id}
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            {/* Header da persona */}
            <header
              className="flex items-center gap-3 px-5 py-4 border-b border-border"
              style={{ background: `${cor}10` }}
            >
              <button
                onClick={() => togglePersona(p.id)}
                className="size-7 grid place-items-center rounded-md hover:bg-muted text-foreground/60 hover:text-foreground transition-colors"
              >
                {collapsed ? (
                  <ChevronRight className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </button>
              <div
                className="size-3 rounded-full shrink-0"
                style={{ background: cor }}
              />
              <button
                onClick={() => onEditPersona(p)}
                className="text-left flex-1 hover:opacity-80 transition-opacity"
              >
                <div className="font-bold text-base flex items-center gap-2 flex-wrap">
                  {p.nome}
                  <span
                    className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border"
                    style={{
                      borderColor: `${cor}60`,
                      color: cor,
                      background: `${cor}10`,
                    }}
                  >
                    {p.prioridade}
                  </span>
                  {p.pctPublicoAtual != null ? (
                    <span className="text-[11px] text-foreground/60 font-mono font-normal">
                      · {Math.round(p.pctPublicoAtual)}% do público
                    </span>
                  ) : null}
                </div>
                {p.descricao ? (
                  <div className="text-xs text-foreground/60 mt-0.5 line-clamp-1">
                    {p.descricao}
                  </div>
                ) : null}
              </button>
              <div className="text-xs text-foreground/50 font-mono shrink-0">
                {personaAngulos.length} ângulo{personaAngulos.length !== 1 ? "s" : ""}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreatingFor(p)}
              >
                <Plus className="size-3.5 mr-1" /> Ângulo
              </Button>
            </header>

            {/* Grid de ângulos */}
            {!collapsed ? (
              <div className="p-5">
                {personaAngulos.length === 0 ? (
                  <button
                    onClick={() => setCreatingFor(p)}
                    className="w-full rounded-lg border-2 border-dashed border-border p-8 text-sm text-foreground/50 hover:text-foreground hover:border-foreground/40 transition-colors flex flex-col items-center gap-2"
                  >
                    <Plus className="size-5" />
                    Nenhum ângulo testado ainda. Cria o primeiro.
                  </button>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {personaAngulos.map((a) => (
                      <AnguloCard
                        key={a.id}
                        angulo={a}
                        personaCor={cor}
                        onClick={() => setEditing(a)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        );
      })}

      {/* Órfãos */}
      {orfaos.length > 0 ? (
        <section className="rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5 overflow-hidden">
          <header className="px-5 py-3 border-b border-amber-500/20 text-amber-300 text-sm font-medium">
            ⚠️ Ângulos sem persona ({orfaos.length})
          </header>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {orfaos.map((a) => (
              <AnguloCard
                key={a.id}
                angulo={a}
                personaCor="#a8a29e"
                onClick={() => setEditing(a)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Dialogs */}
      <AnguloDialog
        open={!!editing}
        angulo={editing ?? undefined}
        persona={
          editing && editing.personaId != null
            ? personas.find((p) => p.id === editing.personaId) ?? null
            : null
        }
        produtoId={produtoId}
        onClose={() => setEditing(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["angulos"] });
          setEditing(null);
        }}
      />
      <AnguloDialog
        open={!!creatingFor}
        persona={creatingFor}
        produtoId={produtoId}
        onClose={() => setCreatingFor(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["angulos"] });
          setCreatingFor(null);
        }}
      />
      <ImportMetaAdsDialog
        open={importing}
        onClose={() => setImporting(false)}
        personas={personas}
        produtoId={produtoId}
        onImported={() => {
          qc.invalidateQueries({ queryKey: ["angulos"] });
          setImporting(false);
        }}
      />
    </div>
  );
}

// ====================== AnguloCard ======================

function AnguloCard({
  angulo,
  personaCor,
  onClick,
}: {
  angulo: Angulo;
  personaCor: string;
  onClick: () => void;
}) {
  const primeiroCriativo = angulo.criativos?.[0];
  const adThumb = primeiroCriativo?.thumbUrl ?? primeiroCriativo?.url ?? null;
  const lpThumb = angulo.lpScreenshot;

  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border border-border bg-background hover:border-foreground/30 transition-colors group overflow-hidden flex flex-col"
    >
      {/* Stripe da persona */}
      <div className="h-1" style={{ background: personaCor }} />

      <div className="p-3 flex flex-col gap-2.5 flex-1">
        {/* Linha 1: nome + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="font-bold text-sm leading-tight flex-1">
            {angulo.nome}
          </div>
          <span
            className={`shrink-0 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide ${STATUS_COR[angulo.status]}`}
          >
            {STATUS_LABEL[angulo.status]}
          </span>
        </div>

        {/* Hook */}
        {angulo.hook ? (
          <div className="text-xs text-foreground/80 italic line-clamp-2 leading-snug">
            "{angulo.hook}"
          </div>
        ) : null}

        {/* Mídias side-by-side */}
        <div className="grid grid-cols-2 gap-1.5">
          <ThumbBox
            label="AD"
            src={adThumb}
            url={primeiroCriativo?.url}
            cor={personaCor}
          />
          <ThumbBox
            label="LP"
            src={lpThumb}
            url={angulo.lpUrl}
            cor={personaCor}
          />
        </div>

        {/* Métricas (se houver) */}
        {angulo.ctr != null ||
        angulo.cpa != null ||
        angulo.roas != null ||
        angulo.diasRodando != null ? (
          <div className="flex items-center gap-2 text-[10px] font-mono text-foreground/60 pt-1.5 border-t border-border">
            {angulo.ctr != null ? (
              <span>CTR {angulo.ctr.toFixed(2)}%</span>
            ) : null}
            {angulo.cpa != null ? (
              <span>· CPA R${angulo.cpa.toFixed(0)}</span>
            ) : null}
            {angulo.roas != null ? (
              <span className="flex items-center gap-1">
                · <TrendingUp className="size-3" />
                {angulo.roas.toFixed(1)}x
              </span>
            ) : null}
            {angulo.diasRodando != null ? (
              <span className="ml-auto">· {angulo.diasRodando}d</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function ThumbBox({
  label,
  src,
  url,
  cor,
}: {
  label: string;
  src: string | null | undefined;
  url: string | null | undefined;
  cor: string;
}) {
  const isVideo =
    src != null && /\.(mp4|webm|mov)(\?|$)/i.test(src);
  return (
    <div
      className="relative aspect-video rounded-md overflow-hidden bg-muted/40 border border-border flex items-center justify-center group-hover:border-foreground/20 transition-colors"
      style={{ borderColor: src ? `${cor}30` : undefined }}
    >
      {src ? (
        isVideo ? (
          <video
            src={src}
            className="w-full h-full object-cover"
            muted
            playsInline
          />
        ) : (
          <img src={src} alt={label} className="w-full h-full object-cover" />
        )
      ) : (
        <div className="flex flex-col items-center gap-1 text-foreground/40">
          <ImageIcon className="size-4" />
          <span className="text-[9px] font-mono uppercase tracking-wider">
            {label}
          </span>
        </div>
      )}
      {/* Label flutuante */}
      <span className="absolute top-1 left-1 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-background/80 text-foreground/80 backdrop-blur-sm">
        {label}
      </span>
      {/* Link (se houver URL) */}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1 right-1 size-5 grid place-items-center rounded bg-background/80 text-foreground/80 hover:text-foreground backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
          title={url}
        >
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

// ====================== Dialog ======================

type FormState = {
  nome: string;
  promessa: string;
  hook: string;
  cta: string;
  status: AnguloStatus;
  lpUrl: string;
  lpScreenshot: string;
  ctr: string;
  cpa: string;
  roas: string;
  diasRodando: string;
  budgetMensal: string;
  notas: string;
  // Primeiro criativo (campos básicos pra agilizar)
  adUrl: string;
  adThumb: string;
  adHeadline: string;
};

const EMPTY_FORM: FormState = {
  nome: "",
  promessa: "",
  hook: "",
  cta: "",
  status: "ideia",
  lpUrl: "",
  lpScreenshot: "",
  ctr: "",
  cpa: "",
  roas: "",
  diasRodando: "",
  budgetMensal: "",
  notas: "",
  adUrl: "",
  adThumb: "",
  adHeadline: "",
};

function anguloToForm(a: Angulo): FormState {
  const c = a.criativos?.[0];
  return {
    nome: a.nome,
    promessa: a.promessa ?? "",
    hook: a.hook ?? "",
    cta: a.cta ?? "",
    status: a.status,
    lpUrl: a.lpUrl ?? "",
    lpScreenshot: a.lpScreenshot ?? "",
    ctr: a.ctr != null ? String(a.ctr) : "",
    cpa: a.cpa != null ? String(a.cpa) : "",
    roas: a.roas != null ? String(a.roas) : "",
    diasRodando: a.diasRodando != null ? String(a.diasRodando) : "",
    budgetMensal: a.budgetMensal != null ? String(a.budgetMensal) : "",
    notas: a.notas ?? "",
    adUrl: c?.url ?? "",
    adThumb: c?.thumbUrl ?? "",
    adHeadline: c?.headlineOverlay ?? "",
  };
}

function AnguloDialog({
  open,
  onClose,
  angulo,
  persona,
  produtoId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  angulo?: Angulo;
  persona: Persona | null;
  produtoId: number | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const qc = useQueryClient();
  const isEdit = !!angulo;

  useMemo(() => {
    if (open) {
      setForm(angulo ? anguloToForm(angulo) : EMPTY_FORM);
    }
  }, [open, angulo]);

  const save = useMutation({
    mutationFn: async () => {
      const numOrNull = (s: string) =>
        s.trim() === "" ? null : Number(s);
      const payload = {
        personaId: persona?.id ?? null,
        produtoId,
        nome: form.nome.trim(),
        promessa: form.promessa || null,
        hook: form.hook || null,
        cta: form.cta || null,
        status: form.status,
        lpUrl: form.lpUrl || null,
        lpScreenshot: form.lpScreenshot || null,
        ctr: numOrNull(form.ctr),
        cpa: numOrNull(form.cpa),
        roas: numOrNull(form.roas),
        diasRodando: numOrNull(form.diasRodando),
        budgetMensal: numOrNull(form.budgetMensal),
        notas: form.notas || null,
      };
      let saved: Angulo;
      if (isEdit) {
        saved = await api.patch<Angulo>(`/api/angulos/${angulo!.id}`, payload);
      } else {
        saved = await api.post<Angulo>("/api/angulos", payload);
      }

      // Cria/atualiza primeiro criativo se algum campo foi preenchido.
      const hasAdData =
        form.adUrl.trim() !== "" ||
        form.adThumb.trim() !== "" ||
        form.adHeadline.trim() !== "";
      if (hasAdData) {
        const existingCriativo = angulo?.criativos?.[0];
        const tipo: "video" | "imagem" = /\.(mp4|webm|mov)/i.test(
          form.adUrl,
        )
          ? "video"
          : "imagem";
        const criativoPayload = {
          tipo,
          url: form.adUrl || null,
          thumbUrl: form.adThumb || null,
          headlineOverlay: form.adHeadline || null,
        };
        if (existingCriativo) {
          await api.patch(
            `/api/angulos/criativos/${existingCriativo.id}`,
            criativoPayload,
          );
        } else {
          await api.post(
            `/api/angulos/${saved.id}/criativos`,
            criativoPayload,
          );
        }
      }
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["angulos"] });
      onSaved();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/angulos/${angulo!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["angulos"] });
      onSaved();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? <Pencil className="size-4" /> : <Plus className="size-4" />}
            {isEdit ? "Editar ângulo" : "Novo ângulo"}
            {persona ? (
              <span
                className="ml-2 text-xs font-normal px-2 py-0.5 rounded-md border"
                style={{
                  borderColor: `${persona.cor ?? "#71717a"}60`,
                  color: persona.cor ?? "#a1a1aa",
                  background: `${persona.cor ?? "#71717a"}10`,
                }}
              >
                Persona: {persona.nome}
              </span>
            ) : null}
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
          <Field label="Nome do ângulo" required>
            <Input
              value={form.nome}
              onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))}
              placeholder="ex: Velocidade, Custo, Independência"
            />
          </Field>

          <Field label="Status">
            <Select
              value={form.status}
              onValueChange={(v) =>
                setForm((s) => ({ ...s, status: v as AnguloStatus }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABEL).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Promessa principal" full>
            <Textarea
              value={form.promessa}
              onChange={(e) =>
                setForm((s) => ({ ...s, promessa: e.target.value }))
              }
              placeholder='Ex: "Crie criativo ilimitado pagando centavos por geração."'
              rows={2}
            />
          </Field>

          <Field label="Hook (gancho do criativo)" full>
            <Textarea
              value={form.hook}
              onChange={(e) => setForm((s) => ({ ...s, hook: e.target.value }))}
              placeholder='Ex: "Por que designer ainda demora 3 dias se IA gera em 30s?"'
              rows={2}
            />
          </Field>

          <Field label="CTA" full>
            <Input
              value={form.cta}
              onChange={(e) => setForm((s) => ({ ...s, cta: e.target.value }))}
              placeholder='Ex: "Comece agora por R$ 67/mês"'
            />
          </Field>

          {/* Mídia */}
          <div className="md:col-span-2 mt-2 pt-3 border-t border-border">
            <div className="text-xs uppercase tracking-wider text-foreground/60 font-bold mb-3">
              Mídia
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="LP URL (path interno ou URL externa)">
                <Input
                  value={form.lpUrl}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, lpUrl: e.target.value }))
                  }
                  placeholder="/emp-v1 ou https://..."
                />
              </Field>
              <Field label="Screenshot da LP (URL)">
                <Input
                  value={form.lpScreenshot}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, lpScreenshot: e.target.value }))
                  }
                  placeholder="https://imgur.com/.../lp.png"
                />
              </Field>
              <Field label="Ad — URL do arquivo (vídeo/imagem)">
                <Input
                  value={form.adUrl}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, adUrl: e.target.value }))
                  }
                  placeholder="https://.../ad.mp4 ou .jpg"
                />
              </Field>
              <Field label="Ad — Thumb (URL)">
                <Input
                  value={form.adThumb}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, adThumb: e.target.value }))
                  }
                  placeholder="https://.../thumb.jpg"
                />
              </Field>
              <Field label="Ad — Headline overlay" full>
                <Input
                  value={form.adHeadline}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, adHeadline: e.target.value }))
                  }
                  placeholder="Texto do criativo"
                />
              </Field>
            </div>
          </div>

          {/* Métricas */}
          <div className="md:col-span-2 mt-2 pt-3 border-t border-border">
            <div className="text-xs uppercase tracking-wider text-foreground/60 font-bold mb-3">
              Métricas (snapshot)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Field label="CTR (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.ctr}
                  onChange={(e) => setForm((s) => ({ ...s, ctr: e.target.value }))}
                  placeholder="2.3"
                />
              </Field>
              <Field label="CPA (R$)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.cpa}
                  onChange={(e) => setForm((s) => ({ ...s, cpa: e.target.value }))}
                  placeholder="12"
                />
              </Field>
              <Field label="ROAS (x)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.roas}
                  onChange={(e) => setForm((s) => ({ ...s, roas: e.target.value }))}
                  placeholder="4.0"
                />
              </Field>
              <Field label="Dias rodando">
                <Input
                  type="number"
                  value={form.diasRodando}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, diasRodando: e.target.value }))
                  }
                  placeholder="7"
                />
              </Field>
              <Field label="Budget/mês">
                <Input
                  type="number"
                  step="1"
                  value={form.budgetMensal}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, budgetMensal: e.target.value }))
                  }
                  placeholder="500"
                />
              </Field>
            </div>
          </div>

          <Field label="Notas" full>
            <Textarea
              value={form.notas}
              onChange={(e) =>
                setForm((s) => ({ ...s, notas: e.target.value }))
              }
              placeholder="Hipóteses, aprendizados, links pra prova, etc."
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
                    confirm(
                      `Apagar o ângulo "${angulo!.nome}"? Não dá pra desfazer.`,
                    )
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
