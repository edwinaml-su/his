"use client";

/**
 * §21 Respiratory — listado de órdenes legacy (O₂/VMI/nebulización/CPAP).
 * CC-0042: extraído de la antigua page.tsx al convertirse el módulo en shell
 * con pestañas (CPOE-TR + worklist + parametrización). Comportamiento intacto.
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

type OrderStatus = "ACTIVE" | "COMPLETED" | "CANCELLED" | "ON_HOLD";

const STATUS_OPTIONS: { value: OrderStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "ACTIVE", label: "Activa" },
  { value: "ON_HOLD", label: "En espera" },
  { value: "COMPLETED", label: "Completada" },
  { value: "CANCELLED", label: "Cancelada" },
];

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "short", timeStyle: "short" });

export function OrdenesLegacy() {
  const [status, setStatus] = React.useState<OrderStatus | "ALL">("ACTIVE");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (status !== "ALL") input.status = status;
    return input;
  }, [status]);

  const query = trpc.respiratory.order.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Órdenes rápidas legacy (O₂, ventilación, nebulización y CPAP/BIPAP — §21).
        </p>
        <Button asChild variant="outline">
          <Link href="/respiratory/new">Orden rápida (legacy)</Link>
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
              <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus | "ALL")}>
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
            <p className="text-sm text-muted-foreground">Sin órdenes para el filtro.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Prescriptor</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>FiO₂ (%)</TableHead>
                  <TableHead>Flujo (L/min)</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((o) => {
                  const patientName = o.patient ? `${o.patient.firstName} ${o.patient.lastName}` : "—";
                  return (
                    <TableRow key={o.id}>
                      <TableCell>{patientName}</TableCell>
                      <TableCell>{o.prescriber?.fullName ?? "—"}</TableCell>
                      <TableCell>{o.type}</TableCell>
                      <TableCell className="tabular-nums">{o.fio2?.toString() ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{o.flowRate?.toString() ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{dateFmt.format(new Date(o.startedAt))}</TableCell>
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
