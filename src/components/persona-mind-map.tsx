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
  Target as TargetIcon,
  Megaphone,
  ImageIcon,
  CreditCard,
  FileText,
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
  meta?: string | null; // info extra (status, ROAS, etc.)
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
  "plano-com": "PLANO",
  "plano-sem": "PLANO",
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
  root: "#10b981", // emerald
  persona: "#71717a",
  angulo: "#f59e0b", // amber
  criativo: "#06b6d4", // cyan
  "plano-com": "#a855f7", // purple
  "plano-sem": "#ec4899", // pink
  pagina: "#3b82f6", // blue
};

const NODE_SIZES: Record<NodeKind, { w: number; h: number }> = {
  root: { w: 200, h: 60 },
  persona: { w: 220, h: 70 },
  angulo: { w: 200, h: 60 },
  criativo: { w: 180, h: 56 },
  "plano-com": { w: 160, h: 50 },
  "plano-sem": { w: 160, h: 50 },
  pagina: { w: 140, h: 44 },
};

// ====================== Node component ======================

function MindMapNode({ data }: NodeProps<MindNode>) {
  const cor = data.cor ?? KIND_DEFAULT_COR[data.kind];
  const Icon = KIND_ICON[data.kind];
  const isRoot = data.kind === "root";
  const isPersona = data.kind === "persona";
  const placeholder = data.isPlaceholder;

  const size = NODE_SIZES[data.kind];

  return (
    <div
      onClick={data.onClick}
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
        className="!w-1.5 !h-1.5 !bg-foreground/40 !border-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-1.5 !h-1.5 !bg-foreground/40 !border-0"
      />

      <div
        className={`rounded-md px-2.5 py-1.5 transition-all hover:brightness-110 ${
          placeholder ? "border-dashed" : ""
        }`}
        style={{
          borderWidth: 2,
          borderStyle: placeholder ? "dashed" : "solid",
          borderColor: placeholder ? `${cor}50` : cor,
          background: isRoot
            ? cor
            : placeholder
              ? "transparent"
              : `${cor}10`,
          opacity: placeholder ? 0.55 : 1,
          boxShadow: isRoot ? `0 0 24px ${cor}66` : "none",
        }}
      >
        {/* Label header */}
        <div
          className="text-[8px] font-bold tracking-[1.5px] uppercase mb-0.5 leading-tight"
          style={{
            color: isRoot ? "#000" : cor,
            opacity: isRoot ? 0.7 : placeholder ? 0.6 : 0.85,
          }}
        >
          // {KIND_LABEL[data.kind]}
        </div>

        {/* Body */}
        <div
          className="font-sans text-[12px] font-semibold leading-tight"
          style={{
            color: isRoot ? "#000" : placeholder ? "#a1a1aa" : "#fafafa",
          }}
        >
          <div className="flex items-start gap-1.5">
            {Icon ? (
              <span
                className="shrink-0 mt-px"
                style={{ color: isRoot ? "#000" : cor, opacity: placeholder ? 0.6 : 1 }}
              >
                <Icon className="size-3" />
              </span>
            ) : null}
            <span className="break-words leading-snug">{data.label}</span>
          </div>
          {/* Métricas extras pra persona */}
          {isPersona && (data.pct != null || data.prioridade) && !placeholder ? (
            <div
              className="mt-0.5 text-[9px] font-medium font-mono"
              style={{ color: cor, opacity: 0.85 }}
            >
              {data.prioridade ? data.prioridade.toUpperCase() : ""}
              {data.prioridade && data.pct != null ? " · " : ""}
              {data.pct != null ? `${Math.round(data.pct)}% público` : ""}
            </div>
          ) : null}
          {/* Meta extra (status / ROAS) */}
          {data.meta && !placeholder ? (
            <div
              className="mt-0.5 text-[9px] font-mono"
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

// ====================== Tree generator (5-level hierarchy) ======================

const PERSONAS_LIMIT = 3;
const ANGULOS_LIMIT = 3;
const CRIATIVOS_LIMIT = 3;
const PAGINAS_LIMIT = 3;

type RawTree = { nodes: MindNode[]; edges: Edge[] };

function buildBlueprintTree(
  personas: Persona[],
  angulos: Angulo[],
  onSelectPersona: (p: Persona) => void,
  onSelectAngulo: (a: Angulo) => void,
): RawTree {
  const nodes: MindNode[] = [];
  const edges: Edge[] = [];

  // ROOT
  const ROOT_ID = "root";
  nodes.push({
    id: ROOT_ID,
    type: "mind",
    position: { x: 0, y: 0 },
    data: { label: "Gravyx", kind: "root" },
  });

  // 3 personas (top by prioridade), pad with placeholders
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
        onClick: p ? () => onSelectPersona(p) : undefined,
      },
    });
    edges.push({
      id: `e-${ROOT_ID}-${personaId}`,
      source: ROOT_ID,
      target: personaId,
      animated: !isPersonaPlaceholder && p?.prioridade === "primaria",
      style: {
        stroke: personaCor,
        strokeWidth: 1.5,
        strokeOpacity: isPersonaPlaceholder ? 0.4 : 1,
      },
    });

    // 3 ângulos por persona
    const personaAngulos = p
      ? angulos
          .filter((a) => a.personaId === p.id)
          .sort((a, b) => a.id - b.id)
      : [];

    for (let j = 0; j < ANGULOS_LIMIT; j++) {
      const a = personaAngulos[j];
      const anguloId = a ? `a-${a.id}` : `${personaId}-a-ph-${j}`;
      const anguloCor = KIND_DEFAULT_COR.angulo;
      const isAnguloPlaceholder = !a;

      const anguloMeta = a
        ? [
            a.status,
            a.roas != null ? `${a.roas.toFixed(1)}x` : null,
          ]
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
          onClick: a ? () => onSelectAngulo(a) : undefined,
        },
      });
      edges.push({
        id: `e-${personaId}-${anguloId}`,
        source: personaId,
        target: anguloId,
        style: {
          stroke: anguloCor,
          strokeWidth: 1.2,
          strokeOpacity: isAnguloPlaceholder ? 0.4 : 0.9,
        },
      });

      // 3 criativos por ângulo
      const anguloCriativos = a?.criativos ?? [];
      for (let k = 0; k < CRIATIVOS_LIMIT; k++) {
        const c = anguloCriativos[k];
        const criativoId = c ? `c-${c.id}` : `${anguloId}-c-ph-${k}`;
        const criativoCor = KIND_DEFAULT_COR.criativo;
        const isCriativoPlaceholder = !c;

        nodes.push({
          id: criativoId,
          type: "mind",
          position: { x: 0, y: 0 },
          data: {
            label:
              c?.headlineOverlay?.slice(0, 40) ??
              (c ? `Criativo ${c.id}` : `Criativo ${k + 1}`),
            kind: "criativo",
            cor: criativoCor,
            isPlaceholder: isCriativoPlaceholder,
          },
        });
        edges.push({
          id: `e-${anguloId}-${criativoId}`,
          source: anguloId,
          target: criativoId,
          style: {
            stroke: criativoCor,
            strokeWidth: 1.1,
            strokeOpacity: isCriativoPlaceholder ? 0.35 : 0.85,
          },
        });

        // 2 planos (com / sem créditos)
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
          // Plano sempre placeholder por enquanto (não tem dado backing)
          nodes.push({
            id: plano.id,
            type: "mind",
            position: { x: 0, y: 0 },
            data: {
              label: plano.label,
              kind: plano.kind,
              cor: plano.cor,
              isPlaceholder: true,
            },
          });
          edges.push({
            id: `e-${criativoId}-${plano.id}`,
            source: criativoId,
            target: plano.id,
            style: {
              stroke: plano.cor,
              strokeWidth: 1,
              strokeOpacity: 0.35,
            },
          });

          // 3 páginas por plano (placeholders)
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
              style: {
                stroke: KIND_DEFAULT_COR.pagina,
                strokeWidth: 0.8,
                strokeOpacity: 0.3,
              },
            });
          }
        }
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
    nodesep: 8, // tighter — muitos nós
    ranksep: 80,
    edgesep: 4,
    marginx: 20,
    marginy: 20,
  });

  for (const n of nodes) {
    const size = NODE_SIZES[n.data.kind];
    g.setNode(n.id, { width: size.w, height: size.h });
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

  const { data: angulos = [] } = useQuery({
    queryKey: ["angulos", produtoId],
    queryFn: () =>
      api.get<Angulo[]>(
        `/api/angulos${produtoId ? `?produtoId=${produtoId}` : ""}`,
      ),
    enabled: produtoId != null,
  });

  useEffect(() => {
    const tree = buildBlueprintTree(
      personas,
      angulos,
      onSelectPersona,
      onSelectAngulo,
    );
    const laid = layoutTree(tree.nodes, tree.edges);
    setNodes(laid.nodes);
    setEdges(laid.edges);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitView({ padding: 0.1, duration: 250 });
      });
    });
  }, [personas, angulos, onSelectPersona, onSelectAngulo, fitView]);

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
      fitViewOptions={{ padding: 0.1 }}
      minZoom={0.05}
      maxZoom={2}
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
        nodeColor={(n) => {
          const d = n.data as MindNodeData;
          return d.cor ?? KIND_DEFAULT_COR[d.kind] ?? "#71717a";
        }}
        nodeStrokeWidth={1}
        maskColor="rgba(0,0,0,0.6)"
      />
    </ReactFlow>
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
      <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between gap-3">
        <div className="text-xs text-foreground/70">
          <span className="font-bold">Hierarquia:</span> Produto → 3 Personas →
          3 Ângulos → 3 Criativos → 2 Planos (Com/Sem créditos) → 3 Páginas
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
        </div>
      </div>
      <div style={{ width: "100%", height: 700 }}>
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
