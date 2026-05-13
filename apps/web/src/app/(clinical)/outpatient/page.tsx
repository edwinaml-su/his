"use client";

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
import { StatusBadge, type AppointmentStatus } from "./_components/status-badge";

/**
 * §10 Consulta Externa — Listado de citas con filtros básicos.
 *
 * Filtros aplicados client-side via `trpc.outpatient.appointment.list`.
 * Acepta provider (UUID), status, y rango de fechas. Mantiene la UI
 * coherente con `(clinical)/triage/page.tsx`.
 */

const STATUS_OPTIONS: { value: AppointmentStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "SCHEDULED", label: "Programada" },
  { value: "CONFIRMED", label: "Confirmada" },
  { value: "CHECKED_IN", label: "Recibido" },
  { value: "NO_SHOW", label: "No se presentó" },
  { value: "COMPLETED", label: "Completada" },
  { value: "CANCELLED", label: "Cancelada" },
];

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface Filters {
  providerId: string;
  status: AppointmentStatus | "ALL";
  from: string;
  to: string;
}

export default function OutpatientListPage() {
  const [filters, setFilters] = React.useState<Filters>({
    providerId: "",
    status: "ALL",
    from: "",
    to: "",
  });

  // El input de listado se construye omitiendo claves vacías para que el
  // schema Zod acepte filtros opcionales sin enviar strings vacíos.
  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (filters.providerId.trim()) input.providerId = filters.providerId.trim();
    if (filters.status !== "ALL") input.status = filters.status;
    if (filters.from) input.from = new Date(filters.from);
    if (filters.to) input.to = new Date(filters.to);
    return input;
  }, [filters]);

  const query = trpc.outpatient.appointment.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Consulta Externa</h1>
          <p className="text-sm text-muted-foreground">
            Citas ambulatorias programadas y atendidas (§10).
          </p>
        </div>
        <Button asChild>
          <Link href="/outpatient/new" aria-label="Crear nueva cita">
            Nueva cita
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="filter-provider">Proveedor (UUID)</Label>
              <Input
                id="filter-provider"
                placeholder="UUID del usuario"
                value={filters.providerId}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, providerId: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-status">Estado</Label>
              <Select
                value={filters.status}
                onValueChange={(v) =>
                  setFilters((f) => ({
                    ...f,
                    status: v as AppointmentStatus | "ALL",
                  }))
                }
              >
                <SelectTrigger id="filter-status">
                  <SelectValue placeholder="Todos" />
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
              <Label htmlFor="filter-from">Desde</Label>
              <Input
                id="filter-from"
                type="datetime-local"
                value={filters.from}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, from: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-to">Hasta</Label>
              <Input
                id="filter-to"
                type="datetime-local"
                value={filters.to}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, to: e.target.value }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Citas</CardTitle>
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
              Sin citas para los filtros seleccionados.
            </p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Fecha programada</TableHead>
                  <TableHead>Duración</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((apt) => {
                  // Asunción: list incluye `patient` (firstName, lastName) y
                  // `provider` (User: firstName/lastName o name) por relación.
                  const patientName = apt.patient
                    ? `${apt.patient.firstName} ${apt.patient.lastName}`
                    : "—";
                  const providerName = apt.provider
                    ? formatProvider(apt.provider)
                    : "—";
                  return (
                    <TableRow key={apt.id}>
                      <TableCell>{patientName}</TableCell>
                      <TableCell>{providerName}</TableCell>
                      <TableCell className="tabular-nums">
                        {dateFmt.format(new Date(apt.scheduledAt))}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {apt.durationMinutes} min
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={apt.status as AppointmentStatus} />
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate">
                        {apt.reason ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/outpatient/${apt.id}`}
                            aria-label={`Ver cita ${apt.id}`}
                          >
                            Ver
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

interface ProviderLike {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
}

function formatProvider(p: ProviderLike): string {
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (p.name) return p.name;
  if (p.email) return p.email;
  return "—";
}
