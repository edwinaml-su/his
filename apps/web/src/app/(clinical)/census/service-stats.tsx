"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

/** Wiring TODO US-5.4: ver nota en bed-occupancy.tsx. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const censusTrpc = (trpc as any).census;

export interface ServiceStatsProps {
  establishmentId?: string;
}

interface ServiceRow {
  serviceUnitId: string;
  serviceUnitCode: string;
  serviceUnitName: string;
  total: number;
  occupied: number;
  free: number;
  dirty: number;
  blocked: number;
  maintenance: number;
  reserved: number;
  occupancyPct: number;
}

interface MovementItem {
  id: string;
  serviceUnit: { id: string; code: string; name: string } | null;
}

/**
 * US-5.4 — Tabla por servicio con counts de ocupación + ingresos/egresos del
 * día. Cruza `census.occupancyStats` con `census.dailyMovements` y agrega
 * por servicio. Auto-refresh 30s.
 */
export function ServiceStats({ establishmentId }: ServiceStatsProps) {
  const stats = censusTrpc.occupancyStats.useQuery(
    { establishmentId },
    { refetchInterval: 30_000 },
  );
  const movements = censusTrpc.dailyMovements.useQuery(
    { establishmentId },
    { refetchInterval: 30_000 },
  );

  const byServiceData: ServiceRow[] =
    (stats.data?.byService as ServiceRow[] | undefined) ?? [];

  const admissionsByService = React.useMemo(() => {
    const m = new Map<string, number>();
    const items: MovementItem[] = movements.data?.admissions.items ?? [];
    for (const a of items) {
      const k = a.serviceUnit?.id ?? "_none";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [movements.data]);

  const dischargesByService = React.useMemo(() => {
    const m = new Map<string, number>();
    const items: MovementItem[] = movements.data?.discharges.items ?? [];
    for (const d of items) {
      const k = d.serviceUnit?.id ?? "_none";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [movements.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estadísticas por servicio</CardTitle>
      </CardHeader>
      <CardContent>
        {stats.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : byServiceData.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin servicios con camas configuradas.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Servicio</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Ocupadas</TableHead>
                <TableHead className="text-right">Libres</TableHead>
                <TableHead className="text-right">% Ocupación</TableHead>
                <TableHead className="text-right">Ingresos hoy</TableHead>
                <TableHead className="text-right">Egresos hoy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byServiceData.map((s) => (
                <TableRow key={s.serviceUnitId}>
                  <TableCell className="font-medium">{s.serviceUnitName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.total}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.occupied}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.free}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.occupancyPct.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {admissionsByService.get(s.serviceUnitId) ?? 0}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {dischargesByService.get(s.serviceUnitId) ?? 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
