"use client";

/**
 * Dashboard de Calidad Documental — Comité ECE.
 *
 * US.F2.7.47 — KPIs de calidad documental del expediente.
 * US.F2.7.48 — Reporte auditoría institucional (export data).
 * NTEC Art. 32.
 *
 * Acceso: roles DIR, ARCH, ADMIN.
 * Accesibilidad: WCAG 2.2 AA.
 */

import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pctBadge(pct: number | null) {
  if (pct === null) return <Badge variant="outline">Sin datos</Badge>;
  if (pct >= 95) return <Badge className="bg-green-100 text-green-800">{pct}%</Badge>;
  if (pct >= 80) return <Badge className="bg-amber-100 text-amber-800">{pct}%</Badge>;
  return <Badge className="bg-red-100 text-red-800">{pct}%</Badge>;
}

function formatHoras(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

// ---------------------------------------------------------------------------
// Tarjeta KPI
// ---------------------------------------------------------------------------

function KpiCard({
  titulo,
  valor,
  subtitulo,
  meta,
  className = "",
}: {
  titulo: string;
  valor: React.ReactNode;
  subtitulo?: string;
  meta?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{valor}</div>
        {subtitulo && (
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        )}
        {meta && (
          <p className="mt-1 text-xs text-muted-foreground">
            Meta: {meta}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Panel de exportación para MINSAL/ISSS
// ---------------------------------------------------------------------------

function ExportPanel() {
  const [periodoInicio, setPeriodoInicio] = React.useState(
    new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0] ?? "",
  );
  const [periodoFin, setPeriodoFin] = React.useState(
    new Date().toISOString().split("T")[0] ?? "",
  );
  const [tipo, setTipo] = React.useState<"MINSAL" | "ISSS" | "INTERNO">("INTERNO");
  const [ready, setReady] = React.useState(false);

  const { data, isLoading, isError } = trpc.comiteEce.exportReport.useQuery(
    {
      periodoInicio: new Date(periodoInicio),
      periodoFin: new Date(periodoFin),
      tipo,
    },
    { enabled: ready },
  );

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setReady(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporte institucional (US.F2.7.48)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleGenerate} className="flex flex-wrap items-end gap-3" aria-label="Generar reporte de auditoría">
          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="periodo-inicio">
              Período inicio
            </label>
            <input
              id="periodo-inicio"
              type="date"
              className="rounded border px-2 py-1 text-sm"
              value={periodoInicio}
              onChange={(e) => { setPeriodoInicio(e.target.value); setReady(false); }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="periodo-fin">
              Período fin
            </label>
            <input
              id="periodo-fin"
              type="date"
              className="rounded border px-2 py-1 text-sm"
              value={periodoFin}
              onChange={(e) => { setPeriodoFin(e.target.value); setReady(false); }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="tipo-reporte">
              Tipo
            </label>
            <select
              id="tipo-reporte"
              className="rounded border px-2 py-1 text-sm"
              value={tipo}
              onChange={(e) => { setTipo(e.target.value as typeof tipo); setReady(false); }}
            >
              <option value="INTERNO">Interno</option>
              <option value="MINSAL">MINSAL</option>
              <option value="ISSS">ISSS</option>
            </select>
          </div>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Generando…" : "Generar"}
          </Button>
        </form>

        {isError && (
          <p role="alert" className="text-sm text-destructive">
            Error al generar el reporte.
          </p>
        )}

        {data && (
          <div className="rounded border p-4 space-y-3 text-sm" aria-live="polite" aria-label="Resultado del reporte">
            <p>
              <strong>Período:</strong>{" "}
              {new Date(data.periodoInicio).toLocaleDateString("es-SV")} —{" "}
              {new Date(data.periodoFin).toLocaleDateString("es-SV")}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded bg-muted p-2 text-center">
                <p className="text-2xl font-bold">
                  {data.periodoStats.totalEpisodios}
                </p>
                <p className="text-xs text-muted-foreground">Total episodios</p>
              </div>
              <div className="rounded bg-muted p-2 text-center">
                <p className="text-2xl font-bold">
                  {data.periodoStats.totalCerrados}
                </p>
                <p className="text-xs text-muted-foreground">Cerrados</p>
              </div>
              <div className="rounded bg-muted p-2 text-center">
                <p className="text-2xl font-bold">
                  {data.periodoStats.totalConCie10}
                </p>
                <p className="text-xs text-muted-foreground">Con CIE-10</p>
              </div>
              <div className="rounded bg-muted p-2 text-center">
                <p className="text-2xl font-bold">
                  {data.periodoStats.pctCie10}%
                </p>
                <p className="text-xs text-muted-foreground">Cobertura CIE-10</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Minutas del comité en el período: {data.minutas.length}
            </p>
            <p className="text-xs text-muted-foreground italic">
              Para generar el PDF con membrete, use el botón de impresión del
              navegador o solicite la exportación PDF al módulo de reportes.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function CalidadDocumentalPage() {
  const { data, isLoading, isError } = trpc.comiteEce.dashboard.useQuery();

  const kpis = data?.kpis ?? [];
  const firstKpi = kpis[0];

  return (
    <main className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Calidad Documental</h1>
        <p className="text-sm text-muted-foreground">
          Art. 32 NTEC — KPIs de completitud, firma y codificación CIE-10.
          Vista actualizada cada hora.
        </p>
      </header>

      {isLoading && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Cargando KPIs…
        </p>
      )}

      {isError && (
        <p role="alert" className="text-sm text-destructive">
          Error al cargar el dashboard.
        </p>
      )}

      {data?.mensaje && (
        <p className="text-sm text-amber-600" role="status">
          {data.mensaje}
        </p>
      )}

      {/* Tarjetas KPI principales (90 días) */}
      {firstKpi && (
        <section aria-label="Indicadores de calidad documental (últimos 90 días)">
          <h2 className="mb-3 text-lg font-medium">
            Indicadores — últimos 90 días
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              titulo="Episodios cerrados"
              valor={firstKpi.totalEpisodiosCerrados}
              subtitulo="Período 90 días"
            />
            <KpiCard
              titulo="Cobertura CIE-10 al cierre"
              valor={pctBadge(firstKpi.pctCoberturaCie10)}
              subtitulo={`${firstKpi.totalConCie10} de ${firstKpi.totalEpisodiosCerrados}`}
              meta="≥ 95%"
            />
            <KpiCard
              titulo="Tiempo promedio hasta egreso"
              valor={formatHoras(firstKpi.promedioHorasHastaEgreso)}
              subtitulo="Desde cierre episodio hasta epicrisis"
              meta="< 24 h"
            />
            <KpiCard
              titulo="Rectificaciones del mes"
              valor={firstKpi.totalRectificacionesMes}
              subtitulo="Total cambios del mes corriente"
            />
          </div>
        </section>
      )}

      {/* Tabla por establecimiento (multi-establecimiento) */}
      {kpis.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Detalle por establecimiento</CardTitle>
          </CardHeader>
          <CardContent>
            <Table aria-label="KPIs por establecimiento">
              <TableHeader>
                <TableRow>
                  <TableHead>Establecimiento</TableHead>
                  <TableHead>Ep. cerrados</TableHead>
                  <TableHead>CIE-10 %</TableHead>
                  <TableHead>Prom. horas egreso</TableHead>
                  <TableHead>Rectif. mes</TableHead>
                  <TableHead>Calculado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpis.map((k) => (
                  <TableRow key={k.establecimientoId}>
                    <TableCell className="font-mono text-xs">
                      {k.establecimientoId.slice(0, 8)}…
                    </TableCell>
                    <TableCell>{k.totalEpisodiosCerrados}</TableCell>
                    <TableCell>{pctBadge(k.pctCoberturaCie10)}</TableCell>
                    <TableCell>{formatHoras(k.promedioHorasHastaEgreso)}</TableCell>
                    <TableCell>{k.totalRectificacionesMes}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(k.calculadoEn).toLocaleTimeString("es-SV")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Panel de exportación */}
      <ExportPanel />
    </main>
  );
}
