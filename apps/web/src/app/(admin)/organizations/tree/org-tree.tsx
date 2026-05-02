"use client";

/**
 * US-1.2 — Client Component recursivo del árbol organizacional.
 *
 * Carga `organization.listTree` y delega el render por nodo a `OrgTreeNode`.
 * El estado de expand/collapse vive aquí (Set<string> de ids expandidos) para
 * que el caller pueda implementar "expandir todo" / "colapsar todo" sin que
 * cada nodo dispare re-renders cruzados (el estado está co-localizado).
 *
 * El click derecho / icono "info" abre el dialog de detalle (estado mínimo:
 * el nodo seleccionado). El detalle muestra metadatos + counts; navegar al
 * audit por entidad se hace desde el dialog.
 */

import * as React from "react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { Button } from "@his/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Badge } from "@his/ui/components/badge";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { trpc } from "@/lib/trpc/react";
import { OrgTreeNode, type OrgNodeData } from "./org-tree-node";

export function OrgTree() {
  const query = trpc.organization.listTree.useQuery();

  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<OrgNodeData | null>(null);

  const toggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collectIds = React.useCallback((nodes: OrgNodeData[]): string[] => {
    const out: string[] = [];
    function walk(n: OrgNodeData) {
      out.push(n.id);
      n.children.forEach(walk);
    }
    nodes.forEach(walk);
    return out;
  }, []);

  const expandAll = () => {
    if (!query.data) return;
    setExpanded(new Set(collectIds(query.data)));
  };
  const collapseAll = () => setExpanded(new Set());

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando árbol…</p>;
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
      </Alert>
    );
  }
  const roots = query.data ?? [];
  if (roots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tienes organizaciones asignadas para visualizar.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={expandAll}>
          <ChevronsUpDown className="mr-1.5 h-4 w-4" />
          Expandir todo
        </Button>
        <Button size="sm" variant="outline" onClick={collapseAll}>
          <ChevronsDownUp className="mr-1.5 h-4 w-4" />
          Colapsar todo
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {roots.length} holding(s)
        </span>
      </div>

      <ul className="rounded-md border bg-card p-2">
        {roots.map((node) => (
          <OrgTreeNode
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            onShowDetail={setSelected}
          />
        ))}
      </ul>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.tradeName}</DialogTitle>
                <DialogDescription>
                  {selected.legalName}
                  <span className="ml-2">
                    <Badge variant="outline">{selected.type}</Badge>
                  </span>
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Estado</dt>
                <dd>
                  {selected.active ? (
                    <Badge variant="success">Activa</Badge>
                  ) : (
                    <Badge variant="outline">Inactiva</Badge>
                  )}
                </dd>
                <dt className="text-muted-foreground">Establecimientos</dt>
                <dd>{selected.establishments.length}</dd>
                <dt className="text-muted-foreground">Miembros vigentes</dt>
                <dd>{selected.membersCount}</dd>
                <dt className="text-muted-foreground">Sub-organizaciones</dt>
                <dd>{selected.children.length}</dd>
                <dt className="text-muted-foreground">ID</dt>
                <dd className="font-mono text-xs break-all">{selected.id}</dd>
              </dl>
              <DialogFooter>
                <Link
                  href={`/organizations/audit?organizationId=${selected.id}`}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                  onClick={() => setSelected(null)}
                >
                  Ver auditoría
                </Link>
                <Button variant="outline" onClick={() => setSelected(null)}>
                  Cerrar
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
