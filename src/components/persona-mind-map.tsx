import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
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
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
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
  root: { w: 240, h: 80 },
  persona: { w: 240, h: 86 },
  angulo: { w: 220, h: 76 },
  criativo: { w: 200, h: 70 },
  "plano-com": { w: 180, h: 60 },
  "plano-sem": { w: 180, h: 60 },
  pagina: { w: 160, h: 52 },
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

function buildBlueprintTree(
  personas: Persona[],
  angulos: Angulo[],
  expanded: Set<string>,
  toggle: (id: string) => void,
  onSelectPersona: (p: Persona) => void,
  onSelectAngulo: (a: Angulo) => void,
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

  for (let i = 0; i < PERSONAS_LIMIT; i++) {
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

    const personaAngulos = p
      ? angulos.filter((a) => a.personaId === p.id).sort((a, b) => a.id - b.id)
      : [];

    for (let j = 0; j < ANGULOS_LIMIT; j++) {
      const a = personaAngulos[j];
      const anguloId = a ? `a-${a.id}` : `${personaId}-a-ph-${j}`;
      const anguloCor = KIND_DEFAULT_COR.angulo;
      const isAnguloPlaceholder = !a;
      const anguloExpanded = expanded.has(anguloId);
      const anguloMeta = a
        ? [a.status, a.roas != null ? `${a.roas.toFixed(1)}x ROAS` : null]
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

      const anguloCriativos = a?.criativos ?? [];
      for (let k = 0; k < CRIATIVOS_LIMIT; k++) {
        const c = anguloCriativos[k];
        const criativoId = c ? `c-${c.id}` : `${anguloId}-c-ph-${k}`;
        const criativoCor = KIND_DEFAULT_COR.criativo;
        const isCriativoPlaceholder = !c;
        const criativoExpanded = expanded.has(criativoId);

        nodes.push({
          id: criativoId,
          type: "mind",
          position: { x: 0, y: 0 },
          data: {
            label:
              c?.headlineOverlay?.slice(0, 36) ??
              (c ? `Criativo ${c.id}` : `Criativo ${k + 1}`),
            kind: "criativo",
            cor: criativoCor,
            isPlaceholder: isCriativoPlaceholder,
            hasChildren: true,
            expanded: criativoExpanded,
            childCount: 2, // 2 planos
            onToggle: () => toggle(criativoId),
          },
        });
        edges.push({
          id: `e-${anguloId}-${criativoId}`,
          source: anguloId,
          target: criativoId,
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
            id: `${criativoId}-pcom`,
            label: "Com Créditos",
            kind: "plano-com",
            cor: KIND_DEFAULT_COR["plano-com"],
          },
          {
            id: `${criativoId}-psem`,
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
            id: `e-${criativoId}-${plano.id}`,
            source: criativoId,
            target: plano.id,
            type: "smoothstep",
            style: {
              stroke: plano.cor,
              strokeWidth: 1.2,
              strokeOpacity: 0.5,
            },
          });

          if (!planoExpanded) continue;

          for (let q = 0; q < PAGINAS_LIMIT; q++) {
            const pageId = `${plano.id}-pg-${q}`;
            nodes.push({
              id: pageId,
              type: "mind",
              position: { x: 0, y: 0 },
              data: {
                label: `Página ${q + 1}`,
                kind: "pagina",
                cor: KIND_DEFAULT_COR.pagina,
                isPlaceholder: true,
              },
            });
            edges.push({
              id: `e-${plano.id}-${pageId}`,
              source: plano.id,
              target: pageId,
              type: "smoothstep",
              style: {
                stroke: KIND_DEFAULT_COR.pagina,
                strokeWidth: 1,
                strokeOpacity: 0.4,
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
  const [nodes, setNodes] = useState<MindNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

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

  // Refs pra callbacks instáveis (props inline do parent re-criam toda render).
  // Evita loop infinito no useEffect que monta o tree.
  const onSelectPersonaRef = useRef(onSelectPersona);
  const onSelectAnguloRef = useRef(onSelectAngulo);
  const fitViewRef = useRef(fitView);
  useEffect(() => {
    onSelectPersonaRef.current = onSelectPersona;
    onSelectAnguloRef.current = onSelectAngulo;
    fitViewRef.current = fitView;
  });

  useEffect(() => {
    const tree = buildBlueprintTree(
      personas,
      angulos,
      expanded,
      toggle,
      (p) => onSelectPersonaRef.current(p),
      (a) => onSelectAnguloRef.current(a),
    );
    const laid = layoutTree(tree.nodes, tree.edges);
    setNodes(laid.nodes);
    setEdges(laid.edges);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitViewRef.current({ padding: 0.15, duration: 350 });
      });
    });
  }, [personas, angulos, expanded, toggle]);

  const onNodesChange = useCallback((changes: NodeChange<MindNode>[]) => {
    // Filtra changes de 'dimensions' — React Flow as dispara medindo DOM,
    // e quando combinado com layout dagre que reseta posições, gera loop
    // infinito (medição → setNodes → re-render → medição diferente → ...).
    const filtered = changes.filter((c) => c.type !== "dimensions");
    if (filtered.length === 0) return;
    setNodes((nds) => applyNodeChanges(filtered, nds));
  }, []);

  const flowNodes = useMemo(() => nodes, [nodes]);

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
        nodes={flowNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background gap={32} size={1} color="#27272a" />
        <Controls
          showInteractive={false}
          className="!bg-card !border !border-border [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground/70"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const d = n.data as MindNodeData;
            return d.cor ?? KIND_DEFAULT_COR[d.kind] ?? "#71717a";
          }}
          nodeStrokeWidth={1}
          maskColor="rgba(0,0,0,0.7)"
          className="!bg-card !border !border-border"
        />
      </ReactFlow>
    </>
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
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-foreground/70">
          <span className="font-bold">Hierarquia:</span> Produto → 3 Personas →
          3 Ângulos → 3 Criativos → 2 Planos → 3 Páginas
        </div>
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
      <div style={{ width: "100%", height: 720, position: "relative" }}>
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
