"use client";

/**
 * §16 eMAR — Listado de administraciones de medicamentos.
 *
 * Skeleton Wave 7. Filtra por status; detalle de BCMA/doble-check viene
 * en iteraciones siguientes.
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
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type MedAdminStatus =
  | "GIVEN"
  | "HELD"
  | "REFUSED"
  | "MISSED"
  | "DOCUMENTED_LATE";

const STATUS_OPTIONS: { value: MedAdminStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "GIVEN", label: "Administrado" },
  { value: "HELD", label: "Pendiente" },
  { value: "REFUSED", label: "Rechazado" },
  { value: "MISSED", label: "Omitido" },
  { value: "DOCUMENTED_LATE", label: "Doc. tardía" },
];

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function EmarListPage() {
  const [status, setStatus] = React.useState<MedAdminStatus | "ALL">("ALL");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (status !== "ALL") input.status = status;
    return input;
  }, [status]);

  const query = trpc.medicationAdmin.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">eMAR — Administración de medicamentos</h1>
          <p className="text-sm text-muted-foreground">
            Registro electrónico de administraciones (§16).
          </p>
        </div>
        <Button asChild>
          <Link href="/emar/new">Nueva administración</Link>
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
                onValueChange={(v) => setStatus(v as MedAdminStatus | "ALL")}
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Administraciones</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin registros.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Medicamento</TableHead>
                  <TableHead>Administrado por</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Dosis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((a) => {
                  const drugName = a.prescriptionItem?.drug?.genericName ?? "—";
                  const adminName = a.administeredBy?.fullName ?? "—";
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="tabular-nums">
                        {dateFmt.format(new Date(a.administeredAt))}
                      </TableCell>
                      <TableCell>{drugName}</TableCell>
                      <TableCell>{adminName}</TableCell>
                      <TableCell>{a.status}</TableCell>
                      <TableCell className="tabular-nums">
                        {a.doseAmount ? `${String(a.doseAmount)} ${a.doseUnit ?? ""}` : "—"}
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
