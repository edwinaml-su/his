"use client";

/**
 * Historia Clínica Ambulatoria — Listado filtrable por paciente y estado.
 *
 * Filtra por episodio (el router `eceHistoriaClinica.list` es episode-centric,
 * igual que /ece/historia-clinica).
 *
 * HC-002: creado para cubrir ausencia total de UI ambulatoria (hallazgo P0).
 */

import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
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

// ── Tipos ─────────────────────────────────────────────────────────────────────

type EstadoFilter = "borrador" | "firmado" | "validado" | "anulado" | "ALL";

interface Filters {
  episodioId: string;
  estado: EstadoFilter;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const ESTADO_OPTIONS: { value: EstadoFilter; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "borrador", label: "Borrador" },
  { value: "firmado", label: "Firmado" },
  { value: "validado", label: "Validado" },
  { value: "anulado", label: "Anulado" },
];

const TIPO_LABELS: Record<string, string> = {
  ingreso: "Ingreso",
  control: "Control",
  urgencia: "Urgencia",
  ambulatoria: "Ambulatoria",
  interconsulta: "Interconsulta",
};

const ESTADO_COLORS: Record<string, string> = {
  borrador: "text-amber-600",
  firmado: "text-blue-600",
  validado: "text-green-600",
  anulado: "text-red-600",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

// ── Componente ────────────────────────────────────────────────────────────────

export default function HistoriaClinicaAmbulatoriaListPage() {
  const [filters, setFilters] = React.useState<Filters>({
    episodioId: "",
    estado: "ALL",
  });

  const listInput = React.useMemo(() => {
    const input: { episodioId?: string; estado?: Exclude<EstadoFilter, "ALL"> } = {};
    if (filters.episodioId.trim()) input.episodioId = filters.episodioId.trim();
    if (filters.estado !== "ALL") input.estado = filters.estado;
    return input;
  }, [filters]);

  const query = trpc.eceHistoriaClinica.list.useQuery(listInput);
  const items = query.data?.items;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Historia Clínica Ambulatoria</h1>
          <p className="text-sm text-muted-foreground">
            Registro clínico de consultas ambulatorias — NTEC Art. 7.
          </p>
        </div>
        <Button asChild>
          <Link
            href="/historia-clinica-ambulatoria/nueva"
            aria-label="Registrar nueva historia clínica ambulatoria"
          >
            Nueva HC
          </Link>
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-episodio">Episodio (UUID)</Label>
              <Input
                id="filter-episodio"
                placeholder="UUID del episodio"
                value={filters.episodioId}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, episodioId: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-estado">Estado</Label>
              <Select
                value={filters.estado}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, estado: v as EstadoFilter }))
                }
              >
                <SelectTrigger id="filter-estado">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  {ESTADO_OPTIONS.map((o) => (
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

      {/* Tabla resultados */}
      <Card>
        <CardHeader>
          <CardTitle>Historias clínicas</CardTitle>
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
          {items && items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin historias clínicas para los filtros seleccionados.
            </p>
          )}
          {items && items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Tipo consulta</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Fecha registro</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((hc) => {
                  const paciente = hc.patient
                    ? `${hc.patient.firstName} ${hc.patient.lastName}`
                    : "—";
                  return (
                    <TableRow key={hc.id}>
                      <TableCell>{paciente}</TableCell>
                      <TableCell>
                        {TIPO_LABELS[hc.tipoConsulta] ?? hc.tipoConsulta}
                      </TableCell>
                      <TableCell className="max-w-[20rem] truncate">
                        {hc.motivoConsulta ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {dateFmt.format(new Date(hc.registradoEn))}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-sm font-medium ${ESTADO_COLORS[hc.estadoRegistro] ?? ""}`}
                          aria-label={`Estado: ${hc.estadoRegistro}`}
                        >
                          {hc.estadoRegistro.charAt(0).toUpperCase() +
                            hc.estadoRegistro.slice(1)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/historia-clinica-ambulatoria/${hc.id}`}
                            aria-label={`Ver historia clínica ${hc.id}`}
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
