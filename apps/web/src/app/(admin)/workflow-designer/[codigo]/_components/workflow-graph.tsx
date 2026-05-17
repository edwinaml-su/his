"use client";

/**
 * WorkflowGraph — Visualizador de estados y transiciones con ReactFlow + dagre.
 *
 * Decisiones de diseño:
 *  - Auto-layout con dagre (rankdir=LR) para legibilidad en flujos lineales.
 *  - Posiciones sobreescritas por localStorage (clave: `wf-positions-<tipDocCodigo>`).
 *  - Nodos custom con colores semánticos por tipo: inicial (verde), final (azul), intermedio (gris).
 *  - Edges con label `accion (rol_codigo)`.
 *  - Sidebar derecho al clickar nodo/edge — no rompe la estructura de la página padre.
 *  - Accesibilidad: aria-label en nodos, foco por teclado delegado a ReactFlow (tab/arrows nativos).
 *  - Responsive: zoom inicial 0.7 en viewport < 640px.
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
} from "reactflow";
import "reactflow/dist/style.css";
// dagre para auto-layout
import dagre from "@dagrejs/dagre";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import Link from "next/link";

// ─── Tipos ─────────────────────────────────────────────────────────────────────

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
}

interface WorkflowGraphProps {
  estados: EstadoRow[];
  transiciones: TransicionRow[];
  tipDocCodigo: string; // para clave localStorage
  workflowEditHref: string; // href del botón "Editar"
}

// ─── Constantes de layout ──────────────────────────────────────────────────────

const NODE_W = 160;
const NODE_H = 52;

// ─── Colores por tipo de estado ────────────────────────────────────────────────

function nodeStyle(es_inicial: boolean, es_final: boolean) {
  if (es_inicial)
    return {
      background: "#dcfce7", // green-100
      border: "1.5px solid #16a34a", // green-600
      color: "#15803d", // green-700
    };
  if (es_final)
    return {
      background: "#dbeafe", // blue-100
      border: "1.5px solid #2563eb", // blue-600
      color: "#1d4ed8", // blue-700
    };
  return {
    background: "#f3f4f6", // gray-100
    border: "1.5px solid #9ca3af", // gray-400
    color: "#374151", // gray-700
  };
}

// ─── Nodo custom ───────────────────────────────────────────────────────────────

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
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            marginBottom: 2,
            opacity: 0.75,
          }}
        >
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

// ─── Auto-layout con dagre ─────────────────────────────────────────────────────

function applyDagreLayout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 40 });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

// ─── Serializar/deserializar posiciones localStorage ───────────────────────────

function loadPositions(key: string): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(`wf-positions-${key}`);
    return raw ? (JSON.parse(raw) as Record<string, { x: number; y: number }>) : {};
  } catch {
    return {};
  }
}

function savePositions(key: string, nodes: Node[]) {
  const positions: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n) => (positions[n.id] = n.position));
  try {
    localStorage.setItem(`wf-positions-${key}`, JSON.stringify(positions));
  } catch {
    /* quota exceeded — ignorar */
  }
}

// ─── Sidebar de detalles ───────────────────────────────────────────────────────

interface SidebarProps {
  selectedEstado: EstadoRow | null;
  selectedTransicion: TransicionRow | null;
  transicionesSalientes: TransicionRow[];
  workflowEditHref: string;
  onClose: () => void;
  onDeleteEdge?: (id: string) => void;
}

function DetailSidebar({
  selectedEstado,
  selectedTransicion,
  transicionesSalientes,
  workflowEditHref,
  onClose,
  onDeleteEdge,
}: SidebarProps) {
  if (!selectedEstado && !selectedTransicion) return null;

  return (
    <Card
      className="absolute right-2 top-2 z-10 w-64 shadow-lg"
      role="complementary"
      aria-label="Detalles del elemento seleccionado"
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
        <CardTitle className="text-sm">
          {selectedEstado ? "Estado" : "Transición"}
        </CardTitle>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-sm"
          aria-label="Cerrar panel"
        >
          ✕
        </button>
      </CardHeader>
      <CardContent className="px-4 pb-4 text-sm space-y-2">
        {selectedEstado && (
          <>
            <div>
              <span className="font-semibold">Nombre:</span> {selectedEstado.nombre}
            </div>
            <div>
              <span className="font-semibold">Código:</span>{" "}
              <code className="text-xs">{selectedEstado.codigo}</code>
            </div>
            <div>
              <span className="font-semibold">Orden:</span> {selectedEstado.orden}
            </div>
            <div className="flex gap-2 flex-wrap">
              {selectedEstado.es_inicial && (
                <Badge className="text-xs bg-green-100 text-green-700 border-green-600">
                  INICIAL
                </Badge>
              )}
              {selectedEstado.es_final && (
                <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-600">
                  FINAL
                </Badge>
              )}
            </div>
            {transicionesSalientes.length > 0 && (
              <div>
                <p className="font-semibold mt-2 mb-1">Transiciones salientes:</p>
                <ul className="space-y-1">
                  {transicionesSalientes.map((t) => (
                    <li key={t.id} className="text-xs text-muted-foreground">
                      {t.accion}
                      {t.rol_codigo && (
                        <span className="ml-1 font-mono">({t.rol_codigo})</span>
                      )}
                      {t.requiere_firma && (
                        <span className="ml-1 opacity-60">✎</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button asChild size="sm" className="w-full mt-2">
              <Link href={workflowEditHref} aria-label="Editar este estado">
                Editar
              </Link>
            </Button>
          </>
        )}

        {selectedTransicion && (
          <>
            <div>
              <span className="font-semibold">Acción:</span> {selectedTransicion.accion}
            </div>
            {selectedTransicion.rol_codigo && (
              <div>
                <span className="font-semibold">Rol:</span>{" "}
                <code className="text-xs">{selectedTransicion.rol_codigo}</code>
              </div>
            )}
            <div>
              <span className="font-semibold">Requiere firma:</span>{" "}
              {selectedTransicion.requiere_firma ? "Sí" : "No"}
            </div>
            {onDeleteEdge && (
              <Button
                size="sm"
                variant="destructive"
                className="w-full mt-2"
                onClick={() => onDeleteEdge(selectedTransicion.id)}
                aria-label="Eliminar esta transición"
              >
                Eliminar transición
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────

export function WorkflowGraph({
  estados,
  transiciones,
  tipDocCodigo,
  workflowEditHref,
}: WorkflowGraphProps) {
  // Detectar mobile para zoom inicial
  const isMobile =
    typeof window !== "undefined" && window.innerWidth < 640;

  // Mapas para lookup O(1)
  const estadoMap = React.useMemo(
    () => new Map(estados.map((e) => [e.id, e])),
    [estados],
  );

  // Construir nodes/edges iniciales con dagre + posiciones guardadas
  const { initialNodes, initialEdges } = React.useMemo(() => {
    const saved = loadPositions(tipDocCodigo);

    const onSelect = () => {}; // placeholder — se reemplaza en el render real

    const rawNodes: Node<EstadoNodeData>[] = estados.map((e) => ({
      id: e.id,
      type: "estado",
      position: saved[e.id] ?? { x: 0, y: 0 },
      data: {
        label: e.nombre,
        codigo: e.codigo,
        es_inicial: e.es_inicial,
        es_final: e.es_final,
        orden: e.orden,
        onSelect,
      },
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

    // Si no hay posiciones guardadas, usar dagre
    const hasSaved = estados.every((e) => !!saved[e.id]);
    const layoutedNodes = hasSaved
      ? rawNodes
      : applyDagreLayout(rawNodes, rawEdges);

    return { initialNodes: layoutedNodes, initialEdges: rawEdges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estados, transiciones, tipDocCodigo]);

  const [nodes, setNodes] = React.useState<Node[]>(initialNodes);
  const [edges, setEdges] = React.useState<Edge[]>(initialEdges);

  // Sincronizar cuando cambian estados/transiciones (re-render por CRUD)
  React.useEffect(() => {
    setNodes(initialNodes.map((n) => ({
      ...n,
      data: { ...n.data, onSelect: handleNodeClick },
    })));
    setEdges(initialEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges]);

  // ── Selección ──────────────────────────────────────────────────────────────

  const [selectedEstadoId, setSelectedEstadoId] = React.useState<string | null>(null);
  const [selectedTransicionId, setSelectedTransicionId] = React.useState<string | null>(null);

  function handleNodeClick(id: string) {
    setSelectedEstadoId(id);
    setSelectedTransicionId(null);
  }

  function handleEdgeClick(_: React.MouseEvent, edge: Edge) {
    setSelectedTransicionId(edge.id);
    setSelectedEstadoId(null);
  }

  // ── Cambios de nodos (drag) ────────────────────────────────────────────────

  function handleNodesChange(changes: NodeChange[]) {
    setNodes((nds) => {
      const updated = applyNodeChanges(changes, nds);
      savePositions(tipDocCodigo, updated);
      return updated;
    });
  }

  function handleEdgesChange(changes: EdgeChange[]) {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }

  function handleConnect(connection: Connection) {
    setEdges((eds) => addEdge(connection, eds));
  }

  // ── Eliminar edge (solo UI — persiste en formulario externo) ───────────────

  function handleDeleteEdge(id: string) {
    setEdges((eds) => eds.filter((e) => e.id !== id));
    setSelectedTransicionId(null);
  }

  // ── Computed para sidebar ──────────────────────────────────────────────────

  const selectedEstado = selectedEstadoId ? (estadoMap.get(selectedEstadoId) ?? null) : null;
  const selectedTransicion = selectedTransicionId
    ? (transiciones.find((t) => t.id === selectedTransicionId) ?? null)
    : null;
  const transicionesSalientes = selectedEstadoId
    ? transiciones.filter((t) => t.estado_origen_id === selectedEstadoId)
    : [];

  // Inyectar handler real en nodes
  const nodesWithHandler = React.useMemo(
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
      className="relative w-full"
      style={{ height: 480 }}
      data-testid="workflow-graph-container"
    >
      <ReactFlow
        nodes={nodesWithHandler}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onEdgeClick={handleEdgeClick}
        defaultViewport={{ x: 40, y: 40, zoom: isMobile ? 0.7 : 1 }}
        fitView={!isMobile}
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-right"
        aria-label="Grafo de estados y transiciones del workflow"
      >
        <Background gap={16} size={1} color="#e5e7eb" />
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

      <DetailSidebar
        selectedEstado={selectedEstado}
        selectedTransicion={selectedTransicion}
        transicionesSalientes={transicionesSalientes}
        workflowEditHref={workflowEditHref}
        onClose={() => {
          setSelectedEstadoId(null);
          setSelectedTransicionId(null);
        }}
        onDeleteEdge={handleDeleteEdge}
      />
    </div>
  );
}
