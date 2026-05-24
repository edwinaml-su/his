"use client";

/**
 * Historia Clínica Ambulatoria — Listado filtrable por paciente y estado.
 *
 * Vista patient-centric: muestra todas las HCs de un paciente a través de
 * sus episodios. Contrasta con /ece/historia-clinica que es episode-centric.
 *
 * TODO: router `eceHistoriaClinica` pendiente de merge en paralelo.
 * Usar cast `(trpc as any)` hasta que esté disponible en el cliente.
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
  pacienteId: string;
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
    pacienteId: "",
    estado: "ALL",
  });

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (filters.pacienteId.trim()) input.pacienteId = filters.pacienteId.trim();
    if (filters.estado !== "ALL") input.estado = filters.estado;
    return input;
  }, [filters]);

  // TODO(HC-002): usar tipo nativo cuando el router esté mergeado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (trpc as any).eceHistoriaClinica.list.useQuery(listInput) as {
    isLoading: boolean;
    error: { message: string } | null;
    data: Array<{
      id: string;
      tipoConsulta: string;
      motivoConsulta: string | null;
      estadoRegistro: string;
      registradoEn: string | Date;
      patient: { firstName: string; lastName: string; mrn?: string | null } | null;
    }> | undefined;
  };

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
              <Label htmlFor="filter-paciente">Paciente (UUID)</Label>
              <Input
                id="filter-paciente"
                placeholder="UUID del paciente"
                value={filters.pacienteId}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, pacienteId: e.target.value }))
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
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin historias clínicas para los filtros seleccionados.
            </p>
          )}
          {query.data && query.data.length > 0 && (
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
                {query.data.map((hc) => {
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
