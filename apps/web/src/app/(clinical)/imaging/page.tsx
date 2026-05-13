"use client";

/**
 * §18 RIS/PACS — Listado de órdenes de imagen.
 *
 * Skeleton Wave 7. Filtra por status y modalidad; integración DICOM real
 * (modality worklist, viewer) viene en iteraciones siguientes.
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

type ImagingOrderStatus =
  | "ORDERED"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "ACQUIRED"
  | "REPORTED"
  | "CANCELLED";

type ModalityType =
  | "CR"
  | "CT"
  | "MR"
  | "US"
  | "XA"
  | "MG"
  | "NM"
  | "PT"
  | "OTHER";

const STATUS_OPTIONS: { value: ImagingOrderStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "ORDERED", label: "Ordenada" },
  { value: "SCHEDULED", label: "Programada" },
  { value: "IN_PROGRESS", label: "En curso" },
  { value: "ACQUIRED", label: "Adquirida" },
  { value: "REPORTED", label: "Reportada" },
  { value: "CANCELLED", label: "Cancelada" },
];

const MODALITY_OPTIONS: { value: ModalityType | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "CR", label: "RX (CR)" },
  { value: "CT", label: "TAC (CT)" },
  { value: "MR", label: "RMN (MR)" },
  { value: "US", label: "Ecografía (US)" },
  { value: "XA", label: "Angiografía (XA)" },
  { value: "MG", label: "Mamografía (MG)" },
  { value: "NM", label: "Medicina Nuclear (NM)" },
  { value: "PT", label: "PET (PT)" },
  { value: "OTHER", label: "Otra" },
];

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function ImagingListPage() {
  const [status, setStatus] = React.useState<ImagingOrderStatus | "ALL">("ALL");
  const [modality, setModality] = React.useState<ModalityType | "ALL">("ALL");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (status !== "ALL") input.status = status;
    if (modality !== "ALL") input.modalityType = modality;
    return input;
  }, [status, modality]);

  const query = trpc.imaging.order.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Imagenología (RIS/PACS)</h1>
          <p className="text-sm text-muted-foreground">
            Órdenes de estudios de imagen (§18).
          </p>
        </div>
        <Button asChild>
          <Link href="/imaging/new">Nueva orden</Link>
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
                onValueChange={(v) => setStatus(v as ImagingOrderStatus | "ALL")}
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
              <Label htmlFor="filter-modality">Modalidad</Label>
              <Select
                value={modality}
                onValueChange={(v) => setModality(v as ModalityType | "ALL")}
              >
                <SelectTrigger id="filter-modality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODALITY_OPTIONS.map((o) => (
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
          <CardTitle>Órdenes</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin órdenes.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Modalidad</TableHead>
                  <TableHead>Estudio</TableHead>
                  <TableHead>Prioridad</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((o) => {
                  const patientName = o.patient
                    ? `${o.patient.firstName} ${o.patient.lastName}`
                    : "—";
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="tabular-nums">
                        {dateFmt.format(new Date(o.createdAt))}
                      </TableCell>
                      <TableCell>{patientName}</TableCell>
                      <TableCell>{o.modalityType}</TableCell>
                      <TableCell className="max-w-[20rem] truncate">
                        {o.studyDescription}
                      </TableCell>
                      <TableCell>{o.priority}</TableCell>
                      <TableCell>{o.status}</TableCell>
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
