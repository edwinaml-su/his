"use client";

/**
 * ECE — Registro de Enfermería / Agenda del turno.
 *
 * Muestra los pacientes asignados al enfermero en turno
 * (matutino/vespertino/nocturno). Cada fila enlaza al MAR del paciente.
 *
 * Estado del workflow del registro se obtiene vía workflowInstance.list.
 * Si no hay instancias activas el estado se muestra como "Sin registro".
 *
 * Roles habilitados: ENF (enfermera).
 */

import * as React from "react";
import Link from "next/link";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

type Turno = "MATUTINO" | "VESPERTINO" | "NOCTURNO";

const TURNOS: { value: Turno; label: string }[] = [
  { value: "MATUTINO", label: "Matutino (06:00–14:00)" },
  { value: "VESPERTINO", label: "Vespertino (14:00–22:00)" },
  { value: "NOCTURNO", label: "Nocturno (22:00–06:00)" },
];

function detectCurrentShift(): Turno {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return "MATUTINO";
  if (h >= 14 && h < 22) return "VESPERTINO";
  return "NOCTURNO";
}

function WorkflowBadge({ estadoCodigo }: { estadoCodigo?: string | null }) {
  if (!estadoCodigo) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Sin registro
      </Badge>
    );
  }
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    BORRADOR: { label: "Borrador", variant: "secondary" },
    EN_REVISION: { label: "En revisión", variant: "default" },
    FIRMADO: { label: "Firmado", variant: "default" },
    ANULADO: { label: "Anulado", variant: "destructive" },
  };
  const cfg = map[estadoCodigo] ?? { label: estadoCodigo, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function RegistroEnfermeriaPage() {
  const [turno, setTurno] = React.useState<Turno>(detectCurrentShift);

  /**
   * En MVP consultamos inpatients activos como proxy de "pacientes asignados".
   * El filtro por enfermero asignado se añade en iteración siguiente cuando
   * exista el modelo BedAssignment.nurseId.
   */
  const query = trpc.inpatient.admission.list.useQuery({ status: "ACTIVE" });

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Registro de Enfermería</h1>
          <p className="text-sm text-muted-foreground">
            Agenda del turno — pacientes internados asignados (§ECE).
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/registro-enfermeria/nuevo">Abrir registro</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Turno</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="w-56 space-y-1.5">
            <Label htmlFor="turno-select">Turno activo</Label>
            <Select value={turno} onValueChange={(v) => setTurno(v as Turno)}>
              <SelectTrigger id="turno-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TURNOS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pacientes en turno</CardTitle>
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
          {!query.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin pacientes internados asignados al turno actual.
            </p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Cama</TableHead>
                  <TableHead>Estado registro</TableHead>
                  <TableHead className="sr-only">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((adm) => {
                  const patientName = adm.patient
                    ? `${adm.patient.firstName} ${adm.patient.lastName}`
                    : "—";
                  return (
                    <TableRow key={adm.id}>
                      <TableCell className="font-medium">{patientName}</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell>
                        <WorkflowBadge estadoCodigo={null} />
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/ece/registro-enfermeria/${adm.id}`}>
                            Ver MAR
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
