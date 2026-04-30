"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";
import { Badge } from "./badge";

export interface AuditEntry {
  id: string | number | bigint;
  occurredAt: Date | string;
  action: string;
  entity: string;
  entityId?: string | null;
  userId?: string | null;
  userLabel?: string | null;
  justification?: string | null;
}

interface AuditTrailProps {
  items: AuditEntry[];
  className?: string;
}

/**
 * Visor del audit log (TDR §6.3). Solo lectura; ordenado descendente.
 */
export function AuditTrail({ items, className }: AuditTrailProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin eventos registrados.</p>;
  }
  return (
    <div className={cn("rounded-md border", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Acción</TableHead>
            <TableHead>Entidad</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>Usuario</TableHead>
            <TableHead>Justificación</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => {
            const dt = new Date(it.occurredAt);
            return (
              <TableRow key={String(it.id)}>
                <TableCell className="tabular-nums">
                  {dt.toLocaleString("es-SV")}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{it.action}</Badge>
                </TableCell>
                <TableCell>{it.entity}</TableCell>
                <TableCell className="font-mono text-xs">{it.entityId ?? "—"}</TableCell>
                <TableCell>{it.userLabel ?? it.userId ?? "—"}</TableCell>
                <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                  {it.justification ?? ""}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
