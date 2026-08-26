"use client";

/**
 * CC-0026 D3 — Grid de tableros de seguimiento de actividades por área.
 *
 * Sin mockup propio (REQ-CC-0026 D3): sigue el design system existente
 * (Card/Badge shadcn) con el mismo estilo visual que
 * `/triage/dashboard` (auto-refresh + cards resumen), sin inventar paleta.
 *
 * Enfermería es un rol transversal, no una `ServiceUnit` — su card usa la
 * ruta literal `/tableros/enfermeria` (ver `[unidad]/page.tsx`).
 */
import * as React from "react";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { EmptyState } from "@his/ui/components/states";
import { trpc } from "@/lib/trpc/react";

const AREA_TYPE_LABEL: Record<string, string> = {
  QUIROFANO: "Quirófano",
  LABORATORIO: "Laboratorio",
  IMAGENES: "Imágenes",
  EMERGENCIA: "Emergencia",
  UCI: "UCI",
  UCIN: "UCI Neonatal",
  MAX_URGENCIA: "Máxima Urgencia",
  SALA_ESPERA: "Sala de Espera",
  HOSPITALIZACION: "Hospitalización",
  CONSULTA: "Consulta Externa",
  FARMACIA: "Farmacia",
  PARTOS: "Partos",
  OTRA: "Otra",
};

interface AreaCardData {
  id: string;
  code: string;
  name: string;
  areaType: string | null;
  pendienteCount: number;
  enProcesoCount: number;
}

export default function TablerosPage(): React.ReactElement {
  const areasQuery = trpc.careBoard.areas.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const areas = areasQuery.data?.areas ?? [];
  const enfermeria = areasQuery.data?.enfermeria;
  const isEmpty = Boolean(areasQuery.data) && areas.length === 0 && !enfermeria;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Tableros por área</h1>
        <p className="text-sm text-muted-foreground">
          Seguimiento de actividades pendientes por unidad de servicio.
          {areasQuery.isFetching && " · actualizando…"}
        </p>
      </div>

      {areasQuery.error ? (
        <p role="alert" className="text-sm text-destructive">
          Error cargando áreas: {areasQuery.error.message}
        </p>
      ) : null}

      {areasQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando áreas…</p>
      ) : null}

      {isEmpty ? (
        <EmptyState
          icon={LayoutGrid}
          title="Sin áreas configuradas"
          description="No hay unidades de servicio con área clasificada en este establecimiento."
        />
      ) : null}

      {areasQuery.data ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          role="list"
          aria-label="Tableros por área"
        >
          {enfermeria ? <AreaCard area={enfermeria} href="/tableros/enfermeria" /> : null}
          {areas.map((a) => (
            <AreaCard key={a.id} area={a} href={`/tableros/${a.id}`} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AreaCard({ area, href }: { area: AreaCardData; href: string }): React.ReactElement {
  const areaLabel = area.areaType ? (AREA_TYPE_LABEL[area.areaType] ?? area.areaType) : null;

  return (
    <Link
      href={href}
      role="listitem"
      className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Tablero de ${area.name}: ${area.pendienteCount} tareas pendientes, ${area.enProcesoCount} en proceso`}
    >
      <Card className="h-full transition-colors hover:bg-accent/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{area.name}</CardTitle>
          {areaLabel ? <p className="text-xs text-muted-foreground">{areaLabel}</p> : null}
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant={area.pendienteCount > 0 ? "warning" : "secondary"}>
            {area.pendienteCount} pendiente{area.pendienteCount === 1 ? "" : "s"}
          </Badge>
          <Badge variant={area.enProcesoCount > 0 ? "info" : "secondary"}>
            {area.enProcesoCount} en proceso
          </Badge>
        </CardContent>
      </Card>
    </Link>
  );
}
