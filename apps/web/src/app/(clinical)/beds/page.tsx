"use client";

import { Building2, AlertCircle } from "lucide-react";
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

  // PRECONDITION_FAILED → falta establecimiento activo en la cuenta del usuario.
  // El fallback en getTenantContext debería evitar este caso, pero si el
  // usuario no tiene ninguna org con establishments aparece este mensaje útil.
  const isMissingEstablishment =
    map.error?.data?.code === "PRECONDITION_FAILED" ||
    (typeof map.error?.message === "string" &&
      map.error.message.toLowerCase().includes("establecimiento"));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mapa de camas</h1>
      <Card>
        <CardHeader><CardTitle>Estado de ocupación</CardTitle></CardHeader>
        <CardContent>
          {map.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}

          {map.error && isMissingEstablishment && (
            <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950/40">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  Sin establecimiento activo
                </p>
                <p className="text-amber-800/90 dark:text-amber-200/90">
                  Tu cuenta no está asignada a un hospital con establecimientos
                  activos. Solicita al administrador del sistema que te asigne a un
                  establecimiento, o cambia de organización desde el selector en
                  el encabezado.
                </p>
              </div>
            </div>
          )}

          {map.error && !isMissingEstablishment && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Error al cargar mapa: {map.error.message}</p>
            </div>
          )}

          {map.data && <BedMap groups={groups} />}
        </CardContent>
      </Card>
    </div>
  );
}
