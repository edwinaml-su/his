"use client";

/**
 * WorkflowGraph — Canvas drag-and-drop del Workflow Designer.
 *
 * US.F2.2.01 — Lienzo drag-and-drop base con React Flow.
 *   - Lee estados/transiciones via props (cargados por el padre).
 *   - Posiciones: primero intenta BD (getLayout), fallback dagre.
 *   - Drag para reposicionar; onDragEnd persiste en BD via setLayout.
 *   - Zoom/pan nativos de React Flow.
 *   - Selección de nodo/arista → emite onSelectNode / onSelectEdge.
 *   - Drop desde paleta (application/reactflow-tipo) → emite onDropNewNode.
 *
 * US.F2.2.04 — Auto-layout dagre con animación 300ms.
 *   - El padre llama triggerAutoLayout() vía ref.
 *   - Reposiciona con transición CSS (React Flow animateNodes).
 *   - Persiste posiciones en BD tras el layout.
 *
 * Decisiones de diseño:
 *   - Posiciones en BD (ece.workflow_estado_layout) son source of truth.
 *   - localStorage fue descartado a favor de BD para soporte multi-device.
 *   - snapToGrid 20px para alineación precisa.
 *   - Nodos custom con colores semánticos por tipo.
 */

import * as React from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type NodeProps,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
  type XYPosition,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "@dagrejs/dagre";
import { trpc } from "@/lib/trpc/react";

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export interface EstadoRow {
  id: string;
  codigo: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
}

export interface TransicionRow {
  id: string;
  estado_origen_id: string;
  estado_destino_id: string;
  accion: string;
  requiere_firma: boolean;
  rol_codigo?: string;
  rol_autoriza_id?: string;
}

export interface WorkflowGraphHandle {
  triggerAutoLayout: () => void;
  fitView: () => void;
}

interface WorkflowGraphProps {
  tipDocumentoId: string;
  estados: EstadoRow[];
  transiciones: TransicionRow[];
  tipDocCodigo: string;
  readOnly?: boolean;
  /** Emitido cuando el usuario selecciona un nodo. */
  onSelectNode?: (estado: EstadoRow | null) => void;
  /** Emitido cuando el usuario selecciona una arista. */
  onSelectEdge?: (transicion: TransicionRow | null) => void;
  /** Emitido cuando un drag desde paleta crea un nodo nuevo. */
  onDropNewNode?: (tipo: string, position: XYPosition) => void;
}

// ─── Constantes ────────────────────────────────────────────────────────────────

const SNAP_GRID: [number, number] = [20, 20];
const NODE_W = 160;
const NODE_H = 52;

// ─── Colores semánticos ───────────────────────────────────────────────────────

function nodeStyle(es_inicial: boolean, es_final: boolean) {
  if (es_inicial)
    return { background: "#dcfce7", border: "1.5px solid #16a34a", color: "#15803d" };
  if (es_final)
    return { background: "#dbeafe", border: "1.5px solid #2563eb", color: "#1d4ed8" };
  return { background: "#f3f4f6", border: "1.5px solid #9ca3af", color: "#374151" };
}

// ─── Nodo custom ─────────────────────────────────────────────────────────────

interface EstadoNodeData {
  label: string;
  codigo: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
  onSelect: (id: string) => void;
}

function EstadoNode({ id, data }: NodeProps<EstadoNodeData>) {
  const style = nodeStyle(data.es_inicial, data.es_final);
  const badge = data.es_inicial ? "INICIAL" : data.es_final ? "FINAL" : null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Estado ${data.label}${data.es_inicial ? ", estado inicial" : ""}${data.es_final ? ", estado final" : ""}`}
      onClick={() => data.onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          data.onSelect(id);
        }
      }}
      style={{
        ...style,
        borderRadius: 8,
        padding: "6px 12px",
        width: NODE_W,
        minHeight: NODE_H,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {badge && (
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 2, opacity: 0.75 }}>
          {badge}
        </span>
      )}
      <span style={{ fontWeight: 600, fontSize: 13, textAlign: "center" }}>
        {data.label}
      </span>
      <span style={{ fontSize: 10, opacity: 0.6 }}>{data.codigo}</span>

      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { estado: EstadoNode };

// ─── Auto-layout dagre ────────────────────────────────────────────────────────

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 100, nodesep: 60 });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

// ─── Inner component (requiere ReactFlowProvider) ─────────────────────────────

const WorkflowGraphInner = React.forwardRef<WorkflowGraphHandle, WorkflowGraphProps>(
  function WorkflowGraphInner(
    {
      tipDocumentoId,
      estados,
      transiciones,
      tipDocCodigo,
      readOnly = false,
      onSelectNode,
      onSelectEdge,
      onDropNewNode,
    },
    ref,
  ) {
    const { fitView, screenToFlowPosition } = useReactFlow();
    const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

    // ── Cargar posiciones desde BD ───────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: layoutData } = (trpc as any).workflowEstado.estado.getLayout.useQuery(
      { tipDocumentoId },
      { enabled: !!tipDocumentoId },
    );

    // ── Mutation: persistir posición tras drag ───────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setLayoutMutation = (trpc as any).workflowEstado.estado.setLayout.useMutation();

    // ── Construir nodes/edges ────────────────────────────────────────────────
    const estadoMap = React.useMemo(
      () => new Map(estados.map((e) => [e.id, e])),
      [estados],
    );

    const { initialNodes, initialEdges } = React.useMemo(() => {
      const positions: Record<string, { x: number; y: number }> = layoutData ?? {};

      const placeholder = () => {};

      const rawNodes: Node<EstadoNodeData>[] = estados.map((e) => ({
        id: e.id,
        type: "estado",
        position: positions[e.id] ?? { x: 0, y: 0 },
        data: {
          label: e.nombre,
          codigo: e.codigo,
          es_inicial: e.es_inicial,
          es_final: e.es_final,
          orden: e.orden,
          onSelect: placeholder as EstadoNodeData["onSelect"],
        },
        draggable: !readOnly,
      }));

      const rawEdges: Edge[] = transiciones.map((t) => ({
        id: t.id,
        source: t.estado_origen_id,
        target: t.estado_destino_id,
        label: t.rol_codigo ? `${t.accion} (${t.rol_codigo})` : t.accion,
        animated: t.requiere_firma,
        style: { strokeWidth: 1.5 },
        labelStyle: { fontSize: 10 },
      }));

      // Si no hay posiciones en BD, usar dagre
      const hasBdPositions = estados.length > 0 && estados.every((e) => !!positions[e.id]);
      const layoutedNodes = hasBdPositions ? rawNodes : applyDagreLayout(rawNodes, rawEdges);

      return { initialNodes: layoutedNodes, initialEdges: rawEdges };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [estados, transiciones, layoutData, readOnly]);

    const [nodes, setNodes] = React.useState<Node[]>(initialNodes);
    const [edges, setEdges] = React.useState<Edge[]>(initialEdges);

    // Sync when data changes from parent refetch
    React.useEffect(() => {
      setNodes((prev) =>
        initialNodes.map((n) => {
          const existing = prev.find((p) => p.id === n.id);
          // preserve position if already dragged in this session
          return existing
            ? { ...n, position: existing.position, data: { ...n.data, onSelect: handleNodeClick } }
            : { ...n, data: { ...n.data, onSelect: handleNodeClick } };
        }),
      );
      setEdges(initialEdges);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialNodes, initialEdges]);

    // ── Handlers de selección ────────────────────────────────────────────────

    function handleNodeClick(id: string) {
      const estado = estadoMap.get(id) ?? null;
      onSelectNode?.(estado);
      onSelectEdge?.(null);
    }

    function handleEdgeClick(_: React.MouseEvent, edge: Edge) {
      const transicion = transiciones.find((t) => t.id === edge.id) ?? null;
      onSelectEdge?.(transicion);
      onSelectNode?.(null);
    }

    // ── Cambios de nodos ──────────────────────────────────────────────────────

    function handleNodesChange(changes: NodeChange[]) {
      setNodes((nds) => {
        const updated = applyNodeChanges(changes, nds);
        // Detectar fin de drag: type==="position" + dragging===false
        changes.forEach((c) => {
          if (c.type === "position" && !c.dragging && c.id) {
            const n = updated.find((u: Node) => u.id === c.id);
            if (n && !readOnly) {
              setLayoutMutation.mutate({
                estadoId: n.id,
                x: n.position.x,
                y: n.position.y,
              });
            }
          }
        });
        return updated;
      });
    }

    function handleEdgesChange(changes: EdgeChange[]) {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    }

    function handleConnect(connection: Connection) {
      if (readOnly) return;
      const estadoIds = new Set(estados.map((e) => e.id));
      if (
        !connection.target ||
        !estadoIds.has(connection.target) ||
        !estadoIds.has(connection.source ?? "")
      )
        return;
      if (connection.source === connection.target) return;
      setEdges((eds) => addEdge(connection, eds));
    }

    // ── Drop desde paleta ────────────────────────────────────────────────────

    function handleDragOver(event: React.DragEvent) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }

    function handleDrop(event: React.DragEvent) {
      event.preventDefault();
      const tipo = event.dataTransfer.getData("application/reactflow-tipo");
      if (!tipo || readOnly) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onDropNewNode?.(tipo, position);
    }

    // ── Auto-layout dagre con animación 300ms ─────────────────────────────────

    function triggerAutoLayout() {
      setNodes((nds) => {
        const laid = applyDagreLayout(nds, edges);
        // Persistir todas las posiciones en BD
        laid.forEach((n) => {
          setLayoutMutation.mutate({ estadoId: n.id, x: n.position.x, y: n.position.y });
        });
        return laid;
      });
      // fitView después de la animación CSS de React Flow (300ms)
      setTimeout(() => void fitView({ padding: 0.2, duration: 300 }), 320);
    }

    // ── Exponer handle al padre ──────────────────────────────────────────────

    React.useImperativeHandle(ref, () => ({
      triggerAutoLayout,
      fitView: () => void fitView({ padding: 0.2, duration: 300 }),
    }));

    // Inyectar handlers reales en nodes
    const nodesWithHandlers = React.useMemo(
      () =>
        nodes.map((n) => ({
          ...n,
          data: { ...n.data, onSelect: handleNodeClick },
        })),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [nodes],
    );

    return (
      <div
        className="relative w-full h-full"
        data-testid="workflow-graph-container"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <ReactFlow
          nodes={nodesWithHandlers}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onEdgeClick={handleEdgeClick}
          snapToGrid={!readOnly}
          snapGrid={SNAP_GRID}
          defaultViewport={{ x: 40, y: 40, zoom: isMobile ? 0.7 : 1 }}
          fitView={!isMobile}
          fitViewOptions={{ padding: 0.2 }}
          attributionPosition="bottom-right"
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          aria-label="Grafo de estados y transiciones del workflow"
        >
          <Background gap={20} size={1} color="#e5e7eb" />
          <Controls />
          <MiniMap
            nodeColor={(n: Node) => {
              const d = n.data as EstadoNodeData;
              if (d.es_inicial) return "#16a34a";
              if (d.es_final) return "#2563eb";
              return "#9ca3af";
            }}
            style={{ bottom: 40, right: 8 }}
          />
        </ReactFlow>
      </div>
    );
  },
);

// ─── Export público (envuelto en ReactFlowProvider) ───────────────────────────

export const WorkflowGraph = React.forwardRef<WorkflowGraphHandle, WorkflowGraphProps>(
  function WorkflowGraph(props, ref) {
    return (
      <ReactFlowProvider>
        <WorkflowGraphInner ref={ref} {...props} />
      </ReactFlowProvider>
    );
  },
);
