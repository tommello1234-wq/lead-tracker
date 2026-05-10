import { useCallback, useEffect, useMemo, useState } from "react";
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
  ChevronDown,
  ChevronRight,
  Frown,
  Heart,
  Lightbulb,
  Megaphone,
  ShieldAlert,
  Target as TargetIcon,
} from "lucide-react";
import type { Persona, PersonaPrioridade } from "@shared/types";

// ====================== Types ======================

type NodeKind =
  | "root" // Produto (Gravyx)
  | "persona"
  | "dor"
  | "desejo"
  | "mensagem"
  | "objecao-grupo"
  | "objecao-item"
  | "lp-grupo"
  | "lp-item";

type MindNodeData = {
  label: string;
  kind: NodeKind;
  cor?: string;
  prioridade?: PersonaPrioridade;
  pct?: number | null;
  collapsed?: boolean;
  hasChildren?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
};

type MindNode = Node<MindNodeData>;

// ====================== Node component ======================

const KIND_LABEL: Record<NodeKind, string> = {
  root: "ROOT",
  persona: "PERSONA",
  dor: "DOR",
  desejo: "DESEJO",
  mensagem: "MENSAGEM",
  "objecao-grupo": "OBJEÇÕES",
  "objecao-item": "OBJEÇÃO",
  "lp-grupo": "LPs",
  "lp-item": "LP",
};

const KIND_ICON: Record<NodeKind, React.ComponentType<{ className?: string }> | null> = {
  root: TargetIcon,
  persona: null, // usa a cor da persona, sem ícone
  dor: Frown,
  desejo: Heart,
  mensagem: Lightbulb,
  "objecao-grupo": ShieldAlert,
  "objecao-item": ShieldAlert,
  "lp-grupo": Megaphone,
  "lp-item": Megaphone,
};

function MindMapNode({ data }: NodeProps<MindNode>) {
  const cor = data.cor ?? defaultColorForKind(data.kind);
  const Icon = KIND_ICON[data.kind];
  const isRoot = data.kind === "root";
  const isPersona = data.kind === "persona";

  return (
    <div
      onClick={(e) => {
        // só trata click no body — não no botão de toggle
        const target = e.target as HTMLElement;
        if (target.closest("[data-toggle]")) return;
        data.onClick?.();
      }}
      className={`relative font-mono text-xs select-none ${
        data.onClick ? "cursor-pointer" : ""
      }`}
      style={{
        minWidth: isRoot ? 200 : 220,
        maxWidth: 320,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-1.5 !h-1.5 !bg-foreground/40 !border-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-1.5 !h-1.5 !bg-foreground/40 !border-0"
      />

      <div
        className="rounded-md border-2 px-3 py-2 transition-all hover:brightness-110"
        style={{
          borderColor: cor,
          background: isRoot ? cor : `${cor}10`,
          boxShadow: isRoot
            ? `0 0 24px ${cor}66`
            : `inset 0 0 0 9999px ${cor}06`,
        }}
      >
        {/* Header // NÓ */}
        <div
          className="text-[9px] font-bold tracking-[2px] uppercase mb-1 flex items-center justify-between gap-2"
          style={{ color: isRoot ? "#000" : cor, opacity: isRoot ? 0.7 : 0.85 }}
        >
          <span>// {KIND_LABEL[data.kind]}</span>
          {data.hasChildren ? (
            <button
              type="button"
              data-toggle="1"
              onClick={(e) => {
                e.stopPropagation();
                data.onToggle?.();
              }}
              className="size-4 grid place-items-center rounded-sm hover:bg-foreground/10"
              style={{ color: isRoot ? "#000" : cor }}
              title={data.collapsed ? "Expandir" : "Recolher"}
            >
              {data.collapsed ? (
                <ChevronRight className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </button>
          ) : null}
        </div>

        {/* Body */}
        <div
          className="font-sans text-[13px] font-semibold leading-snug"
          style={{ color: isRoot ? "#000" : "#fafafa" }}
        >
          <div className="flex items-start gap-2">
            {Icon ? (
              <span
                className="shrink-0 mt-0.5"
                style={{ color: isRoot ? "#000" : cor }}
              >
                <Icon className="size-4" />
              </span>
            ) : null}
            <span className="break-words">{data.label}</span>
          </div>
          {/* Métricas extras pra persona */}
          {isPersona && (data.pct != null || data.prioridade) ? (
            <div
              className="mt-1.5 text-[10px] font-medium font-mono"
              style={{ color: cor, opacity: 0.85 }}
            >
              {data.prioridade ? data.prioridade.toUpperCase() : ""}
              {data.prioridade && data.pct != null ? " · " : ""}
              {data.pct != null ? `${Math.round(data.pct)}% público` : ""}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function defaultColorForKind(kind: NodeKind): string {
  switch (kind) {
    case "root":
      return "#10b981"; // emerald
    case "dor":
      return "#ef4444"; // red
    case "desejo":
      return "#22c55e"; // green
    case "mensagem":
      return "#f59e0b"; // amber
    case "objecao-grupo":
    case "objecao-item":
      return "#a855f7"; // purple
    case "lp-grupo":
    case "lp-item":
      return "#06b6d4"; // cyan
    default:
      return "#71717a"; // zinc
  }
}

const nodeTypes: NodeTypes = { mind: MindMapNode };

// ====================== Tree gen ======================

type RawTree = {
  nodes: MindNode[];
  edges: Edge[];
};

function buildTree(
  personas: Persona[],
  collapsedIds: Set<string>,
  onToggle: (id: string) => void,
  onSelect: (p: Persona) => void,
): RawTree {
  const nodes: MindNode[] = [];
  const edges: Edge[] = [];

  const ROOT_ID = "root";
  nodes.push({
    id: ROOT_ID,
    type: "mind",
    position: { x: 0, y: 0 },
    data: {
      label: "Gravyx",
      kind: "root",
      hasChildren: personas.length > 0,
      collapsed: collapsedIds.has(ROOT_ID),
      onToggle: () => onToggle(ROOT_ID),
    },
  });

  if (collapsedIds.has(ROOT_ID)) return { nodes, edges };

  for (const p of personas) {
    const personaId = `p-${p.id}`;
    const personaCor = p.cor ?? "#71717a";
    const personaCollapsed = collapsedIds.has(personaId);

    const childrenSlots: { kind: NodeKind; label: string; items?: string[] }[] = [];
    if (p.dor) childrenSlots.push({ kind: "dor", label: p.dor });
    if (p.desejo) childrenSlots.push({ kind: "desejo", label: p.desejo });
    if (p.mensagemChave)
      childrenSlots.push({ kind: "mensagem", label: p.mensagemChave });
    if (p.objecoes && p.objecoes.length > 0)
      childrenSlots.push({
        kind: "objecao-grupo",
        label: `${p.objecoes.length} objeção(ões)`,
        items: p.objecoes,
      });
    if (p.lps && p.lps.length > 0)
      childrenSlots.push({
        kind: "lp-grupo",
        label: `${p.lps.length} LP${p.lps.length > 1 ? "s" : ""}`,
        items: p.lps,
      });

    nodes.push({
      id: personaId,
      type: "mind",
      position: { x: 0, y: 0 },
      data: {
        label: p.nome,
        kind: "persona",
        cor: personaCor,
        prioridade: p.prioridade,
        pct: p.pctPublicoAtual,
        hasChildren: childrenSlots.length > 0,
        collapsed: personaCollapsed,
        onToggle: () => onToggle(personaId),
        onClick: () => onSelect(p),
      },
    });

    edges.push({
      id: `e-${ROOT_ID}-${personaId}`,
      source: ROOT_ID,
      target: personaId,
      animated: p.prioridade === "primaria",
      style: {
        stroke: personaCor,
        strokeWidth: p.prioridade === "primaria" ? 2.5 : 1.5,
      },
    });

    if (personaCollapsed) continue;

    for (const slot of childrenSlots) {
      const slotId = `${personaId}-${slot.kind}`;
      const slotCollapsed = collapsedIds.has(slotId);
      const isLeaf = !slot.items;

      nodes.push({
        id: slotId,
        type: "mind",
        position: { x: 0, y: 0 },
        data: {
          label: slot.label,
          kind: slot.kind,
          cor: defaultColorForKind(slot.kind),
          hasChildren: slot.items ? slot.items.length > 0 : false,
          collapsed: slotCollapsed,
          onToggle: !isLeaf ? () => onToggle(slotId) : undefined,
        },
      });
      edges.push({
        id: `e-${personaId}-${slotId}`,
        source: personaId,
        target: slotId,
        style: { stroke: defaultColorForKind(slot.kind), strokeWidth: 1.2 },
      });

      if (slot.items && !slotCollapsed) {
        slot.items.forEach((item, idx) => {
          const itemKind: NodeKind =
            slot.kind === "objecao-grupo" ? "objecao-item" : "lp-item";
          const itemId = `${slotId}-${idx}`;
          nodes.push({
            id: itemId,
            type: "mind",
            position: { x: 0, y: 0 },
            data: {
              label: item,
              kind: itemKind,
              cor: defaultColorForKind(itemKind),
            },
          });
          edges.push({
            id: `e-${slotId}-${itemId}`,
            source: slotId,
            target: itemId,
            style: {
              stroke: defaultColorForKind(itemKind),
              strokeWidth: 1,
              strokeOpacity: 0.6,
            },
          });
        });
      }
    }
  }

  return { nodes, edges };
}

// ====================== Layout (dagre, LR) ======================

function layoutTree(
  nodes: MindNode[],
  edges: Edge[],
): { nodes: MindNode[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph({ multigraph: false }).setDefaultEdgeLabel(
    () => ({}),
  );
  g.setGraph({
    rankdir: "LR",
    nodesep: 24,
    ranksep: 90,
    edgesep: 12,
    marginx: 20,
    marginy: 20,
  });

  // Largura/altura aproximadas dos cards (necessário pra dagre).
  for (const n of nodes) {
    const isRoot = n.data.kind === "root";
    g.setNode(n.id, {
      width: isRoot ? 220 : 260,
      height: 70,
    });
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

function MindMapInner({
  personas,
  onSelect,
}: {
  personas: Persona[];
  onSelect: (p: Persona) => void;
}) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [nodes, setNodes] = useState<MindNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const { fitView } = useReactFlow();

  const toggle = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Recalcula árvore + layout sempre que muda persona ou colapso
  useEffect(() => {
    const tree = buildTree(personas, collapsedIds, toggle, onSelect);
    const laid = layoutTree(tree.nodes, tree.edges);
    setNodes(laid.nodes);
    setEdges(laid.edges);
    // fitView roda após o paint (quando React Flow já mediu os nós).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitView({ padding: 0.15, duration: 250 });
      });
    });
  }, [personas, collapsedIds, toggle, onSelect, fitView]);

  const onNodesChange = useCallback((changes: NodeChange<MindNode>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const flowNodes = useMemo(() => nodes, [nodes]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => (n.data as MindNodeData).cor ?? "#71717a"}
        nodeStrokeWidth={2}
        maskColor="rgba(0,0,0,0.6)"
      />
    </ReactFlow>
  );
}

export function PersonaMindMap({
  personas,
  onSelect,
}: {
  personas: Persona[];
  onSelect: (p: Persona) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div style={{ width: "100%", height: 700 }}>
        <ReactFlowProvider>
          <MindMapInner personas={personas} onSelect={onSelect} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
