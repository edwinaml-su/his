"use client";

/**
 * US.F2.6.5 — Dashboard integridad catálogos GS1.
 *
 * 3 cards conteo + tabla vencimientos próximos (rojo/amarillo) + GSRN renovación (amarillo).
 */

import * as React from "react";
import {
  Users,
  MapPin,
  Package,
  AlertTriangle,
  RefreshCw,
  LayoutGrid,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales (espeja el output del router gs1Dashboard.summary)
// ---------------------------------------------------------------------------

interface VencimientoItem {
  id: string;
  codigo: string;
  descripcion: string;
  loteVencimiento: Date;
  recallStatus: string;
}

interface GsrnRenovItem {
  id: string;
  codigo: string;
  tipo: string;
  referenciaId: string;
}

// ---------------------------------------------------------------------------
// Tarjeta de conteo
// ---------------------------------------------------------------------------

function CountCard({
  title,
  value,
  icon: Icon,
  description,
  isLoading,
}: {
  title: string;
  value?: number;
  icon: typeof Users;
  description: string;
  isLoading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div
            className="h-8 w-16 animate-pulse rounded bg-muted"
            aria-label="Cargando…"
          />
        ) : (
          <div
            className="text-2xl font-bold"
            aria-label={`${value ?? 0} ${title}`}
            data-testid={`count-${title.toLowerCase().replace(/\s/g, "-")}`}
          >
            {(value ?? 0).toLocaleString("es-SV")}
          </div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function Gs1DashboardPage() {
  const [vencimientosDias, setVencimientosDias] = React.useState(30);

  const { data, isLoading, isError, refetch, isFetching } =
    trpc.gs1Dashboard.summary.useQuery(
      { vencimientosDias },
      { staleTime: 60_000 },
    );

  const now = Date.now();
  const DIAS_ROJO = 7;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard GS1 — Integridad</h1>
          <p className="text-sm text-muted-foreground">
            Resumen de entidades GS1 activas, vencimientos y renovaciones pendientes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={vencimientosDias}
            onChange={(e) => setVencimientosDias(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            aria-label="Ventana de vencimientos"
            data-testid="select-vencimientos"
          >
            <option value={7}>7 días</option>
            <option value={30}>30 días</option>
            <option value={90}>90 días</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            data-testid="btn-refrescar"
            aria-label="Refrescar datos"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      {isError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          No se pudo obtener el resumen de integridad GS1. Intente refrescar.
        </div>
      )}

      {/* Cards de conteo */}
      <div className="grid gap-4 sm:grid-cols-3">
        <CountCard
          title="GSRN activos"
          value={data?.counts.gsrnActivos}
          icon={Users}
          description="Pacientes y profesionales registrados"
          isLoading={isLoading}
        />
        <CountCard
          title="GLN registrados"
          value={data?.counts.glnRegistrados}
          icon={MapPin}
          description="Ubicaciones físicas activas"
          isLoading={isLoading}
        />
        <CountCard
          title="GTIN con lotes"
          value={data?.counts.gtinConLotes}
          icon={Package}
          description="Productos con fecha de vencimiento"
          isLoading={isLoading}
        />
      </div>

      {/* Vencimientos próximos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-yellow-500" aria-hidden="true" />
            Vencimientos próximos — {vencimientosDias} días
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground" role="status">
              Cargando…
            </p>
          ) : !data || data.vencimientosPróximos.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground" role="status">
              Sin vencimientos en los próximos {vencimientosDias} días.
            </p>
          ) : (
            <table
              className="w-full text-sm"
              aria-label="Medicamentos con vencimiento próximo"
            >
              <thead>
                <tr className="border-b text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 text-left">GTIN</th>
                  <th className="py-2 text-left">Descripción</th>
                  <th className="py-2 text-left">Vencimiento</th>
                  <th className="py-2 text-left">Recall</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(data.vencimientosPróximos as VencimientoItem[]).map((item) => {
                  const isRojo =
                    new Date(item.loteVencimiento).getTime() - now < DIAS_ROJO * 86400000;
                  return (
                    <tr key={item.id} data-testid={`venc-row-${item.id}`}>
                      <td className="py-2.5 font-mono text-xs">{item.codigo}</td>
                      <td className="py-2.5">{item.descripcion}</td>
                      <td className="py-2.5">
                        <span
                          className={
                            isRojo
                              ? "font-semibold text-destructive"
                              : "font-medium text-yellow-700 dark:text-yellow-400"
                          }
                        >
                          {new Date(item.loteVencimiento).toLocaleDateString("es-SV")}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <Badge
                          variant={item.recallStatus !== "NONE" ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {item.recallStatus === "NONE" ? "Normal" : item.recallStatus}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* GSRN pendientes renovación */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutGrid className="h-4 w-4 text-yellow-500" aria-hidden="true" />
            GSRN profesionales — renovación anual pendiente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground" role="status">
              Cargando…
            </p>
          ) : !data || data.gsrnPendientesRenovacion.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground" role="status">
              Sin GSRN pendientes de renovación.
            </p>
          ) : (
            <table
              className="w-full text-sm"
              aria-label="GSRN pendientes de renovación"
            >
              <thead>
                <tr className="border-b text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 text-left">GSRN</th>
                  <th className="py-2 text-left">Tipo</th>
                  <th className="py-2 text-left">Referencia</th>
                  <th className="py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(data.gsrnPendientesRenovacion as GsrnRenovItem[]).map((gsrn) => (
                  <tr key={gsrn.id} data-testid={`gsrn-row-${gsrn.id}`}>
                    <td className="py-2.5 font-mono text-xs">{gsrn.codigo}</td>
                    <td className="py-2.5 capitalize">{gsrn.tipo}</td>
                    <td className="py-2.5 font-mono text-xs text-muted-foreground">
                      {gsrn.referenciaId.slice(0, 8)}…
                    </td>
                    <td className="py-2.5">
                      <Badge
                        variant="outline"
                        className="border-yellow-400 text-[10px] text-yellow-700"
                      >
                        Renovación pendiente
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {data && (
        <p className="text-xs text-muted-foreground">
          Generado el{" "}
          {new Date(data.generadoEn).toLocaleString("es-SV", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      )}
    </div>
  );
}
