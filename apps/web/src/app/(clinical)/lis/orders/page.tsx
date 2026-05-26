"use client";

/**
 * §17 LIS — Listado de órdenes de laboratorio.
 *
 * Filtros server-side vía `trpc.lis.order.list` (encounterId, patientId,
 * priority, status, fromDate). Cada fila enlaza al detalle
 * `/lis/orders/[id]`.
 *
 * HH-10 (audit Stream H): `lis: lisRouter` está montado en _app.ts:241,
 * los casts `as unknown` ya no son necesarios — acceso directo `trpc.lis`.
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
import { parseDateOnly } from "@/lib/date-only";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type LabPriority = "ROUTINE" | "URGENT" | "STAT";
type LabOrderStatus =
  | "DRAFT"
  | "ORDERED"
  | "COLLECTED"
  | "IN_PROCESS"
  | "RESULTED"
  | "VALIDATED"
  | "CANCELLED";

// HH-10: tipos inferidos del router montado.
type RouterOutput = inferRouterOutputs<AppRouter>;
type LabOrderListItem = RouterOutput["lis"]["order"]["list"][number];
type RouterInput = inferRouterInputs<AppRouter>;
type LabOrderListInput = RouterInput["lis"]["order"]["list"];

const PRIORITY_BADGE: Record<LabPriority, string> = {
  ROUTINE: "bg-slate-100 text-slate-700",
  URGENT: "bg-amber-100 text-amber-800",
  STAT: "bg-red-100 text-red-700 font-bold",
};

const PRIORITY_LABEL: Record<LabPriority, string> = {
  ROUTINE: "Rutina",
  URGENT: "Urgente",
  STAT: "STAT",
};

const STATUS_LABEL: Record<LabOrderStatus, string> = {
  DRAFT: "Borrador",
  ORDERED: "Solicitada",
  COLLECTED: "Recolectada",
  IN_PROCESS: "En proceso",
  RESULTED: "Con resultado",
  VALIDATED: "Validada",
  CANCELLED: "Cancelada",
};

const ALL = "__ALL__";

export default function LisOrdersPage(): React.ReactElement {
  const [encounterId, setEncounterId] = React.useState("");
  const [patientId, setPatientId] = React.useState("");
  const [priority, setPriority] = React.useState<LabPriority | "">("");
  const [status, setStatus] = React.useState<LabOrderStatus | "">("");
  const [fromDate, setFromDate] = React.useState("");

  const queryInput: LabOrderListInput = {
    ...(encounterId.trim() && { encounterId: encounterId.trim() }),
    ...(patientId.trim() && { patientId: patientId.trim() }),
    ...(priority && { priority }),
    ...(status && { status }),
    // HH-07 (audit Stream H): `new Date("YYYY-MM-DD")` interpreta UTC midnight
    // → en UTC-6 (es-SV) genera shift de -1 día y oculta órdenes del día filtrado.
    ...((() => {
      const parsed = parseDateOnly(fromDate);
      return parsed ? { fromDate: parsed } : {};
    })()),
    limit: 50,
  };

  const list = trpc.lis.order.list.useQuery(queryInput);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Órdenes de Laboratorio</h1>
        <Button asChild>
          <Link href="/lis/orders/new">Nueva orden</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="filter-encounter">Encuentro</Label>
              <Input
                id="filter-encounter"
                value={encounterId}
                onChange={(e) => setEncounterId(e.target.value)}
                placeholder="UUID encuentro"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-patient">Paciente</Label>
              <Input
                id="filter-patient"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="UUID paciente"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <Select
                value={priority || ALL}
                onValueChange={(v) =>
                  setPriority(v === ALL ? "" : (v as LabPriority))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas</SelectItem>
                  <SelectItem value="ROUTINE">Rutina</SelectItem>
                  <SelectItem value="URGENT">Urgente</SelectItem>
                  <SelectItem value="STAT">STAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select
                value={status || ALL}
                onValueChange={(v) =>
                  setStatus(v === ALL ? "" : (v as LabOrderStatus))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos</SelectItem>
                  {(Object.keys(STATUS_LABEL) as LabOrderStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
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
          <CardTitle>Resultados</CardTitle>
        </CardHeader>
        <CardContent>
          {list.error ? (
            <p role="alert" className="text-sm text-destructive">
              {list.error.message}
            </p>
          ) : null}
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : null}
          {list.data ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Encuentro</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Prioridad</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Tests</TableHead>
                  <TableHead aria-label="Acciones" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-sm text-muted-foreground"
                    >
                      Sin órdenes con estos filtros.
                    </TableCell>
                  </TableRow>
                ) : null}
                {list.data.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      {o.patient
                        ? `${o.patient.firstName} ${o.patient.lastName}`
                        : o.patientId}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {o.encounter?.encounterNumber ?? o.encounterId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {new Date(o.orderedAt).toLocaleString("es-SV")}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${PRIORITY_BADGE[o.priority]}`}
                      >
                        {PRIORITY_LABEL[o.priority]}
                      </span>
                    </TableCell>
                    <TableCell>{STATUS_LABEL[o.status]}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.items.length}
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/lis/orders/${o.id}`}>Ver</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
