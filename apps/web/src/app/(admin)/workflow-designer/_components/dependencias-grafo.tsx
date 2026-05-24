"use client";

/**
 * DependenciasGrafo — vista visual del grafo `depende_de` entre tipos de documento.
 *
 * Fase 3 del workflow-designer enhancement.
 *
 * Renderiza:
 *   - El documento actual al centro (nodo destacado).
 *   - Sus dependencias directas (codigos en `depende_de`) a la izquierda → flecha entrante.
 *   - Los documentos que dependen de este (reverse lookup) a la derecha → flecha saliente.
 *
 * Usa ReactFlow (ya instalado) con layout horizontal manual sencillo
 * (sin Dagre — escala bien para 1 nodo central + 5-10 dependencias por lado).
 *
 * Cada nodo es clickeable y navega a `/workflow-designer/{codigo}`.
 */
import * as React from "react";
import Link from "next/link";
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  Position,
  Handle,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { Badge } from "@his/ui/components/badge";

interface TipoDocLite {
  codigo: string;
  nombre: string;
  modalidad: string;
  depende_de: string[] | null;
}

interface DocNodeData {
  codigo: string;
  nombre: string;
  modalidad: string;
  variant: "central" | "depende_de" | "dependiente";
}

/** Nodo personalizado: clickeable, con badge de modalidad. */
function DocNode({ data }: NodeProps<DocNodeData>) {
  const bg =
    data.variant === "central"
      ? "bg-primary text-primary-foreground border-primary"
      : data.variant === "depende_de"
      ? "bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100"
      : "bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100";

  const content = (
    <div
      className={`rounded-md border px-3 py-2 text-xs shadow-sm transition-shadow hover:shadow-md ${bg}`}
      aria-label={`${data.nombre} (${data.codigo})`}
    >
      <div className="font-mono font-semibold">{data.codigo}</div>
      <div className="mt-0.5 max-w-[180px] truncate">{data.nombre}</div>
      <Badge variant="outline" className="mt-1 text-[10px]">
        {data.modalidad}
      </Badge>
    </div>
  );

  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      {data.variant === "central" ? (
        content
      ) : (
        <Link
          href={`/workflow-designer/${data.codigo}`}
          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        >
          {content}
        </Link>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />
    </>
  );
}

const nodeTypes = { doc: DocNode };

// Layout: 3 columnas — izquierda (dependencias), centro (current), derecha (dependientes)
const COL_X = { left: 0, center: 320, right: 640 } as const;
const ROW_H = 90;

export interface DependenciasGrafoProps {
  /** El tipo de documento centro del grafo. */
  current: TipoDocLite;
  /** Lista completa de tipos para resolver nombres + buscar dependientes. */
  all: TipoDocLite[];
}

export function DependenciasGrafo({ current, all }: DependenciasGrafoProps) {
  // Reverse lookup: tipos cuyo depende_de incluye este código.
  const dependientes = React.useMemo(
    () =>
      all
        .filter((d) => d.codigo !== current.codigo && (d.depende_de ?? []).includes(current.codigo))
        .slice(0, 12),
    [all, current.codigo],
  );

  // Resuelve los códigos de depende_de a objetos completos.
  const depDocs = React.useMemo(
    () =>
      (current.depende_de ?? [])
        .map((codigo) => all.find((d) => d.codigo === codigo))
        .filter((d): d is TipoDocLite => Boolean(d)),
    [all, current.depende_de],
  );

  const nodes: Node<DocNodeData>[] = React.useMemo(() => {
    const result: Node<DocNodeData>[] = [];

    // Centro
    result.push({
      id: current.codigo,
      type: "doc",
      position: { x: COL_X.center, y: 0 },
      data: {
        codigo: current.codigo,
        nombre: current.nombre,
        modalidad: current.modalidad,
        variant: "central",
      },
      draggable: false,
    });

    // Izquierda: depende_de
    depDocs.forEach((d, idx) => {
      const offset = (idx - (depDocs.length - 1) / 2) * ROW_H;
      result.push({
        id: `dep-${d.codigo}`,
        type: "doc",
        position: { x: COL_X.left, y: offset },
        data: {
          codigo: d.codigo,
          nombre: d.nombre,
          modalidad: d.modalidad,
          variant: "depende_de",
        },
        draggable: false,
      });
    });

    // Derecha: dependientes
    dependientes.forEach((d, idx) => {
      const offset = (idx - (dependientes.length - 1) / 2) * ROW_H;
      result.push({
        id: `child-${d.codigo}`,
        type: "doc",
        position: { x: COL_X.right, y: offset },
        data: {
          codigo: d.codigo,
          nombre: d.nombre,
          modalidad: d.modalidad,
          variant: "dependiente",
        },
        draggable: false,
      });
    });

    return result;
  }, [current, depDocs, dependientes]);

  const edges: Edge[] = React.useMemo(() => {
    const result: Edge[] = [];
    depDocs.forEach((d) => {
      result.push({
        id: `e-dep-${d.codigo}`,
        source: `dep-${d.codigo}`,
        target: current.codigo,
        animated: false,
        style: { stroke: "rgb(217 119 6)", strokeWidth: 1.5 },
        label: "requiere",
        labelStyle: { fontSize: 10, fill: "rgb(120 53 15)" },
      });
    });
    dependientes.forEach((d) => {
      result.push({
        id: `e-child-${d.codigo}`,
        source: current.codigo,
        target: `child-${d.codigo}`,
        animated: false,
        style: { stroke: "rgb(5 150 105)", strokeWidth: 1.5 },
        label: "habilita",
        labelStyle: { fontSize: 10, fill: "rgb(6 78 59)" },
      });
    });
    return result;
  }, [current.codigo, depDocs, dependientes]);

  const hasGraph = depDocs.length > 0 || dependientes.length > 0;

  if (!hasGraph) {
    return (
      <p className="text-xs text-muted-foreground">
        Este documento no tiene dependencias declaradas (raíz del grafo o documento aislado).
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="rounded-md border bg-muted/30"
        style={{ height: 360 }}
        role="figure"
        aria-label={`Grafo de dependencias de ${current.codigo}`}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.4}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded bg-amber-400" aria-hidden="true" />
          Dependencias requeridas ({depDocs.length})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded bg-emerald-500" aria-hidden="true" />
          Documentos que este habilita ({dependientes.length})
        </span>
      </div>
    </div>
  );
}
