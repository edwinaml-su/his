"use client";

/**
 * §12 Emergency — Listado de visitas a urgencias.
 *
 * Filtros por disposition y rango de fechas. Skeleton (Wave 7); detail page con
 * notas evolutivas pendiente.
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

type Disposition =
  | "PENDING"
  | "DISCHARGED"
  | "ADMITTED"
  | "TRANSFERRED"
  | "LWBS"
  | "AMA"
  | "DECEASED";

const OPTIONS: { value: Disposition | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "PENDING", label: "Pendiente" },
  { value: "DISCHARGED", label: "Alta" },
  { value: "ADMITTED", label: "Admitido a hospitalización" },
  { value: "TRANSFERRED", label: "Trasladado" },
  { value: "LWBS", label: "Se retiró sin ser atendido" },
  { value: "AMA", label: "Alta contra recomendación" },
  { value: "DECEASED", label: "Fallecido" },
];

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function EmergencyListPage() {
  const [disposition, setDisposition] = React.useState<Disposition | "ALL">("ALL");
  const [from, setFrom] = React.useState("");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (disposition !== "ALL") input.disposition = disposition;
    if (from) input.fromDate = new Date(from);
    return input;
  }, [disposition, from]);

  const query = trpc.emergency.visit.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Urgencias</h1>
          <p className="text-sm text-muted-foreground">
            Visitas a urgencias y su disposición (§12).
          </p>
        </div>
        <Button asChild>
          <Link href="/emergency/new">Nueva visita</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-disposition">Disposición</Label>
              <Select
                value={disposition}
                onValueChange={(v) => setDisposition(v as Disposition | "ALL")}
              >
                <SelectTrigger id="filter-disposition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-from">Desde</Label>
              <Input
                id="filter-from"
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Visitas</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin visitas registradas.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Llegada</TableHead>
                  <TableHead>Disposición</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((v) => {
                  const patientName = v.patient
                    ? `${v.patient.firstName} ${v.patient.lastName}`
                    : "—";
                  return (
                    <TableRow key={v.id}>
                      <TableCell>{patientName}</TableCell>
                      <TableCell className="tabular-nums">
                        {dateFmt.format(new Date(v.arrivedAt))}
                      </TableCell>
                      <TableCell>{v.disposition}</TableCell>
                      <TableCell className="max-w-[20rem] truncate">
                        {v.chiefComplaint}
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
