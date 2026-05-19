"use client";

/**
 * §ECE — Historia Clínica Electrónica — Listado filtrable.
 *
 * HC-001: esta página cubre la ausencia total de UI (hallazgo P0).
 * Lista HCs del tenant con filtros por episodio y estado de workflow.
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
import { WorkflowBadge } from "./_components/workflow-badge";

type EstadoFilter = "borrador" | "firmado" | "validado" | "anulado" | "ALL";

interface Filters {
  episodioId: string;
  estado: EstadoFilter;
}

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

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function EceHistoriaClinicaListPage() {
  const [filters, setFilters] = React.useState<Filters>({
    episodioId: "",
    estado: "ALL",
  });

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (filters.episodioId.trim()) input.episodioId = filters.episodioId.trim();
    if (filters.estado !== "ALL") input.estado = filters.estado;
    return input;
  }, [filters]);

  const query = trpc.eceHistoriaClinica.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Historia Clínica Electrónica</h1>
          <p className="text-sm text-muted-foreground">
            Registro clínico electrónico del paciente — NTEC Art. 7.
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/historia-clinica/nueva" aria-label="Crear nueva historia clínica">
            Nueva HC
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-episodio">Episodio (ID)</Label>
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
          {query.data && query.data.items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin historias clínicas para los filtros seleccionados.
            </p>
          )}
          {query.data && query.data.items.length > 0 && (
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
                {(query.data.items as Array<{
                  id: string;
                  episodioId: string;
                  tipoConsulta: string;
                  motivoConsulta: string | null;
                  estadoRegistro: string;
                  registradoEn: Date;
                  patient: { firstName: string; lastName: string } | null;
                }>).map((hc) => {
                  const paciente = hc.patient
                    ? `${hc.patient.firstName} ${hc.patient.lastName}`
                    : "—";
                  return (
                    <TableRow key={hc.id}>
                      <TableCell>{paciente}</TableCell>
                      <TableCell>{TIPO_LABELS[hc.tipoConsulta] ?? hc.tipoConsulta}</TableCell>
                      <TableCell className="max-w-[20rem] truncate">
                        {hc.motivoConsulta ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {dateFmt.format(hc.registradoEn)}
                      </TableCell>
                      <TableCell>
                        <WorkflowBadge estado={hc.estadoRegistro} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/ece/historia-clinica/${hc.id}`}
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
