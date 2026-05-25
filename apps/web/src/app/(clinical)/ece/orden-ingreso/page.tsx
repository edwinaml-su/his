"use client";

/**
 * ECE — Listado de Órdenes de Ingreso (ORD_ING, NTEC Art. 33).
 *
 * La orden de ingreso es la decisión clínica del médico que autoriza
 * el internamiento. Prerrequisito de la Hoja de Ingreso (HOJA_ING).
 *
 * Roles con acceso: MC, ESP, ENF, ARCH, DIR, ADM, ADMIN.
 */
import * as React from "react";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
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
import { MODALIDAD_ING, type ModalidadIng } from "@his/contracts/schemas/orden-ingreso";

// ─── Constantes de presentación ───────────────────────────────────────────────

const MODALIDAD_LABEL: Record<ModalidadIng, string> = {
  hospitalizacion:  "Hospitalización",
  hospital_de_dia:  "Hospital de día",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador:    "outline",
  en_revision: "secondary",
  firmado:     "secondary",
  validado:    "default",
  anulado:     "destructive",
};

const ESTADO_LABEL: Record<string, string> = {
  borrador:    "Borrador",
  en_revision: "En revisión",
  firmado:     "Firmado",
  validado:    "Validado",
  anulado:     "Anulado",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" });
const hoyIso  = new Date().toISOString().slice(0, 10);

// ─── Componente principal ─────────────────────────────────────────────────────

export default function OrdenIngresoListPage() {
  const [modalidad, setModalidad]   = React.useState<ModalidadIng | "">("");
  const [fechaDesde, setFechaDesde] = React.useState<string>(hoyIso);

  const query = trpc.eceOrdenIngreso.list.useQuery(
    {
      modalidad:  (modalidad || undefined) as ModalidadIng | undefined,
      fechaDesde: fechaDesde ? new Date(fechaDesde) : undefined,
      pageSize:   50,
    },
    { enabled: true },
  );

  const items      = query.data?.items ?? [];
  const total      = query.data?.total ?? 0;
  const firmadas   = items.filter((r) => r.estado_documento === "firmado").length;
  const pendientes = items.filter((r) =>
    r.estado_documento === "borrador" || r.estado_documento === "en_revision",
  ).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardCheck className="h-6 w-6" aria-hidden />
            Órdenes de Ingreso
          </h1>
          <p className="text-sm text-muted-foreground">
            ECE — ORD_ING / NTEC Art. 33
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/orden-ingreso/nuevo">Nueva orden de ingreso</Link>
        </Button>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard label="Total" value={total} />
        <MetricCard label="Firmadas" value={firmadas} />
        <MetricCard label="Pendientes" value={pendientes} />
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader><CardTitle>Filtros</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="filter-fecha">Desde</Label>
              <Input
                id="filter-fecha"
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-modalidad">Modalidad</Label>
              <Select
                value={modalidad}
                onValueChange={(v) => setModalidad(v as ModalidadIng | "")}
              >
                <SelectTrigger id="filter-modalidad">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todas</SelectItem>
                  {MODALIDAD_ING.map((m) => (
                    <SelectItem key={m} value={m}>{MODALIDAD_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader><CardTitle>Órdenes</CardTitle></CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">{query.error.message}</p>
          )}
          {!query.isLoading && items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin órdenes de ingreso para los filtros aplicados.
            </p>
          )}
          {items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Modalidad</TableHead>
                  <TableHead>Motivo tipo</TableHead>
                  <TableHead>Fecha orden</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.paciente_id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="capitalize">
                      {MODALIDAD_LABEL[r.modalidad as ModalidadIng] ?? r.modalidad}
                    </TableCell>
                    <TableCell className="capitalize text-xs">
                      {r.motivo_ingreso_tipo ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {dateFmt.format(new Date(r.fecha_hora_orden))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ESTADO_VARIANT[r.estado_documento ?? ""] ?? "outline"}>
                        {ESTADO_LABEL[r.estado_documento ?? ""] ?? r.estado_documento}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/ece/orden-ingreso/${r.id}`}>Ver</Link>
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
