"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import { BedOccupancy } from "./bed-occupancy";
import { ServiceStats } from "./service-stats";
import { Movements } from "./movements";

/** Wiring TODO US-5.4: ver nota en bed-occupancy.tsx. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const censusTrpc = (trpc as any).census;

interface ServiceRow {
  serviceUnitId: string;
  serviceUnitName: string;
}

/**
 * US-5.4 — Tablero de Censo realtime + ocupación.
 *
 * Layout:
 *   1. Header con KPIs grandes (% ocupación global, ingresos hoy, egresos hoy).
 *   2. <BedOccupancy> mapa visual por servicio.
 *   3. <ServiceStats> tabla por servicio.
 *   4. <Movements> 4 cards con listas expandibles.
 *
 * Filtros: serviceUnitId opcional (default = todos los servicios). El filtro
 * por establishmentId se infiere del tenant context en el servidor; la UI
 * no lo expone aún (Sprint 4: switcher cuando un usuario tenga acceso a
 * varios establecimientos del mismo holding).
 *
 * Realtime: polling 30s (`refetchInterval`). Pendiente Supabase Realtime
 * channels en Sprint 4.
 */
export default function CensusPage() {
  const [serviceUnitId, setServiceUnitId] = React.useState<string>("ALL");

  const occupancy = censusTrpc.occupancyStats.useQuery(
    {
      serviceUnitId: serviceUnitId === "ALL" ? undefined : serviceUnitId,
    },
    { refetchInterval: 30_000 },
  );
  const movements = censusTrpc.dailyMovements.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // Lista de servicios para el filtro — derivada de occupancyStats para no
  // pegarle a otro endpoint.
  const services: ServiceRow[] =
    (occupancy.data?.byService as ServiceRow[] | undefined) ?? [];

  const occPct: number = occupancy.data?.global.occupancyPct ?? 0;
  const admissionsToday: number = movements.data?.admissions.count ?? 0;
  const dischargesToday: number = movements.data?.discharges.count ?? 0;
  const operationalBeds: number = occupancy.data?.global.operational ?? 0;
  const occupied: number = occupancy.data?.global.occupied ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Censo realtime</h1>
          <p className="text-sm text-muted-foreground">
            Ocupación, movimientos del día y KPIs por servicio (US-5.4).
            Refresh automático cada 30 segundos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Servicio:</span>
          <Select value={serviceUnitId} onValueChange={setServiceUnitId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los servicios</SelectItem>
              {services.map((s) => (
                <SelectItem key={s.serviceUnitId} value={s.serviceUnitId}>
                  {s.serviceUnitName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 1. Header KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              % Ocupación global
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums">
                {occPct.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">
                {occupied}/{operationalBeds} operativas
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Ingresos hoy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-4xl font-bold tabular-nums text-success">
              {admissionsToday}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Egresos hoy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-4xl font-bold tabular-nums">
              {dischargesToday}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* 2. Mapa visual */}
      <BedOccupancy
        serviceUnitId={serviceUnitId === "ALL" ? undefined : serviceUnitId}
      />

      {/* 3. Tabla por servicio */}
      <ServiceStats />

      {/* 4. Movimientos */}
      <Movements />
    </div>
  );
}
