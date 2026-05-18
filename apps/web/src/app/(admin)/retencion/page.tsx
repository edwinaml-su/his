"use client";

/**
 * Panel DIR/ADM — Conservación Diferenciada y Retención (US.F2.7.29-32).
 *
 * Tabs:
 *   1. Expedientes próximos a vencer — reporte US.F2.7.32
 *   2. Cola de eliminación supervisada — US.F2.7.31
 *   3. Reglas de retención — catálogo US.F2.7.30
 *
 * Roles: DIR, ADM (backend valida por procedure).
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@his/ui/components/tabs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExpedienteVencimiento {
  episodio_id: string;
  paciente_id: string;
  fecha_hora_inicio: string;
  fecha_vencimiento_retencion: string | null;
  estado_conservacion: string;
  dias_para_vencer: number | null;
}

interface Eliminacion {
  id: string;
  episodio_id: string;
  estado: string;
  motivo_baja: string;
  created_at: string;
  fecha_aprobacion: string | null;
  fecha_ejecucion: string | null;
}

interface ReglaRetencion {
  id: string;
  cie10_pattern: string | null;
  anios_retencion: number;
  motivo_legal: string;
  vigente_desde: string;
  vigente_hasta: string | null;
}

// ---------------------------------------------------------------------------
// Inline trpc typing
// ---------------------------------------------------------------------------

interface TrpcRetencion {
  eceRetencion: {
    expedientes: {
      list: {
        useQuery: (input: {
          diasProximos: number;
          limit: number;
          offset: number;
        }) => { data?: ExpedienteVencimiento[]; isLoading: boolean };
      };
    };
    eliminacion: {
      list: {
        useQuery: (input?: {
          estado?: "SOLICITADA" | "APROBADA" | "RECHAZADA" | "EJECUTADA";
          limit?: number;
          offset?: number;
        }) => { data?: Eliminacion[]; isLoading: boolean; refetch: () => void };
      };
      rechazar: {
        useMutation: (opts?: {
          onSuccess?: () => void;
          onError?: (e: { message: string }) => void;
        }) => {
          mutate: (input: { eliminacionId: string; motivoRechazo: string }) => void;
          isPending: boolean;
        };
      };
    };
    reglas: {
      list: {
        useQuery: () => { data?: ReglaRetencion[]; isLoading: boolean; refetch: () => void };
      };
      upsert: {
        useMutation: (opts?: {
          onSuccess?: () => void;
          onError?: (e: { message: string }) => void;
        }) => {
          mutate: (input: {
            cie10Pattern?: string | null;
            aniosRetencion: number;
            motivoLegal: string;
          }) => void;
          isPending: boolean;
        };
      };
    };
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ExpedientesTab() {
  const utils = (trpc as unknown as TrpcRetencion).eceRetencion;
  const [diasProximos, setDiasProximos] = React.useState(90);
  const query = utils.expedientes.list.useQuery({
    diasProximos,
    limit: 50,
    offset: 0,
  });

  const formatDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("es-SV") : "—";

  const colorDias = (dias: number | null) => {
    if (dias === null) return "";
    if (dias < 0) return "text-destructive font-medium";
    if (dias < 30) return "text-amber-600 font-medium";
    return "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Vencen en próximos</label>
        <Input
          type="number"
          min={1}
          max={365}
          value={diasProximos}
          onChange={(e) => setDiasProximos(Number(e.target.value))}
          className="w-24"
        />
        <span className="text-sm">días</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            window.open(
              `/api/retencion/report.csv?diasProximos=${diasProximos}`,
              "_blank",
            )
          }
        >
          Exportar CSV
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Episodio</TableHead>
            <TableHead>Inicio atención</TableHead>
            <TableHead>Vencimiento retención</TableHead>
            <TableHead>Días para vencer</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data?.map((exp) => (
            <TableRow key={exp.episodio_id}>
              <TableCell className="font-mono text-xs">
                {exp.episodio_id.slice(0, 8)}…
              </TableCell>
              <TableCell>{formatDate(exp.fecha_hora_inicio)}</TableCell>
              <TableCell>{formatDate(exp.fecha_vencimiento_retencion)}</TableCell>
              <TableCell className={colorDias(exp.dias_para_vencer)}>
                {exp.dias_para_vencer !== null ? exp.dias_para_vencer : "—"}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    exp.estado_conservacion === "POR_ELIMINAR"
                      ? "destructive"
                      : exp.estado_conservacion === "PASIVO"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {exp.estado_conservacion}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
          {!query.isLoading && !query.data?.length && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center text-muted-foreground"
              >
                Sin expedientes en el período indicado.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function EliminacionTab() {
  const utils = (trpc as unknown as TrpcRetencion).eceRetencion;
  const [filtroEstado, setFiltroEstado] = React.useState<
    "SOLICITADA" | "APROBADA" | "RECHAZADA" | "EJECUTADA" | undefined
  >(undefined);
  const [motivoRechazo, setMotivoRechazo] = React.useState<
    Record<string, string>
  >({});
  const [error, setError] = React.useState<string | null>(null);

  const query = utils.eliminacion.list.useQuery({
    estado: filtroEstado,
    limit: 20,
  });

  const rechazar = utils.eliminacion.rechazar.useMutation({
    onSuccess: () => {
      query.refetch();
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const formatDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleString("es-SV") : "—";

  const estadoBadge = (estado: string) => {
    const map: Record<string, "destructive" | "secondary" | "outline" | "default"> = {
      SOLICITADA: "default",
      APROBADA: "secondary",
      RECHAZADA: "outline",
      EJECUTADA: "destructive",
    };
    return map[estado] ?? "outline";
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {(["SOLICITADA", "APROBADA", "RECHAZADA", "EJECUTADA"] as const).map(
          (est) => (
            <Button
              key={est}
              variant={filtroEstado === est ? "default" : "outline"}
              size="sm"
              onClick={() =>
                setFiltroEstado(filtroEstado === est ? undefined : est)
              }
            >
              {est}
            </Button>
          ),
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID Solicitud</TableHead>
            <TableHead>Episodio</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Motivo</TableHead>
            <TableHead>Solicitado</TableHead>
            <TableHead>Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data?.map((elim) => (
            <TableRow key={elim.id}>
              <TableCell className="font-mono text-xs">
                {elim.id.slice(0, 8)}…
              </TableCell>
              <TableCell className="font-mono text-xs">
                {elim.episodio_id.slice(0, 8)}…
              </TableCell>
              <TableCell>
                <Badge variant={estadoBadge(elim.estado)}>{elim.estado}</Badge>
              </TableCell>
              <TableCell className="max-w-xs truncate">{elim.motivo_baja}</TableCell>
              <TableCell>{formatDate(elim.created_at)}</TableCell>
              <TableCell>
                {(elim.estado === "SOLICITADA" || elim.estado === "APROBADA") && (
                  <div className="flex gap-2 items-center">
                    <Input
                      placeholder="Motivo rechazo"
                      className="h-7 text-xs w-36"
                      value={motivoRechazo[elim.id] ?? ""}
                      onChange={(e) =>
                        setMotivoRechazo((prev) => ({
                          ...prev,
                          [elim.id]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={rechazar.isPending}
                      onClick={() =>
                        rechazar.mutate({
                          eliminacionId: elim.id,
                          motivoRechazo: motivoRechazo[elim.id] ?? "",
                        })
                      }
                    >
                      Rechazar
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!query.isLoading && !query.data?.length && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-muted-foreground"
              >
                Sin solicitudes.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function ReglasTab() {
  const utils = (trpc as unknown as TrpcRetencion).eceRetencion;
  const query = utils.reglas.list.useQuery();
  const [newPattern, setNewPattern] = React.useState("");
  const [newAnios, setNewAnios] = React.useState(10);
  const [newMotivo, setNewMotivo] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const upsert = utils.reglas.upsert.useMutation({
    onSuccess: () => {
      query.refetch();
      setNewPattern("");
      setNewAnios(10);
      setNewMotivo("");
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const formatDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("es-SV") : "—";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nueva regla de retención</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Patrón CIE-10 (vacío = default)
              </label>
              <Input
                placeholder="Ej: X%, V%, S%"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Años retención *
              </label>
              <Input
                type="number"
                min={1}
                value={newAnios}
                onChange={(e) => setNewAnios(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Base legal *
              </label>
              <Input
                placeholder="Ej: NTEC Art. 6 lit. b — causas externas"
                value={newMotivo}
                onChange={(e) => setNewMotivo(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          <Button
            className="mt-3"
            onClick={() =>
              upsert.mutate({
                cie10Pattern: newPattern.trim() || null,
                aniosRetencion: newAnios,
                motivoLegal: newMotivo.trim(),
              })
            }
            disabled={upsert.isPending}
          >
            {upsert.isPending ? "Guardando..." : "Guardar regla"}
          </Button>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Patrón CIE-10</TableHead>
            <TableHead>Años</TableHead>
            <TableHead>Base legal</TableHead>
            <TableHead>Vigente desde</TableHead>
            <TableHead>Vigente hasta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data?.map((regla) => (
            <TableRow key={regla.id}>
              <TableCell>
                {regla.cie10_pattern ?? (
                  <span className="text-muted-foreground italic">Default</span>
                )}
              </TableCell>
              <TableCell>{regla.anios_retencion}</TableCell>
              <TableCell className="max-w-xs truncate">{regla.motivo_legal}</TableCell>
              <TableCell>{formatDate(regla.vigente_desde)}</TableCell>
              <TableCell>{formatDate(regla.vigente_hasta)}</TableCell>
            </TableRow>
          ))}
          {!query.isLoading && !query.data?.length && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                Sin reglas definidas.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RetencionPage() {
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">
        Conservación Diferenciada y Retención
      </h1>
      <p className="text-sm text-muted-foreground">
        Gestión de retención de expedientes clínicos según diagnóstico CIE-10 (NTEC Art. 6).
        La eliminación requiere doble firma electrónica y no borra datos — preserva metadata de
        auditoría (TDR §6.3).
      </p>

      <Tabs defaultValue="expedientes">
        <TabsList>
          <TabsTrigger value="expedientes">Expedientes por vencer</TabsTrigger>
          <TabsTrigger value="eliminacion">Cola de eliminación</TabsTrigger>
          <TabsTrigger value="reglas">Reglas de retención</TabsTrigger>
        </TabsList>
        <TabsContent value="expedientes" className="mt-4">
          <ExpedientesTab />
        </TabsContent>
        <TabsContent value="eliminacion" className="mt-4">
          <EliminacionTab />
        </TabsContent>
        <TabsContent value="reglas" className="mt-4">
          <ReglasTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
