"use client";

/**
 * US-1.2 — Nodo individual del árbol organizacional.
 *
 * Renderiza:
 *   - icono según tipo (Building2 para HOLDING/COMPANY, Hospital para
 *     ESTABLISHMENT — hojas físicas).
 *   - tradeName + badge active/inactive + counts (X estab., Y miembros).
 *   - chevron expand/collapse cuando el nodo tiene hijos u establecimientos.
 *   - botón Info que delega a `onShowDetail` para abrir el dialog en el padre.
 *
 * El componente es recursivo: pinta sus children como sub-listas indentadas.
 * Se mantiene como Client Component (interacción) pero no usa hooks costosos
 * — el estado de expansión vive en `OrgTree` para evitar fugas.
 */

import * as React from "react";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Hospital,
  Info,
} from "lucide-react";

export type OrgNodeData = {
  id: string;
  legalName: string;
  tradeName: string;
  type: "HOLDING" | "COMPANY" | "ESTABLISHMENT";
  active: boolean;
  parentId: string | null;
  children: OrgNodeData[];
  establishments: Array<{
    id: string;
    code: string;
    name: string;
    type: "ESTABLISHMENT";
    active: boolean;
  }>;
  membersCount: number;
};

interface OrgTreeNodeProps {
  node: OrgNodeData;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onShowDetail: (node: OrgNodeData) => void;
}

export function OrgTreeNode({
  node,
  depth,
  expanded,
  onToggle,
  onShowDetail,
}: OrgTreeNodeProps) {
  const hasChildren =
    node.children.length > 0 || node.establishments.length > 0;
  const isOpen = expanded.has(node.id);

  // Indent visual: 16px por nivel para mantener legible aún con jerarquías
  // de 4-5 niveles (Holding -> Empresa -> Establecimiento puede sumar más).
  const indentPx = depth * 16;

  const Icon = node.type === "HOLDING" || node.type === "COMPANY" ? Building2 : Hospital;

  return (
    <li className="list-none">
      <div
        className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent/50"
        style={{ paddingLeft: `${indentPx + 6}px` }}
        onContextMenu={(e) => {
          e.preventDefault();
          onShowDetail(node);
        }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          aria-label={isOpen ? "Colapsar" : "Expandir"}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={!hasChildren}
        >
          {hasChildren ? (
            isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="block h-4 w-4" />
          )}
        </button>

        <Icon
          className={`h-4 w-4 ${
            node.type === "HOLDING"
              ? "text-primary"
              : node.type === "ESTABLISHMENT"
                ? "text-emerald-600"
                : "text-foreground"
          }`}
        />

        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left text-sm"
          onClick={() => hasChildren && onToggle(node.id)}
        >
          <span className="font-medium">{node.tradeName}</span>
          <Badge variant="outline" className="text-[10px]">
            {node.type === "HOLDING"
              ? "Holding"
              : node.type === "COMPANY"
                ? "Empresa"
                : "Establecimiento"}
          </Badge>
          {node.active ? (
            <Badge variant="success" className="text-[10px]">
              Activa
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              Inactiva
            </Badge>
          )}
          {node.type !== "ESTABLISHMENT" ? (
            <span className="text-xs text-muted-foreground">
              {node.establishments.length} establ. · {node.membersCount} miembro
              {node.membersCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onShowDetail(node);
          }}
          aria-label="Ver detalle"
        >
          <Info className="h-4 w-4" />
        </Button>
      </div>

      {isOpen && hasChildren ? (
        <ul className="ml-0">
          {node.children.map((child) => (
            <OrgTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onShowDetail={onShowDetail}
            />
          ))}
          {node.establishments.map((est) => (
            <OrgTreeNode
              key={est.id}
              node={{
                id: est.id,
                tradeName: `${est.code} — ${est.name}`,
                legalName: est.name,
                type: "ESTABLISHMENT",
                active: est.active,
                parentId: node.id,
                children: [],
                establishments: [],
                membersCount: 0,
              }}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onShowDetail={onShowDetail}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
