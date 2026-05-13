"use client";

/**
 * §15 Pharmacy — Listado de recetas.
 *
 * Tabla paginada con filtros client-side por encuentro, paciente,
 * prescriptor y fecha desde. La query se envía al sub-router
 * `trpc.pharmacy.prescription.list` (skeleton en branch
 * claude/team3-pharmacy). Mientras el AppRouter no incluya pharmacy
 * (merge pendiente), se castea con `eslint-disable` siguiendo el patrón
 * usado en /transfers.
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
import { trpc } from "@/lib/trpc/react";
import {
  PrescriptionStatusBadge,
  type PrescriptionStatus,
} from "./_components/prescription-status-badge";

interface PrescriptionListItem {
  id: string;
  prescribedAt: string | Date;
  status: PrescriptionStatus;
  notes?: string | null;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
  };
  encounter: {
    id: string;
    encounterNumber: string;
  };
  prescriber: {
    id: string;
    firstName: string;
    lastName: string;
  };
  items: Array<{ id: string }>;
}

export default function PharmacyListPage(): React.ReactElement {
  const [encounterId, setEncounterId] = React.useState("");
  const [patientId, setPatientId] = React.useState("");
  const [prescriberId, setPrescriberId] = React.useState("");
  const [fromDate, setFromDate] = React.useState("");

  // El AppRouter aún no expone `pharmacy` en main; este cast desaparece
  // cuando team3-pharmacy se mergee. Mismo patrón que /transfers usa con
  // encounterTransfer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const list = trpcAny.pharmacy.prescription.list.useQuery({
    encounterId: encounterId.trim() || undefined,
    patientId: patientId.trim() || undefined,
    prescriberId: prescriberId.trim() || undefined,
    fromDate: fromDate ? new Date(fromDate) : undefined,
  });

  const items = (list.data?.items ?? list.data ?? []) as PrescriptionListItem[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Farmacia · Recetas</h1>
          <p className="text-sm text-muted-foreground">
            Recetas activas y su trazabilidad de despachos (TDR §15).
          </p>
        </div>
        <Button asChild>
          <Link href="/pharmacy/new">Nueva receta</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="filter-encounter">Encuentro</Label>
              <Input
                id="filter-encounter"
                placeholder="encounterId"
                value={encounterId}
                onChange={(e) => setEncounterId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-patient">Paciente</Label>
              <Input
                id="filter-patient"
                placeholder="patientId"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-prescriber">Prescriptor</Label>
              <Input
                id="filter-prescriber"
                placeholder="prescriberId"
                value={prescriberId}
                onChange={(e) => setPrescriberId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-from">Desde</Label>
              <Input
                id="filter-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recetas</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay recetas con estos filtros.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Encuentro</TableHead>
                  <TableHead>Prescriptor</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right"># ítems</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((rx) => (
                  <TableRow key={rx.id}>
                    <TableCell>
                      {rx.patient.firstName} {rx.patient.lastName}
                      <span className="ml-1 text-xs text-muted-foreground">
                        (MRN {rx.patient.mrn})
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {rx.encounter.encounterNumber}
                    </TableCell>
                    <TableCell>
                      {rx.prescriber.firstName} {rx.prescriber.lastName}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {new Date(rx.prescribedAt).toLocaleString("es-SV")}
                    </TableCell>
                    <TableCell>
                      <PrescriptionStatusBadge status={rx.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rx.items.length}
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/pharmacy/${rx.id}`}>Ver</Link>
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
