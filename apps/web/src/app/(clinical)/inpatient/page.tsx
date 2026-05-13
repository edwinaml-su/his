"use client";

/**
 * §11 Inpatient — Listado de admisiones hospitalarias.
 *
 * Filtros client-side via `trpc.inpatient.admission.list`. Estado mínimo
 * (Wave 7 skeleton): pendiente detail page con vitals/kardex/care plans.
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
import { trpc } from "@/lib/trpc/react";

type InpatientStatus = "ACTIVE" | "ON_LEAVE" | "DISCHARGED" | "TRANSFERRED_OUT";

const STATUS_OPTIONS: { value: InpatientStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "ACTIVE", label: "Activos" },
  { value: "ON_LEAVE", label: "Con permiso" },
  { value: "DISCHARGED", label: "Egresados" },
  { value: "TRANSFERRED_OUT", label: "Trasladados" },
];

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function InpatientListPage() {
  const [status, setStatus] = React.useState<InpatientStatus | "ALL">("ALL");
  const [patientId, setPatientId] = React.useState("");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (status !== "ALL") input.status = status;
    if (patientId.trim()) input.patientId = patientId.trim();
    return input;
  }, [status, patientId]);

  const query = trpc.inpatient.admission.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Hospitalización</h1>
          <p className="text-sm text-muted-foreground">
            Admisiones hospitalarias activas y egresadas (§11).
          </p>
        </div>
        <Button asChild>
          <Link href="/inpatient/new" aria-label="Nueva admisión">
            Nueva admisión
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
              <Label htmlFor="filter-status">Estado</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as InpatientStatus | "ALL")}
              >
                <SelectTrigger id="filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-patient">Paciente (UUID)</Label>
              <Input
                id="filter-patient"
                placeholder="UUID del paciente"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admisiones</CardTitle>
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
              Sin admisiones para los filtros seleccionados.
            </p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Médico tratante</TableHead>
                  <TableHead>Admitido</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((adm) => {
                  const patientName = adm.patient
                    ? `${adm.patient.firstName} ${adm.patient.lastName}`
                    : "—";
                  const attendingName = adm.attending?.fullName ?? "—";
                  return (
                    <TableRow key={adm.id}>
                      <TableCell>{patientName}</TableCell>
                      <TableCell>{attendingName}</TableCell>
                      <TableCell className="tabular-nums">
                        {dateFmt.format(new Date(adm.admittedAt))}
                      </TableCell>
                      <TableCell>{adm.status}</TableCell>
                      <TableCell className="max-w-[20rem] truncate">
                        {adm.reason}
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
