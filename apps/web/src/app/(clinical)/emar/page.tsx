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
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { DataCardList, type DataCardColumn } from "@his/ui/components/data-card-list";
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

const STATUS_LABEL: Record<MedAdminStatus, string> = {
  GIVEN: "Administrado",
  HELD: "Pendiente",
  REFUSED: "Rechazado",
  MISSED: "Omitido",
  DOCUMENTED_LATE: "Doc. tardía",
};

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

  type Row = NonNullable<typeof query.data>[number];

  const columns: DataCardColumn<Row>[] = React.useMemo(
    () => [
      {
        id: "medicamento",
        header: "Medicamento",
        primary: true,
        cell: (a) => a.prescriptionItem?.drug?.genericName ?? "—",
      },
      {
        id: "fecha",
        header: "Fecha",
        cell: (a) => (
          <span className="tabular-nums">
            {dateFmt.format(new Date(a.administeredAt))}
          </span>
        ),
      },
      {
        id: "estado",
        header: "Estado",
        cell: (a) => STATUS_LABEL[a.status as MedAdminStatus] ?? a.status,
      },
      {
        id: "dosis",
        header: "Dosis",
        align: "right",
        cell: (a) => (
          <span className="tabular-nums">
            {a.doseAmount ? `${String(a.doseAmount)} ${a.doseUnit ?? ""}` : "—"}
          </span>
        ),
      },
      {
        id: "administradoPor",
        header: "Administrado por",
        hideOnMobile: true,
        cell: (a) => a.administeredBy?.fullName ?? "—",
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">eMAR — Administración de medicamentos</h1>
          <p className="text-sm text-muted-foreground">
            Registro electrónico de administraciones (§16).
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href="/emar/new">Nueva administración</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full space-y-1.5 sm:max-w-xs">
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
          {query.data && (
            <DataCardList
              data={query.data}
              getKey={(a) => a.id}
              columns={columns}
              emptyMessage="Sin administraciones registradas."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
