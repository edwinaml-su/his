"use client";

/**
 * §16 NTEC Anatomía Patológica — Listado de solicitudes de patología.
 *
 * HH-16 Sprint S7. UI mínima: lista de PathologyOrder con filtro por status.
 * Operaciones avanzadas (recepción de especímenes, macroscopía, microscopía,
 * firma de reporte) se implementan en iteraciones posteriores.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type PathologyOrderStatus =
  | "REQUESTED"
  | "COLLECTING"
  | "IN_PROCESS"
  | "REPORTED"
  | "CANCELLED";

const STATUS_OPTIONS: { value: PathologyOrderStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "REQUESTED", label: "Solicitada" },
  { value: "COLLECTING", label: "Recolectando" },
  { value: "IN_PROCESS", label: "En proceso" },
  { value: "REPORTED", label: "Reportada" },
  { value: "CANCELLED", label: "Cancelada" },
];

const STUDY_LABELS: Record<string, string> = {
  HISTOPATHOLOGY: "Histopatología",
  CYTOLOGY: "Citología",
  BIOPSY: "Biopsia",
  IMMUNOHISTOCHEMISTRY: "Inmunohistoquímica",
  AUTOPSY: "Autopsia",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function PathologyListPage() {
  const [status, setStatus] = React.useState<PathologyOrderStatus | "ALL">("ALL");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (status !== "ALL") input.status = status;
    return input;
  }, [status]);

  const query = trpc.pathology.order.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Anatomía Patológica</h1>
          <p className="text-sm text-muted-foreground">
            Solicitudes de estudios histopatológicos y citológicos (§16 NTEC).
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="filter-status">Estado</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as PathologyOrderStatus | "ALL")}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Solicitudes</CardTitle>
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
            <p className="text-sm text-muted-foreground">Sin solicitudes.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo de estudio</TableHead>
                  <TableHead>Prioridad</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Especimenes</TableHead>
                  <TableHead>Reporte</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="tabular-nums">
                      {dateFmt.format(new Date(order.requestedAt))}
                    </TableCell>
                    <TableCell>
                      {STUDY_LABELS[order.studyType] ?? order.studyType}
                    </TableCell>
                    <TableCell>{order.priority}</TableCell>
                    <TableCell>{order.status}</TableCell>
                    <TableCell>{order.specimens.length}</TableCell>
                    <TableCell>
                      {order.report.length > 0
                        ? order.report[0]?.status
                        : "—"}
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
