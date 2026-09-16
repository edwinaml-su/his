"use client";

/**
 * Tablero del día — CC-0036 Ola 4 (REQ-HIS-AFIL-001 S4, US.AGE.2.7 AC3/AC4).
 *
 * Extiende el módulo legacy §10 Consulta Externa (`/outpatient`) en vez de
 * crear una ruta paralela — regla "adecuar legacy, no duplicar". Consume
 * `outpatient.tablero.dia` (packages/trpc/src/routers/outpatient.router.ts).
 * Polling de 30s (AC3 "actualizados en tiempo real"). El filtro por
 * consultorio (AC4, drilldown) se aplica client-side sobre el resultado ya
 * cargado del día — evita una query adicional de catálogo.
 */
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";
import { StatusBadge, type AppointmentStatus } from "../_components/status-badge";

/** America/El_Salvador es UTC-6 fijo, sin horario de verano (NFR-6). */
function hoyLocal(): string {
  const local = new Date(Date.now() - 6 * 3_600_000);
  return local.toISOString().slice(0, 10);
}

const horaFmt = new Intl.DateTimeFormat("es-SV", { timeStyle: "short" });

const RESUMEN_TILES: Array<{ key: "programadas" | "llegadas" | "enAtencion" | "completadas" | "noShow" | "sobrecupos"; label: string }> = [
  { key: "programadas", label: "Programadas" },
  { key: "llegadas", label: "Llegadas" },
  { key: "enAtencion", label: "En atención" },
  { key: "completadas", label: "Completadas" },
  { key: "noShow", label: "No-show" },
  { key: "sobrecupos", label: "Sobrecupos" },
];

export default function TableroDiaPage() {
  const [fecha, setFecha] = React.useState(hoyLocal());
  const [consultorioFiltro, setConsultorioFiltro] = React.useState<string>("ALL");

  const query = trpc.outpatient.tablero.dia.useQuery(
    { fecha },
    { refetchInterval: 30_000 },
  );

  const consultorios = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const item of query.data?.items ?? []) {
      if (item.consultorio) map.set(item.consultorio.id, `${item.consultorio.codigo} — ${item.consultorio.nombre}`);
    }
    return Array.from(map.entries());
  }, [query.data]);

  const items = React.useMemo(() => {
    const all = query.data?.items ?? [];
    if (consultorioFiltro === "ALL") return all;
    return all.filter((i) => i.consultorio?.id === consultorioFiltro);
  }, [query.data, consultorioFiltro]);

  const resumen = query.data?.resumen;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Tablero del día — Consulta Externa</h1>
          <p className="text-sm text-muted-foreground">
            Estado en tiempo real por consultorio y médico (US.AGE.2.7). Se actualiza automáticamente cada 30 segundos.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/outpatient" aria-label="Volver al listado de citas">
            Volver al listado
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="tablero-fecha">Fecha</Label>
            <Input
              id="tablero-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tablero-consultorio">Consultorio</Label>
            <Select value={consultorioFiltro} onValueChange={setConsultorioFiltro}>
              <SelectTrigger id="tablero-consultorio" className="w-64">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los consultorios</SelectItem>
                {consultorios.map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {resumen && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {RESUMEN_TILES.map((tile) => (
            <Card key={tile.key}>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold tabular-nums">{resumen[tile.key]}</p>
                <p className="text-xs text-muted-foreground">{tile.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Citas del día</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && items.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin citas para los filtros seleccionados.</p>
          )}
          {items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hora</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Consultorio</TableHead>
                  <TableHead>Médico</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="tabular-nums">{horaFmt.format(new Date(c.scheduledAt))}</TableCell>
                    <TableCell>
                      {c.patientName} <span className="text-muted-foreground">({c.mrn})</span>
                      {c.esSobrecupo && (
                        <Badge variant="warning" className="ml-2">
                          Sobrecupo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{c.consultorio ? `${c.consultorio.codigo} — ${c.consultorio.nombre}` : "—"}</TableCell>
                    <TableCell>{c.medicoAfiliado?.nombreCompleto ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.status as AppointmentStatus} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/outpatient/${c.id}`} aria-label={`Ver cita de ${c.patientName}`}>
                          Ver
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
