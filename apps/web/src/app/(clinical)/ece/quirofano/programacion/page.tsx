"use client";

/**
 * Programación Quirúrgica — Calendario por sala QX.
 *
 * Vista de cronograma diario: agrupa las cirugías programadas por hora de inicio.
 * Permite filtrar por sala QX y fecha. Acceso: PHYSICIAN | NURSE | ADM.
 *
 * Para programar una nueva cirugía el médico usa el botón "Nueva programación"
 * que lleva al flujo de orden quirúrgica.
 *
 * @QA E2E: verificar que la tabla muestra cirugías del día; filtrar por sala;
 *   navegar a "Nueva programación"; verificar CONFLICT al intentar reservar
 *   sala ocupada.
 */

import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
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
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/El_Salvador",
});

const ESTADO_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  programado:  "secondary",
  confirmado:  "default",
  en_curso:    "default",
  finalizado:  "outline",
  cancelado:   "destructive",
};

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ProgramacionQuirofanoPage() {
  const [fecha, setFecha]       = React.useState<string>(hoy);
  const [salaQxId, setSalaQxId] = React.useState<string>("");

  const queryInput = React.useMemo(
    () => ({
      fecha,
      ...(salaQxId.trim() ? { salaQxId: salaQxId.trim() } : {}),
    }),
    [fecha, salaQxId],
  );

  const query = trpc.eceBridgeCirugia.listProgramacionDia.useQuery(queryInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Programación Quirúrgica</h1>
          <p className="text-sm text-muted-foreground">
            Cronograma de cirugías por sala y fecha (ECE — Quirófano).
          </p>
        </div>
        <Button asChild>
          <Link
            href="/ece/quirofano/programacion/nueva"
            aria-label="Programar nueva cirugía"
          >
            Nueva programación
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-fecha">Fecha</Label>
              <Input
                id="filter-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-sala">Sala QX (UUID, opcional)</Label>
              <Input
                id="filter-sala"
                placeholder="Dejar vacío para todas las salas"
                value={salaQxId}
                onChange={(e) => setSalaQxId(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cirugías del día</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin cirugías programadas para los filtros seleccionados.
            </p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hora inicio</TableHead>
                  <TableHead>Duración</TableHead>
                  <TableHead>Sala</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Procedimiento (CIE-10)</TableHead>
                  <TableHead>Cirujano</TableHead>
                  <TableHead>Anestesiólogo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((item) => (
                  <TableRow key={item.ordenId}>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      {dateFmt.format(new Date(item.fechaProgramada))}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {item.duracionMin} min
                    </TableCell>
                    <TableCell>{item.salaNombre}</TableCell>
                    <TableCell>{item.pacienteNombre}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.procedimientoCie10}
                    </TableCell>
                    <TableCell>{item.cirujanoNombre}</TableCell>
                    <TableCell>{item.anestesiologoNombre ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={ESTADO_BADGE[item.estado] ?? "outline"}>
                        {item.estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.preOpChecklistId && (
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/ece/quirofano/programacion/${item.ordenId}`}
                            aria-label={`Ver programación ${item.ordenId}`}
                          >
                            Ver
                          </Link>
                        </Button>
                      )}
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
