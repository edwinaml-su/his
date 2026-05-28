"use client";

/**
 * ECE — Listado de Hojas de Ingreso Hospitalario (Doc 12 NTEC, §3.12).
 *
 * Métricas del día: total / firmadas / validadas / pendientes.
 * Filtros: servicio, estado, fecha.
 * Roles con acceso: ADM, MC, ENF, ESP, ARCH, DIR.
 */
import * as React from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
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
import { Badge } from "@his/ui/components/badge";
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
import type { EstadoHojaIngreso } from "@his/contracts";

// ─── Constantes de presentación ───────────────────────────────────────────────

const ESTADO_LABEL: Record<EstadoHojaIngreso, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  firmado: "Firmado",
  validado: "Validado",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<
  EstadoHojaIngreso,
  "default" | "secondary" | "destructive" | "outline"
> = {
  borrador: "outline",
  en_revision: "secondary",
  firmado: "secondary",
  validado: "default",
  anulado: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

const hoyIso = new Date().toISOString().slice(0, 10);

// ─── Componente principal ─────────────────────────────────────────────────────

export default function HojaIngresoListPage() {
  const [estado, setEstado] = React.useState<EstadoHojaIngreso | "">("");
  const [fecha, setFecha] = React.useState<string>(hoyIso);

  const query = trpc.eceHojaIngreso.list.useQuery(
    {
      estado: (estado || undefined) as EstadoHojaIngreso | undefined,
      fecha: fecha ? new Date(fecha) : undefined,
      pageSize: 50,
    },
    { enabled: true },
  );

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  // Métricas calculadas localmente a partir de la página actual
  const firmadas   = items.filter((r) => r.estado_codigo === "firmado").length;
  const validadas  = items.filter((r) => r.estado_codigo === "validado").length;
  const pendientes = items.filter((r) =>
    r.estado_codigo === "borrador" || r.estado_codigo === "en_revision",
  ).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6" aria-hidden />
            Hojas de Ingreso
          </h1>
          <p className="text-sm text-muted-foreground">
            ECE Hospitalario — Doc 12 NTEC §3.12
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/hoja-ingreso/nueva">Nueva hoja de ingreso</Link>
        </Button>
      </div>

      {/* Métricas del día */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Total" value={total} />
        <MetricCard label="Firmadas" value={firmadas} />
        <MetricCard label="Validadas" value={validadas} />
        <MetricCard label="Pendientes" value={pendientes} />
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="filter-fecha">Fecha</Label>
              <Input
                id="filter-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-estado">Estado</Label>
              <Select
                value={estado || "all"}
                onValueChange={(v) =>
                  setEstado(v === "all" ? "" : (v as EstadoHojaIngreso))
                }
              >
                <SelectTrigger id="filter-estado">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  {/* Radix Select prohíbe value="" — usamos centinela "all". */}
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="borrador">Borrador</SelectItem>
                  <SelectItem value="en_revision">En revisión</SelectItem>
                  <SelectItem value="firmado">Firmado</SelectItem>
                  <SelectItem value="validado">Validado</SelectItem>
                  <SelectItem value="anulado">Anulado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader>
          <CardTitle>Ingresos</CardTitle>
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
          {!query.isLoading && items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin hojas de ingreso para los filtros aplicados.
            </p>
          )}
          {items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Episodio</TableHead>
                  <TableHead>Modalidad</TableHead>
                  <TableHead>Fecha/hora</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.episodio_id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="capitalize">{r.datos_administrativos?.modalidad}</TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {dateFmt.format(new Date(r.fecha_hora_ingreso))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ESTADO_VARIANT[r.estado_codigo]}>
                        {ESTADO_LABEL[r.estado_codigo]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/ece/hoja-ingreso/${r.id}`}>Ver</Link>
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

// ─── Componente auxiliar ──────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
