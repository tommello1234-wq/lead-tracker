import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
  Target as TargetIcon,
  Megaphone,
  ImageIcon,
  CreditCard,
  FileText,
  ChevronRight,
  ChevronDown,
  Layers,
  Maximize2,
  X,
  Pencil,
  Trash2,
  Plus,
  Eye,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MindmapPickerDialog } from "@/components/mindmap-picker-dialog";
import type { Angulo, Persona, PersonaPrioridade } from "@shared/types";

// ====================== Types ======================

type NodeKind =
  | "root"
  | "persona"
  | "angulo"
  | "criativo"
  | "plano-com"
  | "plano-sem"
  | "pagina";

type MindNodeData = {
  label: string;
  kind: NodeKind;
  cor?: string;
  prioridade?: PersonaPrioridade;
  pct?: number | null;
  isPlaceholder?: boolean;
  meta?: string | null;
  /** Quantidade de filhos potenciais (mostra no badge do toggle) */
  childCount?: number;
  expanded?: boolean;
  hasChildren?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  /** Thumbnail inline (pra criativos) — imagem ou primeiro frame do vídeo */
  thumbUrl?: string | null;
  /** Indica que é vídeo (pra mostrar overlay de play) */
  isVideo?: boolean;
  /** Linha extra de métricas (funil LP) abaixo do meta principal */
  funilMeta?: string | null;
  /** LP URL pra mostrar no card e abrir no click direto */
  lpUrl?: string | null;
  /** Status do criativo como badge no header (ATIVO/PAUSADO/MORTO) */
  statusBadge?: string | null;
  /** Sub-label sutil no header (ex: ID Meta · tipo) */
  subLabel?: string | null;
  /** Stats individuais pra renderizar em grid de cards (criativo) */
  stats?: Array<{ label: string; value: string | null }>;
  /** Ações inline (botões pequenos que aparecem no hover do card) */
  actions?: Array<{
    icon: "edit" | "delete" | "add" | "view";
    label: string;
    onClick: () => void;
    danger?: boolean;
  }>;
};

type MindNode = Node<MindNodeData>;

// ====================== Constants ======================

const PRIORIDADE_ORDEM: Record<PersonaPrioridade, number> = {
  primaria: 0,
  secundaria: 1,
  terciaria: 2,
  explorando: 3,
  descartada: 4,
};

const KIND_LABEL: Record<NodeKind, string> = {
  root: "PRODUTO",
  persona: "PERSONA",
  angulo: "ÂNGULO",
  // Card agrupa o anúncio inteiro (criativo + LP + métricas) → "CAMPANHA"
  criativo: "CAMPANHA",
  "plano-com": "PLANO · COM CRÉDITOS",
  "plano-sem": "PLANO · SEM CRÉDITOS",
  pagina: "PÁGINA",
};

const KIND_ICON: Record<NodeKind, React.ComponentType<{ className?: string }> | null> = {
  root: TargetIcon,
  persona: null,
  angulo: Megaphone,
  // Campanha = agrupa anúncio (criativo + LP + métricas) — sem ícone, headline destaca
  criativo: null,
  "plano-com": CreditCard,
  "plano-sem": CreditCard,
  pagina: FileText,
};

// Paleta alinhada com identidade visual da app (tons soft, não-neon)
const KIND_DEFAULT_COR: Record<NodeKind, string> = {
  root: "oklch(0.65 0.18 145)", // lime/forest — cor primária da app
  persona: "oklch(0.62 0.04 250)", // cinza neutro
  angulo: "oklch(0.7 0.15 70)", // âmbar suave
  criativo: "oklch(0.65 0.12 200)", // ciano suave
  "plano-com": "oklch(0.62 0.18 290)", // violeta
  "plano-sem": "oklch(0.65 0.18 350)", // rosa
  pagina: "oklch(0.62 0.15 250)", // azul suave
};

const NODE_SIZES: Record<NodeKind, { w: number; h: number }> = {
  root: { w: 360, h: 80 },
  persona: { w: 360, h: 86 },
  angulo: { w: 330, h: 76 },
  // Criativo (= campanha) horizontal: thumb 180 à esquerda + grid de métricas à direita
  criativo: { w: 540, h: 240 },
  "plano-com": { w: 270, h: 60 },
  "plano-sem": { w: 270, h: 60 },
  pagina: { w: 270, h: 70 },
};

// ====================== Node component ======================

function MindMapNode({ data }: NodeProps<MindNode>) {
  const cor = data.cor ?? KIND_DEFAULT_COR[data.kind];
  const Icon = KIND_ICON[data.kind];
  const isRoot = data.kind === "root";
  const isPersona = data.kind === "persona";
  const placeholder = data.isPlaceholder;
  const size = NODE_SIZES[data.kind];

  const onClickBody = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-toggle]")) return;
    data.onClick?.();
  };

  return (
    <div
      onClick={onClickBody}
      className={`group relative text-xs select-none ${
        data.onClick ? "cursor-pointer" : ""
      }`}
      style={{
        width: size.w,
        minHeight: size.h,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-1.5 !h-1.5 !bg-border !border-0 !opacity-60"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-1.5 !h-1.5 !bg-border !border-0 !opacity-60"
      />

      <div
        className={`relative rounded-2xl bg-card transition-all hover:shadow-md hover:-translate-y-px ${
          placeholder ? "border-dashed opacity-50" : ""
        } ${
          data.kind === "criativo" && data.thumbUrl && !placeholder
            ? "overflow-hidden flex"
            : "px-4 py-3"
        }`}
        style={{
          borderWidth: isRoot ? 0 : 1,
          borderStyle: placeholder ? "dashed" : "solid",
          borderColor: placeholder ? "var(--border)" : "var(--border)",
          background: isRoot
            ? `linear-gradient(135deg, ${cor}, color-mix(in oklch, ${cor} 75%, white))`
            : "var(--card)",
          boxShadow: isRoot
            ? `0 8px 24px color-mix(in oklch, ${cor} 35%, transparent), 0 2px 6px color-mix(in oklch, ${cor} 25%, transparent)`
            : placeholder
              ? "none"
              : "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        {/* Toggle button (top-right) */}
        {data.hasChildren ? (
          <button
            type="button"
            data-toggle="1"
            onClick={(e) => {
              e.stopPropagation();
              data.onToggle?.();
            }}
            className="absolute -top-2 -right-2 size-5 grid place-items-center rounded-full border bg-background hover:scale-110 transition-transform z-10 shadow-sm"
            style={{ borderColor: cor, color: cor }}
            title={data.expanded ? "Recolher" : "Expandir"}
          >
            {data.expanded ? (
              <ChevronDown className="size-3" strokeWidth={2.5} />
            ) : (
              <ChevronRight className="size-3" strokeWidth={2.5} />
            )}
          </button>
        ) : null}

        {/* Toolbar de ações (top-left) — aparece no hover */}
        {data.actions && data.actions.length > 0 && !placeholder ? (
          <div
            data-toggle="1"
            className="absolute -top-3 left-2 hidden group-hover:flex items-center gap-1 z-10"
          >
            {data.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                data-toggle="1"
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick();
                }}
                className={`size-6 grid place-items-center rounded-md border shadow-sm hover:scale-110 transition-transform ${
                  action.danger
                    ? "bg-rose-500/95 border-rose-600 text-white"
                    : "bg-background border-border text-foreground/70 hover:text-foreground"
                }`}
                title={action.label}
                aria-label={action.label}
              >
                {action.icon === "edit" ? (
                  <Pencil className="size-3" strokeWidth={2.2} />
                ) : action.icon === "delete" ? (
                  <Trash2 className="size-3" strokeWidth={2.2} />
                ) : action.icon === "add" ? (
                  <Plus className="size-3.5" strokeWidth={2.5} />
                ) : (
                  <Eye className="size-3" strokeWidth={2.2} />
                )}
              </button>
            ))}
          </div>
        ) : null}

        {/* CRIATIVO HORIZONTAL: thumb à esquerda, infos à direita */}
        {data.kind === "criativo" && data.thumbUrl && !placeholder ? (
          <div
            className="relative bg-black flex-shrink-0"
            style={{ width: 160, height: "100%" }}
          >
            <img
              src={data.thumbUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            {data.isVideo ? (
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="size-10 rounded-full bg-black/60 grid place-items-center">
                  <svg
                    viewBox="0 0 24 24"
                    className="size-5 text-white"
                    fill="currentColor"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Container do conteúdo — full pra outros tipos, lado direito pra criativo c/ thumb */}
        <div
          className={
            data.kind === "criativo" && data.thumbUrl && !placeholder
              ? "flex-1 px-4 py-3 min-w-0 flex flex-col gap-2"
              : ""
          }
        >
          {/* Header: tag + (status badge pra criativo) + childCount badge */}
          <div
            className="text-[9px] font-semibold tracking-wider uppercase leading-tight flex items-center justify-between gap-2"
            style={{
              color: isRoot ? "rgba(255,255,255,0.9)" : cor,
              opacity: isRoot ? 1 : placeholder ? 0.55 : 0.85,
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {/* Color dot pra distinguir tipo (sutil) */}
              {!isRoot ? (
                <span
                  className="size-1.5 rounded-full shrink-0"
                  style={{ background: cor }}
                />
              ) : null}
              <span className="truncate">{KIND_LABEL[data.kind]}</span>
              {data.subLabel ? (
                <span
                  className="text-[8px] font-medium tracking-wider opacity-50 truncate"
                  style={{ color: cor }}
                >
                  · {data.subLabel}
                </span>
              ) : null}
              {data.childCount && data.childCount > 0 && !data.expanded ? (
                <span
                  className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[9px] font-bold flex-shrink-0"
                  style={{
                    background: isRoot ? "rgba(0,0,0,0.18)" : `${cor}25`,
                    color: isRoot ? "#000" : cor,
                  }}
                >
                  <Layers className="size-2.5" strokeWidth={2.5} />
                  {data.childCount}
                </span>
              ) : null}
            </div>
            {/* Status badge (criativo) */}
            {data.statusBadge && !placeholder ? (
              <span
                className="px-1.5 py-0.5 rounded font-bold text-[9px] flex-shrink-0"
                style={{
                  background:
                    data.statusBadge === "ATIVO"
                      ? "rgba(132,204,22,0.18)"
                      : data.statusBadge === "PAUSADO"
                        ? "rgba(245,158,11,0.18)"
                        : "rgba(239,68,68,0.18)",
                  color:
                    data.statusBadge === "ATIVO"
                      ? "#84cc16"
                      : data.statusBadge === "PAUSADO"
                        ? "#f59e0b"
                        : "#ef4444",
                }}
              >
                {data.statusBadge}
              </span>
            ) : null}
          </div>

          {/* Headline */}
          <div
            className="text-[14px] font-semibold leading-snug mt-1"
            style={{
              color: isRoot
                ? "rgba(255,255,255,0.98)"
                : placeholder
                  ? "var(--muted-foreground)"
                  : "var(--foreground)",
            }}
          >
            <div className="flex items-start gap-1.5">
              {Icon ? (
                <span
                  className="shrink-0 mt-0.5"
                  style={{
                    color: isRoot ? "rgba(255,255,255,0.85)" : cor,
                    opacity: placeholder ? 0.6 : 1,
                  }}
                >
                  <Icon className="size-3.5" />
                </span>
              ) : null}
              <span className="break-words flex-1 line-clamp-2">{data.label}</span>
            </div>
          </div>

          {/* Persona meta */}
          {isPersona && (data.pct != null || data.prioridade) && !placeholder ? (
            <div className="flex items-center gap-2 mt-1.5">
              {data.prioridade ? (
                <span
                  className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                  style={{
                    background: `color-mix(in oklch, ${cor} 12%, transparent)`,
                    color: cor,
                  }}
                >
                  {data.prioridade}
                </span>
              ) : null}
              {data.pct != null ? (
                <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                  {Math.round(data.pct)}% do público
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Grid de métricas (pra criativo com stats) */}
          {data.stats && data.stats.length > 0 && !placeholder ? (
            <div className="grid grid-cols-3 gap-1.5 mt-auto">
              {data.stats.map((s) => (
                <div
                  key={s.label}
                  className="rounded-md px-2 py-1.5 flex flex-col gap-0.5"
                  style={{
                    background: "rgba(0,0,0,0.45)",
                    border: `1px solid ${cor}55`,
                  }}
                >
                  <div
                    className="text-[8.5px] uppercase tracking-wider font-bold leading-none"
                    style={{ color: cor }}
                  >
                    {s.label}
                  </div>
                  <div className="text-[13px] font-extrabold tabular-nums leading-tight text-white">
                    {s.value ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Meta inline (pra outros tipos — angulo, persona) */}
          {data.meta && !placeholder && !data.stats?.length ? (
            <div
              className="text-[11px] truncate mt-1 text-muted-foreground"
            >
              {data.meta}
            </div>
          ) : null}

          {/* LP URL (rodapé do criativo) */}
          {data.lpUrl && !placeholder ? (
            <div className="text-[10px] font-mono truncate flex items-center gap-1 pt-1 border-t border-white/10">
              <span style={{ color: cor }}>↗</span>
              <span className="text-white/85 truncate">
                {shortLpLabel(data.lpUrl)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { mind: MindMapNode };

// ====================== Tree generator ======================

const PERSONAS_LIMIT = 3;
const ANGULOS_LIMIT = 3;
const CRIATIVOS_LIMIT = 3;
const PAGINAS_LIMIT = 3;

type RawTree = { nodes: MindNode[]; edges: Edge[] };

function shortLpLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname && u.pathname !== "/" ? u.pathname : u.hostname;
  } catch {
    return url.length > 24 ? url.slice(0, 24) + "…" : url;
  }
}

function fmtCtr(v: number | null | undefined): string | null {
  if (v == null) return null;
  return `CTR ${v.toFixed(2)}%`;
}

function fmtCpa(v: number | null | undefined): string | null {
  if (v == null) return null;
  if (v >= 1000) return `CPA R$${(v / 1000).toFixed(1)}k`;
  return `CPA R$${v.toFixed(0)}`;
}

function fmtImp(v: number | null | undefined): string | null {
  if (v == null) return null;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M imp`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k imp`;
  return `${v} imp`;
}

function fmtRoas(v: number | null | undefined): string | null {
  if (v == null) return null;
  return `ROAS ${v.toFixed(1)}x`;
}

function fmtStatus(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.toUpperCase();
}

function fmtCtc(v: number | null | undefined): string | null {
  if (v == null) return null;
  return `CTC ${v.toFixed(1)}%`;
}

function fmtCr(v: number | null | undefined): string | null {
  if (v == null) return null;
  return `CR ${v.toFixed(2)}%`;
}

function fmtViews(v: number | null | undefined): string | null {
  if (v == null) return null;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M views`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k views`;
  return `${v} views`;
}

// Igual fmtViews mas sem o sufixo "views" — pra grid de stats
function fmtImpVal(v: number | null | undefined): string | null {
  if (v == null) return null;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return `${v}`;
}


type ManualPicks = {
  /** slotId -> criativo.id (number como string) */
  criativos: Record<string, string>;
  /** slotId -> lpUrl */
  paginas: Record<string, string>;
};

function buildBlueprintTree(
  personas: Persona[],
  angulos: Angulo[],
  expanded: Set<string>,
  toggle: (id: string) => void,
  picks: ManualPicks,
  onSelectPersona: (p: Persona) => void,
  onAttachAngulo: (a: Angulo) => void,
  onPickCriativo: (slotId: string) => void,
  onPickPagina: (slotId: string) => void,
  onPreviewCriativo: (criativoId: number, slotId: string) => void,
  // CRUD callbacks pra ações inline no card
  onEditPersona: (p: Persona) => void,
  onDeletePersona: (p: Persona) => void,
  onCreateAnguloFor: (p: Persona) => void,
  onEditAngulo: (a: Angulo) => void,
  onDeleteAngulo: (a: Angulo) => void,
  onCreatePersona: () => void,
): RawTree {
  const nodes: MindNode[] = [];
  const edges: Edge[] = [];

  const ROOT_ID = "root";
  const rootExpanded = expanded.has(ROOT_ID);

  nodes.push({
    id: ROOT_ID,
    type: "mind",
    position: { x: 0, y: 0 },
    data: {
      label: "Gravyx",
      kind: "root",
      hasChildren: true,
      expanded: rootExpanded,
      childCount: PERSONAS_LIMIT,
      onToggle: () => toggle(ROOT_ID),
      actions: [
        { icon: "add", label: "Adicionar persona", onClick: onCreatePersona },
      ],
    },
  });

  if (!rootExpanded) return { nodes, edges };

  const sortedPersonas = [...personas].sort((a, b) => {
    const pa = PRIORIDADE_ORDEM[a.prioridade] ?? 99;
    const pb = PRIORIDADE_ORDEM[b.prioridade] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.nome.localeCompare(b.nome);
  });

  // Itera só pelas personas REAIS — sem placeholders.
  // Pra adicionar: botão "➕ Adicionar persona" no hover do nó root.
  // REVERSO mantido pra ordem LIFO do dagre (sortedPersonas[0] → topo).
  const personasLimit = Math.max(sortedPersonas.length, 0);
  for (let i = personasLimit - 1; i >= 0; i--) {
    const p = sortedPersonas[i];
    if (!p) continue;
    const personaId = `p-${p.id}`;
    const personaCor = p.cor ?? KIND_DEFAULT_COR.persona;
    const isPersonaPlaceholder = false;
    const personaExpanded = expanded.has(personaId);

    nodes.push({
      id: personaId,
      type: "mind",
      position: { x: 0, y: 0 },
      data: {
        label: p?.nome ?? `Persona ${i + 1}`,
        kind: "persona",
        cor: personaCor,
        prioridade: p?.prioridade,
        pct: p?.pctPublicoAtual,
        isPlaceholder: isPersonaPlaceholder,
        hasChildren: true,
        expanded: personaExpanded,
        childCount: ANGULOS_LIMIT,
        onToggle: () => toggle(personaId),
        onClick: p ? () => onSelectPersona(p) : undefined,
        actions: p
          ? [
              { icon: "edit", label: "Editar persona", onClick: () => onEditPersona(p) },
              { icon: "add", label: "Adicionar ângulo", onClick: () => onCreateAnguloFor(p) },
              { icon: "delete", label: "Deletar persona", onClick: () => onDeletePersona(p), danger: true },
            ]
          : undefined,
      },
    });
    edges.push({
      id: `e-${ROOT_ID}-${personaId}`,
      source: ROOT_ID,
      target: personaId,
      type: "smoothstep",
      animated: !isPersonaPlaceholder && p?.prioridade === "primaria",
      style: {
        stroke: personaCor,
        strokeWidth: 1.5,
        strokeOpacity: isPersonaPlaceholder ? 0.3 : 0.5,
      },
    });

    if (!personaExpanded) continue;

    // Esconde perdedores e descartados do mapa — são histórico, não estratégia ativa
    const personaAngulos = p
      ? angulos
          .filter(
            (a) =>
              a.personaId === p.id &&
              a.status !== "perdedor" &&
              a.ativo !== false,
          )
          .sort((a, b) => a.id - b.id)
      : [];

    // Itera só pelos ângulos REAIS dessa persona — sem placeholders vazios.
    // Pra adicionar ângulo novo, user usa o botão "➕ Adicionar ângulo" no
    // hover do card da persona.
    const limit = Math.max(personaAngulos.length, 0);
    for (let j = limit - 1; j >= 0; j--) {
      const a = personaAngulos[j];
      if (!a) continue;
      const anguloId = `a-${a.id}`;
      const anguloCor = KIND_DEFAULT_COR.angulo;
      const isAnguloPlaceholder = false;
      const anguloExpanded = expanded.has(anguloId);
      const anguloMeta = [
        fmtStatus(a.status),
        fmtRoas(a.roas),
        fmtCtr(a.ctr),
        fmtCpa(a.cpa),
      ]
        .filter(Boolean)
        .join(" · ");

      nodes.push({
        id: anguloId,
        type: "mind",
        position: { x: 0, y: 0 },
        data: {
          label: a?.nome ?? `Ângulo ${j + 1}`,
          kind: "angulo",
          cor: anguloCor,
          isPlaceholder: isAnguloPlaceholder,
          meta: anguloMeta,
          hasChildren: true,
          expanded: anguloExpanded,
          childCount: CRIATIVOS_LIMIT,
          onToggle: () => toggle(anguloId),
          // Click no ângulo → abre modal pra atribuir criativos a ele
          onClick: a ? () => onAttachAngulo(a) : undefined,
          actions: a
            ? [
                { icon: "edit", label: "Editar ângulo", onClick: () => onEditAngulo(a) },
                { icon: "delete", label: "Deletar ângulo", onClick: () => onDeleteAngulo(a), danger: true },
              ]
            : p
              ? [
                  // Placeholder de ângulo: oferece criar nesse slot
                  { icon: "add", label: "Criar ângulo aqui", onClick: () => onCreateAnguloFor(p) },
                ]
              : undefined,
        },
      });
      edges.push({
        id: `e-${personaId}-${anguloId}`,
        source: personaId,
        target: anguloId,
        type: "smoothstep",
        style: {
          stroke: anguloCor,
          strokeWidth: 1.25,
          strokeOpacity: isAnguloPlaceholder ? 0.3 : 0.45,
        },
      });

      if (!anguloExpanded) continue;

      // Renderiza só criativos REAIS atribuídos a esse ângulo — sem
      // placeholders. Pra adicionar criativo, user clica no ângulo (abre
      // AnguloAttachModal pra escolher um criativo da lista).
      const anguloCriativos = a?.criativos ?? [];
      const allCriativos = angulos.flatMap((ag) => ag.criativos ?? []);
      const criativoById = new Map<string, (typeof allCriativos)[number]>();
      for (const cc of allCriativos) criativoById.set(String(cc.id), cc);

      const criativosLimit = Math.max(anguloCriativos.length, 0);
      for (let k = criativosLimit - 1; k >= 0; k--) {
        const slotId = `${anguloId}-criativo-slot-${k}`;
        const manualPick = picks.criativos[slotId];
        const c =
          (manualPick ? criativoById.get(manualPick) : null) ??
          anguloCriativos[k];
        if (!c) continue;
        const criativoCor = KIND_DEFAULT_COR.criativo;
        const isCriativoPlaceholder = false;
        const criativoExpanded = expanded.has(slotId);

        // Pra imagem: prefere url full size. Pra vídeo: usa thumbUrl (frame).
        const criativoThumb = c
          ? c.tipo === "video"
            ? c.thumbUrl
            : (c.url ?? c.thumbUrl)
          : null;

        // Métricas individuais — pra renderizar em grid de cards
        const ctcPct =
          c?.lpViews && c.lpViews > 0 && c.checkouts != null
            ? (c.checkouts / c.lpViews) * 100
            : null;
        const crPct =
          c?.lpViews && c.lpViews > 0 && c.compras != null
            ? (c.compras / c.lpViews) * 100
            : null;
        const stats: Array<{ label: string; value: string | null }> = c
          ? [
              { label: "CTR", value: c.ctr != null ? `${c.ctr.toFixed(2)}%` : null },
              { label: "CPA", value: c.cpa != null ? `R$ ${c.cpa.toFixed(0)}` : null },
              { label: "Impressões", value: fmtImpVal(c.impressoes) },
              { label: "LP Views", value: fmtImpVal(c.lpViews) },
              { label: "CTC", value: ctcPct != null ? `${ctcPct.toFixed(1)}%` : null },
              { label: "CR", value: crPct != null ? `${crPct.toFixed(2)}%` : null },
            ]
          : [];

        // Sub-label do header: tipo + ID Meta (ex: "Imagem · 120242779116400390")
        const subLabel = c
          ? [
              c.tipo === "video" ? "Vídeo" : c.tipo === "carrossel" ? "Carrossel" : "Imagem",
              c.metaAdsId ? `ID ${c.metaAdsId.slice(-8)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : null;

        nodes.push({
          id: slotId,
          type: "mind",
          position: { x: 0, y: 0 },
          data: {
            label:
              c?.headlineOverlay?.slice(0, 80) ??
              (c ? `Campanha ${c.id}` : `Campanha ${k + 1}`),
            kind: "criativo",
            cor: criativoCor,
            isPlaceholder: isCriativoPlaceholder,
            // Status como badge separado (não na linha meta)
            statusBadge: c?.status?.toUpperCase() ?? null,
            subLabel,
            stats,
            lpUrl: c?.lpUrl ?? null,
            thumbUrl: criativoThumb,
            isVideo: c?.tipo === "video",
            // Click real abre preview. Placeholder abre picker.
            onClick: () =>
              c ? onPreviewCriativo(c.id, slotId) : onPickCriativo(slotId),
          },
        });
        edges.push({
          id: `e-${anguloId}-${slotId}`,
          source: anguloId,
          target: slotId,
          type: "smoothstep",
          style: {
            stroke: criativoCor,
            strokeWidth: 1.25,
            strokeOpacity: isCriativoPlaceholder ? 0.25 : 0.4,
          },
        });
      }
    }
  }

  return { nodes, edges };
}

// ====================== Layout (dagre) ======================

function layoutTree(
  nodes: MindNode[],
  edges: Edge[],
): { nodes: MindNode[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph({ multigraph: false }).setDefaultEdgeLabel(
    () => ({}),
  );
  g.setGraph({
    rankdir: "LR",
    // nodesep maior pra evitar overlap dos cards de campanha (240px altura)
    nodesep: 48,
    ranksep: 110,
    edgesep: 12,
    marginx: 24,
    marginy: 24,
  });

  for (const n of nodes) {
    const size = NODE_SIZES[n.data.kind];
    // Padding extra pros cards grandes (campanha) — dagre considera height
    // exato, então adiciona "respiro" pra cada tipo evitar sobreposição visual
    const padding = n.data.kind === "criativo" ? 36 : 12;
    g.setNode(n.id, { width: size.w, height: size.h + padding });
  }
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  const positioned = nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });

  return { nodes: positioned, edges };
}

// ====================== Main component ======================

const STORAGE_KEY = "personas:mindmap:expanded";
const PICKS_KEY = "personas:mindmap:picks";

const EMPTY_PICKS: ManualPicks = { criativos: {}, paginas: {} };

function MindMapInner({
  personas,
  produtoId,
  onSelectPersona,
  onSelectAngulo,
  onEditPersona,
  onDeletePersona,
  onCreateAnguloFor,
  onEditAngulo,
  onDeleteAngulo,
  onCreatePersona,
}: {
  personas: Persona[];
  produtoId: number | null;
  onSelectPersona: (p: Persona) => void;
  onSelectAngulo: (a: Angulo) => void;
  onEditPersona: (p: Persona) => void;
  onDeletePersona: (p: Persona) => void;
  onCreateAnguloFor: (p: Persona) => void;
  onEditAngulo: (a: Angulo) => void;
  onDeleteAngulo: (a: Angulo) => void;
  onCreatePersona: () => void;
}) {
  const { fitView } = useReactFlow();

  // Default: só ROOT expandido
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set(["root"]);
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v) return new Set(JSON.parse(v) as string[]);
    } catch {
      // ignore
    }
    return new Set(["root"]);
  });

  // Persiste expanded em localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(expanded)));
    } catch {
      // ignore
    }
  }, [expanded]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setExpanded(new Set(["root"]));
  }, []);

  const expandAll = useCallback(() => {
    // Expande tudo de uma vez (cuidado: 256 nós)
    const all = new Set<string>(["root"]);
    for (let i = 0; i < PERSONAS_LIMIT; i++) {
      const p = personas[i];
      const pid = p ? `p-${p.id}` : `p-ph-${i}`;
      all.add(pid);
    }
    setExpanded(all);
  }, [personas]);

  const { data: angulos = [] } = useQuery({
    queryKey: ["angulos", produtoId],
    queryFn: () =>
      api.get<Angulo[]>(
        `/api/angulos${produtoId ? `?produtoId=${produtoId}` : ""}`,
      ),
    enabled: produtoId != null,
  });

  // Refs pra callbacks instáveis (props inline do parent recriam toda render).
  const onSelectPersonaRef = useRef(onSelectPersona);
  const onSelectAnguloRef = useRef(onSelectAngulo);
  const onEditPersonaRef = useRef(onEditPersona);
  const onDeletePersonaRef = useRef(onDeletePersona);
  const onCreateAnguloForRef = useRef(onCreateAnguloFor);
  const onEditAnguloRef = useRef(onEditAngulo);
  const onDeleteAnguloRef = useRef(onDeleteAngulo);
  const onCreatePersonaRef = useRef(onCreatePersona);
  const fitViewRef = useRef(fitView);
  useEffect(() => {
    onSelectPersonaRef.current = onSelectPersona;
    onSelectAnguloRef.current = onSelectAngulo;
    onEditPersonaRef.current = onEditPersona;
    onDeletePersonaRef.current = onDeletePersona;
    onCreateAnguloForRef.current = onCreateAnguloFor;
    onEditAnguloRef.current = onEditAngulo;
    onDeleteAnguloRef.current = onDeleteAngulo;
    onCreatePersonaRef.current = onCreatePersona;
    fitViewRef.current = fitView;
  });

  // Picks manuais (slot ID → criativo.id ou lpUrl). Persiste em localStorage.
  const [picks, setPicks] = useState<ManualPicks>(() => {
    if (typeof window === "undefined") return EMPTY_PICKS;
    try {
      const v = localStorage.getItem(PICKS_KEY);
      if (v) return { ...EMPTY_PICKS, ...JSON.parse(v) };
    } catch {
      // ignore
    }
    return EMPTY_PICKS;
  });
  useEffect(() => {
    try {
      localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
    } catch {
      // ignore
    }
  }, [picks]);

  // Picker state (qual dialog tá aberto + pra qual slot)
  const [pickerOpen, setPickerOpen] = useState<{
    kind: "criativo" | "pagina";
    slotId: string;
  } | null>(null);

  const onPickCriativoSlot = useCallback((slotId: string) => {
    setPickerOpen({ kind: "criativo", slotId });
  }, []);
  const onPickPaginaSlot = useCallback((slotId: string) => {
    setPickerOpen({ kind: "pagina", slotId });
  }, []);

  // Preview do criativo (mídia + métricas)
  const [previewCriativo, setPreviewCriativo] = useState<{
    criativoId: number;
    slotId: string;
  } | null>(null);
  const onPreviewCriativoCb = useCallback(
    (criativoId: number, slotId: string) => {
      setPreviewCriativo({ criativoId, slotId });
    },
    [],
  );

  // Attach criativo → ângulo (click no ângulo abre lista de criativos)
  const [attachingAngulo, setAttachingAngulo] = useState<Angulo | null>(null);
  const onAttachAnguloCb = useCallback((a: Angulo) => {
    setAttachingAngulo(a);
  }, []);

  const onPickCriativoSlotRef = useRef(onPickCriativoSlot);
  const onPickPaginaSlotRef = useRef(onPickPaginaSlot);
  const onPreviewCriativoRef = useRef(onPreviewCriativoCb);
  const onAttachAnguloRef = useRef(onAttachAnguloCb);
  useEffect(() => {
    onPickCriativoSlotRef.current = onPickCriativoSlot;
    onPickPaginaSlotRef.current = onPickPaginaSlot;
    onPreviewCriativoRef.current = onPreviewCriativoCb;
    onAttachAnguloRef.current = onAttachAnguloCb;
  });

  // Computa árvore + layout via useMemo. Sem useState pra nodes/edges =
  // sem loop com ReactFlow internal state.
  const { nodes, edges } = useMemo(() => {
    const tree = buildBlueprintTree(
      personas,
      angulos,
      expanded,
      toggle,
      picks,
      (p) => onSelectPersonaRef.current(p),
      (a) => onAttachAnguloRef.current(a),
      (slotId) => onPickCriativoSlotRef.current(slotId),
      (slotId) => onPickPaginaSlotRef.current(slotId),
      (criativoId, slotId) => onPreviewCriativoRef.current(criativoId, slotId),
      (p) => onEditPersonaRef.current(p),
      (p) => onDeletePersonaRef.current(p),
      (p) => onCreateAnguloForRef.current(p),
      (a) => onEditAnguloRef.current(a),
      (a) => onDeleteAnguloRef.current(a),
      () => onCreatePersonaRef.current(),
    );
    return layoutTree(tree.nodes, tree.edges);
  }, [personas, angulos, expanded, toggle, picks]);

  // Aplica fitView quando layout muda (após render)
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitViewRef.current({ padding: 0.15, duration: 350 });
      });
    });
  }, [nodes]);

  return (
    <>
      {/* Botões de helper */}
      <div className="absolute top-3 right-3 z-10 flex gap-1.5">
        <button
          type="button"
          onClick={collapseAll}
          className="px-3 py-1.5 rounded-xl bg-card border border-border text-xs font-medium text-foreground/70 hover:text-foreground hover:bg-muted transition-colors shadow-sm"
        >
          Recolher tudo
        </button>
        <button
          type="button"
          onClick={expandAll}
          className="px-3 py-1.5 rounded-xl bg-card border border-border text-xs font-medium text-foreground/70 hover:text-foreground hover:bg-muted transition-colors shadow-sm"
        >
          Expandir personas
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        defaultEdgeOptions={{ type: "smoothstep" }}
        style={{ background: "var(--background)" }}
      >
        <Background gap={28} size={1.5} color="var(--border)" />
        <Controls
          showInteractive={false}
          className="!bg-card !border !border-border !rounded-xl !shadow-sm [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground/70 [&>button:hover]:!bg-muted"
        />
      </ReactFlow>
      <MindmapPickerDialog
        open={!!pickerOpen}
        mode={pickerOpen?.kind ?? "criativo"}
        angulos={angulos}
        personas={personas}
        onClose={() => setPickerOpen(null)}
        onPick={(value) => {
          if (!pickerOpen) return;
          const { kind, slotId } = pickerOpen;
          setPicks((prev) => ({
            ...prev,
            [kind === "criativo" ? "criativos" : "paginas"]: {
              ...prev[kind === "criativo" ? "criativos" : "paginas"],
              [slotId]: value,
            },
          }));
        }}
        onClear={() => {
          if (!pickerOpen) return;
          const { kind, slotId } = pickerOpen;
          setPicks((prev) => {
            const key = kind === "criativo" ? "criativos" : "paginas";
            const next = { ...prev[key] };
            delete next[slotId];
            return { ...prev, [key]: next };
          });
        }}
      />
      {previewCriativo ? (
        <CriativoPreviewModal
          criativoId={previewCriativo.criativoId}
          angulos={angulos}
          onClose={() => setPreviewCriativo(null)}
          onTrocar={() => {
            const { slotId } = previewCriativo;
            setPreviewCriativo(null);
            setPickerOpen({ kind: "criativo", slotId });
          }}
        />
      ) : null}
      {attachingAngulo ? (
        <AnguloAttachModal
          angulo={attachingAngulo}
          angulos={angulos}
          onClose={() => setAttachingAngulo(null)}
        />
      ) : null}
    </>
  );
}

/** Modal: mostra mídia do criativo (imagem/vídeo do ad) + métricas + ações */
function CriativoPreviewModal({
  criativoId,
  angulos,
  onClose,
  onTrocar,
}: {
  criativoId: number;
  angulos: Angulo[];
  onClose: () => void;
  onTrocar: () => void;
}) {
  const criativo = useMemo(() => {
    for (const a of angulos) {
      const found = a.criativos?.find((c) => c.id === criativoId);
      if (found) return found;
    }
    return null;
  }, [angulos, criativoId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!criativo) return null;
  // Pra imagem: prefere url (full size) sobre thumb (Meta serve thumb tiny).
  // Pra vídeo: usa url como source + thumbUrl como poster.
  const isVideo = criativo.tipo === "video";
  const imgUrl = !isVideo ? (criativo.url ?? criativo.thumbUrl) : null;
  const previewUrl = imgUrl ?? criativo.thumbUrl;
  const metaAdsLink = criativo.metaAdsId
    ? `https://www.facebook.com/adsmanager/manage/ads?act=918344584462338&selected_ad_ids=${criativo.metaAdsId}`
    : null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Criativo · {criativo.tipo}
              {criativo.metaAdsId ? ` · ID ${criativo.metaAdsId}` : ""}
            </p>
            <h2 className="text-base font-semibold truncate">
              {criativo.headlineOverlay ?? `Criativo ${criativo.id}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-9 rounded-xl hover:bg-muted/40 grid place-items-center transition-colors flex-shrink-0"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Mídia — altura limitada pra deixar espaço pras métricas e footer */}
          <div
            className="bg-black grid place-items-center w-full flex-shrink-0"
            style={{ height: "min(45vh, 420px)" }}
          >
            {previewUrl ? (
              isVideo && criativo.url ? (
                <video
                  src={criativo.url}
                  poster={criativo.thumbUrl ?? undefined}
                  controls
                  className="h-full w-full object-contain"
                />
              ) : (
                <img
                  src={previewUrl}
                  alt={criativo.headlineOverlay ?? `Criativo ${criativo.id}`}
                  className="h-full w-full object-contain"
                />
              )
            ) : (
              <div className="text-muted-foreground/60 text-sm py-12">
                Sem mídia disponível
              </div>
            )}
          </div>

          {/* Métricas */}
          <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-border">
            <Metric label="Status" value={criativo.status?.toUpperCase()} />
            <Metric label="CTR" value={criativo.ctr != null ? `${criativo.ctr.toFixed(2)}%` : "—"} />
            <Metric label="CPA" value={criativo.cpa != null ? `R$ ${criativo.cpa.toFixed(0)}` : "—"} />
            <Metric label="Impressões" value={fmtImp(criativo.impressoes) ?? "—"} />
            <Metric label="LP Views" value={fmtViews(criativo.lpViews) ?? "—"} />
            <Metric label="Checkouts" value={criativo.checkouts != null ? String(criativo.checkouts) : "—"} />
            <Metric label="Compras" value={criativo.compras != null ? String(criativo.compras) : "—"} />
            <Metric
              label="CTC"
              value={
                criativo.lpViews && criativo.checkouts && criativo.lpViews > 0
                  ? `${((criativo.checkouts / criativo.lpViews) * 100).toFixed(1)}%`
                  : "—"
              }
            />
          </div>

          {/* LP URL */}
          {criativo.lpUrl ? (
            <div className="px-5 py-3 border-b border-border">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                Landing Page
              </p>
              <a
                href={criativo.lpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-foreground hover:underline break-all"
              >
                {criativo.lpUrl} ↗
              </a>
            </div>
          ) : null}

          {criativo.notas ? (
            <div className="px-5 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                Notas
              </p>
              <p className="text-sm text-foreground/80 whitespace-pre-wrap">
                {criativo.notas}
              </p>
            </div>
          ) : null}
        </div>

        <footer className="px-5 py-3 border-t border-border flex items-center justify-between gap-2 flex-wrap">
          {metaAdsLink ? (
            <a
              href={metaAdsLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-foreground/70 hover:text-foreground hover:underline"
            >
              Abrir no Meta Ads ↗
            </a>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTrocar}
              className="px-3 py-1.5 rounded-lg bg-muted/30 hover:bg-muted/50 text-xs font-medium transition-colors"
            >
              Trocar criativo
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-xs font-medium transition-colors"
            >
              Fechar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums">{value ?? "—"}</p>
    </div>
  );
}

/** Modal: lista todos os criativos do banco pra atribuir ao ângulo clicado */
function AnguloAttachModal({
  angulo,
  angulos,
  onClose,
}: {
  angulo: Angulo;
  angulos: Angulo[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Flatten: todos criativos com info do ângulo atual
  const allCriativos = useMemo(() => {
    const out: Array<{
      id: number;
      thumb: string | null;
      headline: string;
      anguloId: number | null;
      anguloNome: string | null;
      metaAdsId: string | null;
      tipo: string;
      status: string;
      jaAtribuido: boolean;
    }> = [];
    for (const a of angulos) {
      for (const c of a.criativos ?? []) {
        out.push({
          id: c.id,
          thumb: c.thumbUrl ?? c.url ?? null,
          headline: c.headlineOverlay ?? `Criativo #${c.id}`,
          anguloId: c.anguloId,
          anguloNome: a.nome,
          metaAdsId: c.metaAdsId,
          tipo: c.tipo,
          status: c.status,
          jaAtribuido: c.anguloId === angulo.id,
        });
      }
    }
    // Ordena: ja atribuídos primeiro, depois sem ângulo, depois outros
    out.sort((a, b) => {
      if (a.jaAtribuido !== b.jaAtribuido) return a.jaAtribuido ? -1 : 1;
      if (!a.anguloId !== !b.anguloId) return a.anguloId ? 1 : -1;
      return b.id - a.id;
    });
    return out;
  }, [angulos, angulo.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCriativos;
    return allCriativos.filter((c) => {
      return (
        c.headline.toLowerCase().includes(q) ||
        (c.anguloNome ?? "").toLowerCase().includes(q) ||
        (c.metaAdsId ?? "").includes(q)
      );
    });
  }, [allCriativos, search]);

  async function atribuir(criativoId: number, jaAtribuido: boolean) {
    setPendingId(criativoId);
    try {
      // Se já tá atribuído a esse ângulo, "desatribui" setando anguloId = null
      await api.patch(`/api/angulos/criativos/${criativoId}`, {
        anguloId: jaAtribuido ? null : angulo.id,
      });
      await qc.invalidateQueries({ queryKey: ["angulos"] });
    } catch (e) {
      console.error(e);
      alert("Erro ao atualizar atribuição");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Ângulo
            </p>
            <h2 className="text-lg font-semibold truncate">{angulo.nome}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-9 rounded-xl hover:bg-muted/40 grid place-items-center transition-colors flex-shrink-0"
          >
            ✕
          </button>
        </header>

        <div className="px-5 py-3 border-b border-border">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por headline, ângulo ou ID Meta..."
            className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border text-sm focus:outline-none focus:border-foreground"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Click no criativo pra atribuí-lo a esse ângulo. Pode ter quantos
            criativos quiser por ângulo.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum criativo encontrado
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => atribuir(c.id, c.jaAtribuido)}
                  disabled={pendingId === c.id}
                  className={`flex items-stretch gap-2 p-2 rounded-xl border-2 transition-colors text-left ${
                    c.jaAtribuido
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-border hover:border-foreground/30 bg-muted/20"
                  } ${pendingId === c.id ? "opacity-50" : ""}`}
                >
                  <div className="w-16 h-16 rounded-lg bg-black overflow-hidden flex-shrink-0 grid place-items-center">
                    {c.thumb ? (
                      <img
                        src={c.thumb}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-muted-foreground/40 text-xs">
                        {c.tipo}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                    <p className="text-sm font-medium truncate">{c.headline}</p>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <span className="uppercase font-semibold">{c.tipo}</span>
                      <span>·</span>
                      <span className="uppercase font-semibold">
                        {c.status}
                      </span>
                      {c.anguloId && c.anguloId !== angulo.id ? (
                        <>
                          <span>·</span>
                          <span className="truncate">
                            em: {c.anguloNome}
                          </span>
                        </>
                      ) : null}
                    </div>
                    {c.jaAtribuido ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                        ✓ Atribuído · click p/ remover
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-border flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {allCriativos.filter((c) => c.jaAtribuido).length} criativos
            atribuídos a este ângulo
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-foreground text-background hover:bg-foreground/90 font-medium"
          >
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}

export function PersonaMindMap({
  personas,
  produtoId,
  onSelect,
  onSelectAngulo,
  onEditPersona,
  onDeletePersona,
  onCreateAnguloFor,
  onEditAngulo,
  onDeleteAngulo,
  onCreatePersona,
}: {
  personas: Persona[];
  produtoId: number | null;
  onSelect: (p: Persona) => void;
  onSelectAngulo?: (a: Angulo) => void;
  onEditPersona?: (p: Persona) => void;
  onDeletePersona?: (p: Persona) => void;
  onCreateAnguloFor?: (p: Persona) => void;
  onEditAngulo?: (a: Angulo) => void;
  onDeleteAngulo?: (a: Angulo) => void;
  onCreatePersona?: () => void;
}) {
  const handleAngulo = onSelectAngulo ?? (() => {});
  const noop = () => {};
  const handleEditPersona = onEditPersona ?? noop;
  const handleDeletePersona = onDeletePersona ?? noop;
  const handleCreateAnguloFor = onCreateAnguloFor ?? noop;
  const handleEditAngulo = onEditAngulo ?? noop;
  const handleDeleteAngulo = onDeleteAngulo ?? noop;
  const handleCreatePersona = onCreatePersona ?? noop;
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ESC fecha o modo tela cheia
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  // Wrapper muda: inline normal vs fixed cobrindo viewport
  const wrapperClass = isFullscreen
    ? "fixed inset-0 z-50 bg-background flex flex-col"
    : "rounded-3xl border border-border bg-card overflow-hidden shadow-sm";
  const flowHeight = isFullscreen ? "flex-1" : "";
  const flowStyle: React.CSSProperties = isFullscreen
    ? { width: "100%", flex: 1, position: "relative" }
    : { width: "100%", height: 720, position: "relative" };

  return (
    <div className={wrapperClass}>
      <div className="px-5 py-3 border-b border-border bg-card flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-foreground/80">
          <span className="font-semibold">Hierarquia:</span>{" "}
          <span className="text-muted-foreground">Produto → Personas → Ângulos → Criativos</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mr-2">
            <span className="flex items-center gap-1.5">
              <ChevronRight className="size-3" />
              click pra expandir
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            className="px-3 py-1.5 rounded-xl bg-card border border-border text-xs font-medium text-foreground/70 hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
            title={isFullscreen ? "Fechar (ESC)" : "Tela cheia"}
          >
            {isFullscreen ? <X className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            {isFullscreen ? "Fechar" : "Tela cheia"}
          </button>
        </div>
      </div>
      <div style={flowStyle} className={flowHeight}>
        <ReactFlowProvider>
          <MindMapInner
            personas={personas}
            produtoId={produtoId}
            onSelectPersona={onSelect}
            onSelectAngulo={handleAngulo}
            onEditPersona={handleEditPersona}
            onDeletePersona={handleDeletePersona}
            onCreateAnguloFor={handleCreateAnguloFor}
            onEditAngulo={handleEditAngulo}
            onDeleteAngulo={handleDeleteAngulo}
            onCreatePersona={handleCreatePersona}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
