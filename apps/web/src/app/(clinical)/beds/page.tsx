"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { BedMap, type BedMapServiceGroup, type BedStatus } from "@his/ui/components/BedMap";
import { trpc } from "@/lib/trpc/react";

// Tipos locales que reflejan el output de eceCama.mapCompleto.
// Mantienen paridad con ServicioMapRow / CamaEstadoRow del router ECE.
type EstadoCama = "libre" | "ocupada" | "limpieza" | "mantenimiento";

interface CamaEce {
  camaId: string;
  codigo: string;
  estado: EstadoCama;
  pacienteNombre: string | null;
}

interface ServicioEce {
  servicioId: string;
  servicioNombre: string;
  camas: CamaEce[];
}

function eceStatusToBedStatus(estado: EstadoCama): BedStatus {
  switch (estado) {
    case "libre":         return "FREE";
    case "ocupada":       return "OCCUPIED";
    case "limpieza":      return "DIRTY";
    case "mantenimiento": return "MAINTENANCE";
  }
}

export default function BedsPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = trpc.eceCama.mapCompleto.useQuery() as { data?: ServicioEce[]; isLoading: boolean; error?: any };

  const groups: BedMapServiceGroup[] =
    map.data?.map((s) => ({
      serviceUnitId: s.servicioId,
      serviceUnitName: s.servicioNombre,
      beds: s.camas.map((c) => ({
        id: c.camaId,
        code: c.codigo,
        status: eceStatusToBedStatus(c.estado),
        patientName: c.pacienteNombre,
      })),
    })) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mapa de camas</h1>
      <Card>
        <CardHeader><CardTitle>Estado de ocupación</CardTitle></CardHeader>
        <CardContent>
          {map.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {map.error && (
            <p className="text-sm text-destructive">
              Error al cargar mapa: {map.error.message}
            </p>
          )}
          {map.data && <BedMap groups={groups} />}
        </CardContent>
      </Card>
    </div>
  );
}
