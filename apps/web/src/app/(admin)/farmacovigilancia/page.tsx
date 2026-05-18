"use client";

/**
 * Farmacovigilancia — Tabla de incidentes con filtros y acciones
 *
 * US.F2.6.56 — Reporte consolidado de farmacovigilancia
 * Roles: ADMIN, PHARM, DIRECTOR
 */
import * as React from "react";
import { ShieldAlert } from "lucide-react";
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
import { trpc } from "@/lib/trpc/react";

// Mapas de color por severidad y tipo
const SEVERITY_BADGE: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  CRITICAL: "destructive",
  HIGH: "destructive",
  MEDIUM: "default",
  LOW: "secondary",
};

const STATUS_LABELS: Record<string, string> = {
  PENDIENTE: "Pendiente",
  RECONOCIDO: "Reconocido",
  ESCALADO: "Escalado",
  CERRADO: "Cerrado",
};

const TIPO_LABELS: Record<string, string> = {
  ALERGIA_DETECTADA: "Alergia detectada",
  RECALL_DETECTADO: "Recall detectado",
  DOBLE_DISPENSACION: "Doble dispensación",
  DOSIS_VENCIDA: "Dosis vencida",
  HARD_STOP_PATRON: "Patrón hard-stops",
  OTRO: "Otro",
};

export default function FarmacovigilanciaPage() {
  const [statusFilter, setStatusFilter] = React.useState<string>("");
  const [severityFilter, setSeverityFilter] = React.useState<string>("");
  const [acknowledging, setAcknowledging] = React.useState<string | null>(null);

  const listInput = React.useMemo(() => ({
    limit: 100,
    offset: 0,
    ...(statusFilter && { status: statusFilter as "PENDIENTE" | "RECONOCIDO" | "ESCALADO" | "CERRADO" }),
    ...(severityFilter && { severity: severityFilter as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }),
  }), [statusFilter, severityFilter]);

  const query = trpc.farmacovigilancia.list.useQuery(listInput);
  const summaryQuery = trpc.farmacovigilancia.summary.useQuery();
  const acknowledgeMutation = trpc.farmacovigilancia.acknowledge.useMutation({
    onSuccess: () => {
      void query.refetch();
      setAcknowledging(null);
    },
  });

  const pendientes = query.data?.filter((i) => i.status === "PENDIENTE").length ?? 0;
  const criticos = query.data?.filter((i) => i.severity === "CRITICAL").length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-1 size-6 text-destructive" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Farmacovigilancia</h1>
          <p className="text-sm text-muted-foreground">
            Incidentes de seguridad farmacéutica — alergias, recalls, doble dispensación
            y dosis vencidas (US.F2.6.56).
          </p>
        </div>
      </div>

      {/* Resumen rápido */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium text-muted-foreground">Pendientes</p>
            <p className="text-3xl font-bold text-destructive">{pendientes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium text-muted-foreground">Críticos</p>
            <p className="text-3xl font-bold text-destructive">{criticos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium text-muted-foreground">Total</p>
            <p className="text-3xl font-bold">{query.data?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium text-muted-foreground">Tipos</p>
            <p className="text-3xl font-bold">{summaryQuery.data?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Filtrar por estado"
              className="rounded-md border px-3 py-1.5 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Todos los estados</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="RECONOCIDO">Reconocido</option>
              <option value="ESCALADO">Escalado</option>
              <option value="CERRADO">Cerrado</option>
            </select>
            <select
              aria-label="Filtrar por severidad"
              className="rounded-md border px-3 py-1.5 text-sm"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
            >
              <option value="">Todas las severidades</option>
              <option value="CRITICAL">Crítico</option>
              <option value="HIGH">Alto</option>
              <option value="MEDIUM">Medio</option>
              <option value="LOW">Bajo</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setStatusFilter(""); setSeverityFilter(""); }}
            >
              Limpiar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de incidentes */}
      <Card>
        <CardHeader>
          <CardTitle>Incidentes</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Cargando incidentes…
            </p>
          )}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data?.length === 0 && !query.isLoading && (
            <p className="text-sm text-muted-foreground">
              Sin incidentes para los filtros seleccionados.
            </p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Detectado</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Severidad</TableHead>
                  <TableHead>GTIN</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((incident) => (
                  <TableRow
                    key={incident.id}
                    className={incident.severity === "CRITICAL" ? "bg-destructive/5" : ""}
                  >
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(incident.detectedAt).toLocaleString("es-SV")}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {TIPO_LABELS[incident.tipo] ?? incident.tipo}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_BADGE[incident.severity] ?? "outline"}>
                        {incident.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {incident.gtin ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {STATUS_LABELS[incident.status] ?? incident.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {incident.status === "PENDIENTE" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acknowledging === incident.id || acknowledgeMutation.isPending}
                          onClick={() => {
                            setAcknowledging(incident.id);
                            acknowledgeMutation.mutate({ incidentId: incident.id });
                          }}
                          aria-label={`Reconocer incidente ${incident.id}`}
                        >
                          Reconocer
                        </Button>
                      )}
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
