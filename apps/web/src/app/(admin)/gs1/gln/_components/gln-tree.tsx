"use client";

/**
 * GlnTree — árbol recursivo de ubicaciones GLN.
 *
 * Renderiza cada nodo con: código GLN (monospace), descripción, tipo (badge),
 * indicador activo/inactivo. Nodos con children se expanden/contraen.
 *
 * WCAG 2.2 AA: usa role="tree" / role="treeitem" con aria-expanded.
 */

import * as React from "react";
import { ChevronDown, ChevronRight, MapPin } from "lucide-react";
import { Badge } from "@his/ui/components/badge";
import { cn } from "@his/ui/lib/utils";

export interface GlnNode {
  id: string;
  codigo: string;
  descripcion: string;
  tipo: string;
  activo: boolean;
  depth: number;
  children: GlnNode[];
}

const TIPO_LABELS: Record<string, string> = {
  proveedor: "Proveedor",
  deposito:  "Almacén",
  farmacia:  "Farmacia",
  servicio:  "Servicio",
  cama:      "Cama",
};

const TIPO_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  proveedor: "secondary",
  deposito:  "secondary",
  farmacia:  "default",
  servicio:  "outline",
  cama:      "outline",
};

function GlnTreeNode({
  node,
  onSelect,
  selectedId,
}: {
  node: GlnNode;
  onSelect?: (node: GlnNode) => void;
  selectedId?: string;
}) {
  const [open, setOpen] = React.useState(node.depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
          "hover:bg-accent/40 transition-colors",
          isSelected && "bg-accent text-accent-foreground font-medium",
        )}
        style={{ paddingLeft: `${0.5 + node.depth * 1.25}rem` }}
        onClick={() => onSelect?.(node)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelect?.(node);
        }}
        role="button"
        tabIndex={0}
        aria-label={`${node.descripcion} — ${node.codigo}`}
      >
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={open ? "Contraer" : "Expandir"}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            {open ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}

        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />

        <span className="flex-1 truncate">
          <span className="font-medium">{node.descripcion}</span>
          <span className="ml-2 font-mono text-xs text-muted-foreground">{node.codigo}</span>
        </span>

        <Badge
          variant={TIPO_VARIANT[node.tipo] ?? "outline"}
          className="text-[10px] px-1.5 py-0 shrink-0"
        >
          {TIPO_LABELS[node.tipo] ?? node.tipo}
        </Badge>

        {!node.activo && (
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">
            Inactivo
          </Badge>
        )}
      </div>

      {hasChildren && open && (
        <ul role="group" className="ml-2">
          {node.children.map((child) => (
            <GlnTreeNode
              key={child.id}
              node={child}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function GlnTree({
  nodes,
  onSelect,
  selectedId,
}: {
  nodes: GlnNode[];
  onSelect?: (node: GlnNode) => void;
  selectedId?: string;
}) {
  if (nodes.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground" role="status">
        Sin ubicaciones GLN registradas.
      </p>
    );
  }

  return (
    <ul role="tree" aria-label="Árbol de ubicaciones GLN" className="space-y-0.5">
      {nodes.map((node) => (
        <GlnTreeNode
          key={node.id}
          node={node}
          onSelect={onSelect}
          selectedId={selectedId}
        />
      ))}
    </ul>
  );
}
