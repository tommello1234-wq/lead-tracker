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
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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
  criativo: "CRIATIVO",
  "plano-com": "PLANO · COM CRÉDITOS",
  "plano-sem": "PLANO · SEM CRÉDITOS",
  pagina: "PÁGINA",
};

const KIND_ICON: Record<NodeKind, React.ComponentType<{ className?: string }> | null> = {
  root: TargetIcon,
  persona: null,
  angulo: Megaphone,
  criativo: ImageIcon,
  "plano-com": CreditCard,
  "plano-sem": CreditCard,
  pagina: FileText,
};

const KIND_DEFAULT_COR: Record<NodeKind, string> = {
  root: "#10b981",
  persona: "#71717a",
  angulo: "#f59e0b",
  criativo: "#06b6d4",
  "plano-com": "#a855f7",
  "plano-sem": "#ec4899",
  pagina: "#3b82f6",
};

const NODE_SIZES: Record<NodeKind, { w: number; h: number }> = {
  root: { w: 360, h: 80 },
  persona: { w: 360, h: 86 },
  angulo: { w: 330, h: 76 },
  criativo: { w: 310, h: 88 },
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
      className={`relative font-mono text-xs select-none ${
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
        className="!w-2 !h-2 !bg-foreground/30 !border-2 !border-background"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-foreground/30 !border-2 !border-background"
      />

      {/* Glow halo (só pra root e persona expandida) */}
      {isRoot ? (
        <div
          className="absolute inset-0 rounded-2xl blur-xl opacity-40 -z-10"
          style={{ background: cor }}
        />
      ) : null}

      <div
        className={`relative rounded-xl px-3 py-2.5 transition-all hover:scale-[1.02] hover:brightness-110 ${
          placeholder ? "border-dashed" : ""
        }`}
        style={{
          borderWidth: 1.5,
          borderStyle: placeholder ? "dashed" : "solid",
          borderColor: placeholder ? `${cor}45` : cor,
          background: isRoot
            ? `linear-gradient(135deg, ${cor}, ${cor}dd)`
            : placeholder
              ? "rgba(255,255,255,0.02)"
              : `linear-gradient(135deg, ${cor}18, ${cor}05)`,
          opacity: placeholder ? 0.6 : 1,
          boxShadow: isRoot
            ? `0 0 30px ${cor}55, inset 0 1px 0 rgba(255,255,255,0.15)`
            : !placeholder
              ? `0 4px 12px rgba(0,0,0,0.25), inset 0 1px 0 ${cor}15`
              : "none",
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

        {/* Header tag */}
        <div
          className="text-[8px] font-bold tracking-[1.5px] uppercase mb-1 leading-tight flex items-center gap-1.5"
          style={{
            color: isRoot ? "rgba(0,0,0,0.7)" : cor,
            opacity: isRoot ? 1 : placeholder ? 0.55 : 0.9,
          }}
        >
          <span>// {KIND_LABEL[data.kind]}</span>
          {data.childCount && data.childCount > 0 && !data.expanded ? (
            <span
              className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[9px] font-bold"
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

        {/* Body */}
        <div
          className="font-sans text-[13px] font-bold leading-tight"
          style={{
            color: isRoot
              ? "#000"
              : placeholder
                ? "#a1a1aa"
                : "#fafafa",
          }}
        >
          <div className="flex items-start gap-1.5">
            {Icon ? (
              <span
                className="shrink-0 mt-0.5"
                style={{
                  color: isRoot ? "rgba(0,0,0,0.7)" : cor,
                  opacity: placeholder ? 0.6 : 1,
                }}
              >
                <Icon className="size-3.5" />
              </span>
            ) : null}
            <span className="break-words leading-snug flex-1">{data.label}</span>
          </div>
          {/* Persona meta */}
          {isPersona && (data.pct != null || data.prioridade) && !placeholder ? (
            <div
              className="mt-1 text-[10px] font-medium font-mono"
              style={{ color: cor, opacity: 0.85 }}
            >
              {data.prioridade ? data.prioridade.toUpperCase() : ""}
              {data.prioridade && data.pct != null ? " · " : ""}
              {data.pct != null ? `${Math.round(data.pct)}%` : ""}
            </div>
          ) : null}
          {/* Meta extra */}
          {data.meta && !placeholder ? (
            <div
              className="mt-1 text-[10px] font-mono truncate"
              style={{ color: cor, opacity: 0.85 }}
            >
              {data.meta}
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
  onSelectAngulo: (a: Angulo) => void,
  onPickCriativo: (slotId: string) => void,
  onPickPagina: (slotId: string) => void,
  onPreviewCriativo: (criativoId: number, slotId: string) => void,
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
    },
  });

  if (!rootExpanded) return { nodes, edges };

  const sortedPersonas = [...personas].sort((a, b) => {
    const pa = PRIORIDADE_ORDEM[a.prioridade] ?? 99;
    const pb = PRIORIDADE_ORDEM[b.prioridade] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.nome.localeCompare(b.nome);
  });

  // Itera REVERSO porque dagre LR ordena nodes dentro do rank em LIFO
  // (último inserido = topo). Inserindo de trás pra frente, sortedPersonas[0]
  // (maior prioridade) acaba inserido por último → topo do mapa.
  for (let i = PERSONAS_LIMIT - 1; i >= 0; i--) {
    const p = sortedPersonas[i];
    const personaId = p ? `p-${p.id}` : `p-ph-${i}`;
    const personaCor = p?.cor ?? KIND_DEFAULT_COR.persona;
    const isPersonaPlaceholder = !p;
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
        strokeWidth: 2,
        strokeOpacity: isPersonaPlaceholder ? 0.4 : 0.95,
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

    // Reverso: compensar LIFO do dagre (mesma lógica das personas)
    for (let j = ANGULOS_LIMIT - 1; j >= 0; j--) {
      const a = personaAngulos[j];
      const anguloId = a ? `a-${a.id}` : `${personaId}-a-ph-${j}`;
      const anguloCor = KIND_DEFAULT_COR.angulo;
      const isAnguloPlaceholder = !a;
      const anguloExpanded = expanded.has(anguloId);
      const anguloMeta = a
        ? [fmtStatus(a.status), fmtRoas(a.roas), fmtCtr(a.ctr), fmtCpa(a.cpa)]
            .filter(Boolean)
            .join(" · ")
        : null;

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
          onClick: a ? () => onSelectAngulo(a) : undefined,
        },
      });
      edges.push({
        id: `e-${personaId}-${anguloId}`,
        source: personaId,
        target: anguloId,
        type: "smoothstep",
        style: {
          stroke: anguloCor,
          strokeWidth: 1.6,
          strokeOpacity: isAnguloPlaceholder ? 0.4 : 0.85,
        },
      });

      if (!anguloExpanded) continue;

      // Slot IDs estáveis baseados em posição (não no criativo.id)
      // pra que pick manual + auto possam co-existir.
      const anguloCriativos = a?.criativos ?? [];
      // Indexa criativos GLOBALMENTE pra resolver pick manual
      const allCriativos = angulos.flatMap((ag) => ag.criativos ?? []);
      const criativoById = new Map<string, (typeof allCriativos)[number]>();
      for (const cc of allCriativos) criativoById.set(String(cc.id), cc);

      // Reverso: compensar LIFO do dagre
      for (let k = CRIATIVOS_LIMIT - 1; k >= 0; k--) {
        const slotId = `${anguloId}-criativo-slot-${k}`;
        const manualPick = picks.criativos[slotId];
        // Resolver: 1) pick manual; 2) auto (criativo[k] do ângulo)
        const c =
          (manualPick ? criativoById.get(manualPick) : null) ??
          anguloCriativos[k];
        const criativoCor = KIND_DEFAULT_COR.criativo;
        const isCriativoPlaceholder = !c;
        const criativoExpanded = expanded.has(slotId);

        const criativoMeta = c
          ? [
              fmtStatus(c.status),
              fmtCtr(c.ctr),
              fmtCpa(c.cpa),
              fmtImp(c.impressoes),
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
              c?.headlineOverlay?.slice(0, 36) ??
              (c ? `Criativo ${c.id}` : `Criativo ${k + 1}`),
            kind: "criativo",
            cor: criativoCor,
            isPlaceholder: isCriativoPlaceholder,
            meta: criativoMeta,
            hasChildren: true,
            expanded: criativoExpanded,
            childCount: 2,
            onToggle: () => toggle(slotId),
            // Criativo real → abre preview. Placeholder → abre picker pra escolher.
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
            strokeWidth: 1.4,
            strokeOpacity: isCriativoPlaceholder ? 0.35 : 0.8,
          },
        });

        if (!criativoExpanded) continue;

        const planos: Array<{
          id: string;
          label: string;
          kind: NodeKind;
          cor: string;
        }> = [
          {
            id: `${slotId}-pcom`,
            label: "Com Créditos",
            kind: "plano-com",
            cor: KIND_DEFAULT_COR["plano-com"],
          },
          {
            id: `${slotId}-psem`,
            label: "Sem Créditos",
            kind: "plano-sem",
            cor: KIND_DEFAULT_COR["plano-sem"],
          },
        ];

        for (const plano of planos) {
          const planoExpanded = expanded.has(plano.id);
          nodes.push({
            id: plano.id,
            type: "mind",
            position: { x: 0, y: 0 },
            data: {
              label: plano.label,
              kind: plano.kind,
              cor: plano.cor,
              isPlaceholder: true,
              hasChildren: true,
              expanded: planoExpanded,
              childCount: PAGINAS_LIMIT,
              onToggle: () => toggle(plano.id),
            },
          });
          edges.push({
            id: `e-${slotId}-${plano.id}`,
            source: slotId,
            target: plano.id,
            type: "smoothstep",
            style: {
              stroke: plano.cor,
              strokeWidth: 1.2,
              strokeOpacity: 0.5,
            },
          });

          if (!planoExpanded) continue;

          // Página: pick manual > LP do criativo > LP do ângulo (slot 0) > placeholder
          // LP é propriedade do criativo (cada ad tem URL própria no Meta);
          // angulo.lpUrl é fallback p/ criativos legados sem lp_url.
          const autoLp = c?.lpUrl ?? a?.lpUrl ?? null;
          // Reverso: compensar LIFO do dagre
          for (let q = PAGINAS_LIMIT - 1; q >= 0; q--) {
            const pageSlotId = `${plano.id}-pagina-slot-${q}`;
            const manualLp = picks.paginas[pageSlotId];
            const lpResolved = manualLp ?? (q === 0 ? autoLp : null);
            const isRealPage = !!lpResolved;
            // Métricas da página = do CRIATIVO PAI desse ramo. A LP pode
            // estar em N campanhas, mas aqui a árvore representa "essa LP
            // rodando com esse criativo específico" — só o funil dele
            // importa. Se o user picou uma LP diferente da do criativo,
            // não há dados (é uma intenção, não medição).
            const lpMatchesCriativo = !!c && c.lpUrl === lpResolved;
            const lpStats = lpMatchesCriativo
              ? {
                  lpViews: c.lpViews,
                  checkouts: c.checkouts,
                  compras: c.compras,
                  ctc:
                    c.lpViews && c.lpViews > 0 && c.checkouts != null
                      ? (c.checkouts / c.lpViews) * 100
                      : null,
                  cr:
                    c.lpViews && c.lpViews > 0 && c.compras != null
                      ? (c.compras / c.lpViews) * 100
                      : null,
                }
              : null;
            const paginaMeta = lpStats
              ? [
                  fmtCtc(lpStats.ctc),
                  fmtCr(lpStats.cr),
                  fmtViews(lpStats.lpViews),
                ]
                  .filter(Boolean)
                  .join(" · ") || null
              : null;
            nodes.push({
              id: pageSlotId,
              type: "mind",
              position: { x: 0, y: 0 },
              data: {
                label: isRealPage
                  ? shortLpLabel(lpResolved!)
                  : `Variação ${q + 1}`,
                kind: "pagina",
                cor: KIND_DEFAULT_COR.pagina,
                isPlaceholder: !isRealPage,
                meta: paginaMeta,
                onClick: () => onPickPagina(pageSlotId),
              },
            });
            edges.push({
              id: `e-${plano.id}-${pageSlotId}`,
              source: plano.id,
              target: pageSlotId,
              type: "smoothstep",
              style: {
                stroke: KIND_DEFAULT_COR.pagina,
                strokeWidth: isRealPage ? 1.2 : 1,
                strokeOpacity: isRealPage ? 0.7 : 0.35,
              },
            });
          }
        }
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
    nodesep: 18,
    ranksep: 90,
    edgesep: 8,
    marginx: 24,
    marginy: 24,
  });

  for (const n of nodes) {
    const size = NODE_SIZES[n.data.kind];
    g.setNode(n.id, { width: size.w, height: size.h + 8 });
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
}: {
  personas: Persona[];
  produtoId: number | null;
  onSelectPersona: (p: Persona) => void;
  onSelectAngulo: (a: Angulo) => void;
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
  const fitViewRef = useRef(fitView);
  useEffect(() => {
    onSelectPersonaRef.current = onSelectPersona;
    onSelectAnguloRef.current = onSelectAngulo;
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

  const onPickCriativoSlotRef = useRef(onPickCriativoSlot);
  const onPickPaginaSlotRef = useRef(onPickPaginaSlot);
  const onPreviewCriativoRef = useRef(onPreviewCriativoCb);
  useEffect(() => {
    onPickCriativoSlotRef.current = onPickCriativoSlot;
    onPickPaginaSlotRef.current = onPickPaginaSlot;
    onPreviewCriativoRef.current = onPreviewCriativoCb;
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
      (a) => onSelectAnguloRef.current(a),
      (slotId) => onPickCriativoSlotRef.current(slotId),
      (slotId) => onPickPaginaSlotRef.current(slotId),
      (criativoId, slotId) => onPreviewCriativoRef.current(criativoId, slotId),
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
          className="px-2.5 py-1 rounded-md bg-card border border-border text-[11px] font-medium text-foreground/70 hover:text-foreground hover:bg-muted transition-colors shadow-sm"
        >
          Recolher tudo
        </button>
        <button
          type="button"
          onClick={expandAll}
          className="px-2.5 py-1 rounded-md bg-card border border-border text-[11px] font-medium text-foreground/70 hover:text-foreground hover:bg-muted transition-colors shadow-sm"
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
        colorMode="dark"
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background gap={32} size={1} color="#27272a" />
        <Controls
          showInteractive={false}
          className="!bg-card !border !border-border [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground/70"
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
          {/* Mídia — ocupa altura proporcional ao formato (1:1 social, 9:16 video) */}
          <div className="bg-black grid place-items-center w-full" style={{ aspectRatio: isVideo ? "9 / 16" : "1 / 1", maxHeight: "70vh" }}>
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

export function PersonaMindMap({
  personas,
  produtoId,
  onSelect,
  onSelectAngulo,
}: {
  personas: Persona[];
  produtoId: number | null;
  onSelect: (p: Persona) => void;
  onSelectAngulo?: (a: Angulo) => void;
}) {
  const handleAngulo = onSelectAngulo ?? (() => {});
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
    : "rounded-lg border border-border bg-card overflow-hidden";
  const flowHeight = isFullscreen ? "flex-1" : "";
  const flowStyle: React.CSSProperties = isFullscreen
    ? { width: "100%", flex: 1, position: "relative" }
    : { width: "100%", height: 720, position: "relative" };

  return (
    <div className={wrapperClass}>
      <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-foreground/70">
          <span className="font-bold">Hierarquia:</span> Produto → 3 Personas →
          3 Ângulos → 3 Criativos → 2 Planos → 3 Páginas
        </div>
        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          className="px-2 py-1 rounded-md bg-card border border-border text-[11px] font-medium text-foreground/70 hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
          title={isFullscreen ? "Fechar (ESC)" : "Tela cheia"}
        >
          {isFullscreen ? <X className="size-3" /> : <Maximize2 className="size-3" />}
          {isFullscreen ? "Fechar" : "Tela cheia"}
        </button>
        <div className="flex items-center gap-3 text-[10px] text-foreground/50 font-mono">
          <span className="flex items-center gap-1">
            <span
              className="size-2 rounded border-2 border-solid"
              style={{ borderColor: "#10b981" }}
            />
            real
          </span>
          <span className="flex items-center gap-1">
            <span
              className="size-2 rounded border-2 border-dashed"
              style={{ borderColor: "#71717a" }}
            />
            placeholder
          </span>
          <span className="flex items-center gap-1">
            <ChevronRight className="size-3" />
            click pra expandir
          </span>
        </div>
      </div>
      <div style={flowStyle} className={flowHeight}>
        <ReactFlowProvider>
          <MindMapInner
            personas={personas}
            produtoId={produtoId}
            onSelectPersona={onSelect}
            onSelectAngulo={handleAngulo}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
