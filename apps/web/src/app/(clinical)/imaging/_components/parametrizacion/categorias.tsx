"use client";

/**
 * CC-0016 — Parametrización › «🗂 Categorías». Orden (▲▼, persistido en
 * LabPanel.displayOrder) + activo, sobre los 5 paneles RADIOLOGIA del catálogo.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Switch } from "@his/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

export function Categorias() {
  const utils = trpc.useUtils();
  const panelsQ = trpc.lis.panel.list.useQuery({ activeOnly: false, limit: 200 });
  const catalogoQ = trpc.imagingRequest.catalogoImagen.list.useQuery();

  const radiologia = React.useMemo(
    () =>
      (panelsQ.data ?? [])
        .filter((p) => p.area === "RADIOLOGIA")
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [panelsQ.data],
  );

  const countByPanel = React.useMemo(() => {
    const m = new Map<string, { total: number; activas: number }>();
    for (const item of catalogoQ.data ?? []) {
      const cur = m.get(item.panelId) ?? { total: 0, activas: 0 };
      cur.total++;
      if (item.active) cur.activas++;
      m.set(item.panelId, cur);
    }
    return m;
  }, [catalogoQ.data]);

  const update = trpc.lis.panel.update.useMutation({
    onSuccess: () => {
      utils.lis.panel.list.invalidate();
    },
  });
  const deactivate = trpc.lis.panel.deactivate.useMutation({
    onSuccess: () => utils.lis.panel.list.invalidate(),
  });
  const reactivate = trpc.lis.panel.reactivate.useMutation({
    onSuccess: () => utils.lis.panel.list.invalidate(),
  });

  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    const a = radiologia[i];
    const b = radiologia[j];
    if (!a || !b) return;
    update.mutate({ id: a.id, displayOrder: b.displayOrder });
    update.mutate({ id: b.id, displayOrder: a.displayOrder });
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Orden</TableHead>
            <TableHead>Categoría</TableHead>
            <TableHead>Prestaciones</TableHead>
            <TableHead className="w-28">Estado</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {radiologia.map((p, i) => {
            const counts = countByPanel.get(p.id) ?? { total: 0, activas: 0 };
            return (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap">
                  <Button type="button" variant="ghost" size="sm" disabled={i === 0} onClick={() => mover(i, -1)}>
                    ▲
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={i === radiologia.length - 1}
                    onClick={() => mover(i, 1)}
                  >
                    ▼
                  </Button>
                </TableCell>
                <TableCell className="font-semibold">{p.name}</TableCell>
                <TableCell>
                  {counts.total} <span className="text-xs text-muted-foreground">({counts.activas} activas)</span>
                </TableCell>
                <TableCell>
                  <Badge variant={p.active ? "success" : "outline"}>{p.active ? "Activa" : "Inactiva"}</Badge>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={p.active}
                    onCheckedChange={(c) =>
                      c ? reactivate.mutate({ id: p.id }) : deactivate.mutate({ id: p.id })
                    }
                    aria-label={`Activar/desactivar ${p.name}`}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
