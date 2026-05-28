"use client";

/**
 * Panel ADM/DIR — Modo Contingencia Operativa (US.F2.7.26).
 *
 * Permite activar y desactivar el modo contingencia, ver el historial
 * y navegar a formularios imprimibles (US.F2.7.28).
 * Roles: ADM, DIR (el backend valida; la UI muestra condicionalmente).
 */
import * as React from "react";
import { trpc } from "@/lib/trpc/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";

// ---------------------------------------------------------------------------
// Types matching router output
// ---------------------------------------------------------------------------

interface ContingenciaEvento {
  id: string;
  motivo: string;
  esperado_hasta: string | null;
  activado_en: string;
  desactivado_en?: string | null;
}

interface EstadoActual {
  activo: boolean;
  evento: ContingenciaEvento | null;
}

// ---------------------------------------------------------------------------
// Trpc context typing (inline interface for this component)
// ---------------------------------------------------------------------------

interface QueryResult<T> {
  data?: T;
  isLoading: boolean;
  refetch: () => void;
}

interface TrpcContingencia {
  eceContingencia: {
    estadoActual: { useQuery: () => QueryResult<EstadoActual> };
    activar: { useMutation: (opts?: { onSuccess?: () => void; onError?: (e: { message: string }) => void }) => { mutate: (input: { motivo: string; esperadoHasta?: string }) => void; isPending: boolean } };
    desactivar: { useMutation: (opts?: { onSuccess?: () => void; onError?: (e: { message: string }) => void }) => { mutate: (input: { contingenciaEventoId: string }) => void; isPending: boolean } };
    list: { useQuery: (input?: { soloActivos?: boolean; limit?: number; offset?: number }) => QueryResult<ContingenciaEvento[]> };
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ContingenciaPage() {
  const utils = (trpc as unknown as TrpcContingencia).eceContingencia;

  const estadoQuery = utils.estadoActual.useQuery();
  const historialQuery = utils.list.useQuery({ soloActivos: false, limit: 10 });

  const [motivo, setMotivo] = React.useState("");
  const [esperadoHasta, setEsperadoHasta] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const activar = utils.activar.useMutation({
    onSuccess: () => {
      estadoQuery.refetch();
      historialQuery.refetch();
      setMotivo("");
      setEsperadoHasta("");
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const desactivar = utils.desactivar.useMutation({
    onSuccess: () => {
      estadoQuery.refetch();
      historialQuery.refetch();
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const estado = estadoQuery.data;

  const handleActivar = () => {
    if (!motivo.trim()) {
      setError("El motivo es requerido.");
      return;
    }
    // HG-29: datetime-local produce "YYYY-MM-DDTHH:MM" sin offset.
    // Zod { offset: true } exige un ISO 8601 con offset explícito.
    // Fijamos -06:00 (El Salvador CST) para que el router lo acepte.
    const esperadoHastaConZona = esperadoHasta ? `${esperadoHasta}:00-06:00` : undefined;
    activar.mutate({
      motivo: motivo.trim(),
      ...(esperadoHastaConZona ? { esperadoHasta: esperadoHastaConZona } : {}),
    });
  };

  const handleDesactivar = () => {
    if (!estado?.evento?.id) return;
    desactivar.mutate({ contingenciaEventoId: estado.evento.id });
  };

  const formatDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleString("es-SV") : "—";

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Modo Contingencia Operativa</h1>
      <p className="text-sm text-muted-foreground">
        Activa el modo contingencia cuando el sistema no está disponible para registrar en papel
        (NTEC Art. 44). Los registros en papel se digitalizan al restaurar el sistema.
      </p>

      {/* Estado actual */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            Estado actual
            {estadoQuery.isLoading ? (
              <Badge variant="outline">Cargando...</Badge>
            ) : estado?.activo ? (
              <Badge variant="destructive">CONTINGENCIA ACTIVA</Badge>
            ) : (
              <Badge variant="secondary">Sistema normal</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {estado?.activo && estado.evento && (
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium">Motivo:</span> {estado.evento.motivo}
              </p>
              <p>
                <span className="font-medium">Activado en:</span>{" "}
                {formatDate(estado.evento.activado_en)}
              </p>
              {estado.evento.esperado_hasta && (
                <p>
                  <span className="font-medium">Esperado hasta:</span>{" "}
                  {formatDate(estado.evento.esperado_hasta)}
                </p>
              )}
              <div className="pt-2 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDesactivar}
                  disabled={desactivar.isPending}
                >
                  {desactivar.isPending ? "Desactivando..." : "Desactivar modo contingencia"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open("/api/contingencia/forms/signos_vitales.pdf", "_blank")
                  }
                >
                  Imprimir formularios
                </Button>
              </div>
            </div>
          )}

          {!estado?.activo && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Motivo de la contingencia *
                  </label>
                  <Input
                    placeholder="Ej: Falla en servidor principal, mantenimiento de red..."
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Hora estimada de restauración
                  </label>
                  <Input
                    type="datetime-local"
                    value={esperadoHasta}
                    onChange={(e) => setEsperadoHasta(e.target.value)}
                  />
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button onClick={handleActivar} disabled={activar.isPending}>
                {activar.isPending ? "Activando..." : "Activar modo contingencia"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historial */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de períodos de contingencia</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Motivo</TableHead>
                <TableHead>Activado</TableHead>
                <TableHead>Desactivado</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historialQuery.data?.map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell className="max-w-xs truncate">{ev.motivo}</TableCell>
                  <TableCell>{formatDate(ev.activado_en)}</TableCell>
                  <TableCell>
                    {ev.desactivado_en ? formatDate(ev.desactivado_en) : "—"}
                  </TableCell>
                  <TableCell>
                    {ev.desactivado_en ? (
                      <Badge variant="secondary">Cerrado</Badge>
                    ) : (
                      <Badge variant="destructive">Activo</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!historialQuery.isLoading && !historialQuery.data?.length && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    Sin períodos registrados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
