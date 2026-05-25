"use client";

/**
 * ECE — Listado de Certificados de Incapacidad ISSS (CERT_INC).
 * Normativa: ISSS El Salvador — Reglamento de Evaluación de Incapacidades.
 * NTEC §22.
 */
import * as React from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
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
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  firmado:  "Firmado",
  anulado:  "Anulado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  firmado:  "default",
  anulado:  "destructive",
};

const TIPO_LABEL: Record<string, string> = {
  enfermedad_comun:   "Enfermedad común",
  accidente_comun:    "Accidente común",
  riesgo_profesional: "Riesgo profesional",
  maternidad:         "Maternidad",
  paternidad:         "Paternidad",
  accidente_trabajo:  "Accidente de trabajo",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "medium" });

export default function CertificadoIncapacidadListPage() {
  const [pacienteId, setPacienteId] = React.useState("");
  const [fechaDesde, setFechaDesde] = React.useState("");
  const [fechaHasta, setFechaHasta] = React.useState("");

  const query = trpc.eceCertificadoIncapacidad.list.useQuery({
    pacienteId:  pacienteId.trim() || undefined,
    fechaDesde:  fechaDesde ? new Date(fechaDesde) : undefined,
    fechaHasta:  fechaHasta ? new Date(fechaHasta) : undefined,
    page: 1,
    pageSize: 50,
  });

  const rows = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileText className="h-6 w-6" aria-hidden />
            Certificados de Incapacidad ISSS
          </h1>
          <p className="text-sm text-muted-foreground">
            NTEC §22 — Certificados expedidos por el médico para incapacidad temporal (ISSS).
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/certificado-incapacidad/nuevo">Nuevo certificado</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="filter-paciente">Paciente (UUID)</Label>
              <Input
                id="filter-paciente"
                placeholder="xxxxxxxx-xxxx-..."
                value={pacienteId}
                onChange={(e) => setPacienteId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-desde">Fecha inicio desde</Label>
              <Input
                id="filter-desde"
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-hasta">Fecha fin hasta</Label>
              <Input
                id="filter-hasta"
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Certificados registrados</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">{query.error.message}</p>
          )}
          {!query.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin certificados para los filtros aplicados.</p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Días</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const estado = r.estado_documento ?? r.estado_registro;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}…</TableCell>
                      <TableCell className="text-sm">
                        {TIPO_LABEL[r.tipo_incapacidad] ?? r.tipo_incapacidad}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {dateFmt.format(new Date(r.fecha_inicio))} –{" "}
                        {dateFmt.format(new Date(r.fecha_fin))}
                      </TableCell>
                      <TableCell className="tabular-nums">{r.dias_otorgados}</TableCell>
                      <TableCell>
                        <Badge variant={ESTADO_VARIANT[estado] ?? "outline"}>
                          {ESTADO_LABEL[estado] ?? estado}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/ece/certificado-incapacidad/${r.id}`}>Ver / Firmar</Link>
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
