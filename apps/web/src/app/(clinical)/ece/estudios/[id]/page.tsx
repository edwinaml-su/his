"use client";

/**
 * ECE — Detalle de solicitud de estudio (Doc 18 NTEC).
 *
 * Muestra:
 *   - Datos de la solicitud con estado del workflow.
 *   - Acciones: validar (MC, si estado = firmado).
 *   - Sección resultado si existe (lista de resultados de la solicitud).
 *   - Enlace para registrar resultado (si estado = firmado o validado).
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  firmado: "Firmado",
  validado: "Validado",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  en_revision: "secondary",
  firmado: "default",
  validado: "default",
  anulado: "destructive",
};

const RESULTADO_ESTADO_LABEL: Record<string, string> = {
  pendiente_aprobacion: "Pendiente aprobación",
  aprobado: "Aprobado",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface SolicitudRow {
  id: string;
  instancia_id: string;
  tipo: string;
  prioridad: string;
  estudios_solicitados: unknown;
  observaciones_clinicas: string | null;
  fecha_solicitud: string | Date;
  estado_codigo: string;
}

interface ResultadoRow {
  id: string;
  resultado: string;
  interpretacion: string | null;
  adjunto_uri: string | null;
  registrado_en: string | Date;
  estado: string;
  aprobado_en: string | Date | null;
  comentario_medico: string | null;
}

export default function SolicitudEstudioDetallePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [validarError, setValidarError] = React.useState<string | null>(null);

  const solQuery = trpc.eceSolicitudEstudio.get.useQuery({ id: params.id });
  const resQuery = trpc.eceResultadoEstudio.list.useQuery(
    { solicitudId: params.id },
    { enabled: !!params.id },
  );

  const validarMutation = trpc.eceSolicitudEstudio.validar.useMutation({
    onSuccess: () => { solQuery.refetch().catch(() => undefined); },
    onError: (e) => setValidarError(e.message),
  });
  const aprobarMutation = trpc.eceResultadoEstudio.aprobar.useMutation({
    onSuccess: () => { resQuery.refetch().catch(() => undefined); },
  });

  if (solQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (solQuery.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {solQuery.error.message}
      </p>
    );
  }

  const sol = solQuery.data as unknown as SolicitudRow | undefined;
  if (!sol) return null;

  const estudios = Array.isArray(sol.estudios_solicitados)
    ? (sol.estudios_solicitados as string[]).join(", ")
    : String(sol.estudios_solicitados ?? "");

  const canRegistrarResultado =
    sol.estado_codigo === "firmado" || sol.estado_codigo === "validado";
  const canValidar = sol.estado_codigo === "firmado";

  const resultados = (resQuery.data?.items ?? []) as unknown as ResultadoRow[];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Solicitud de estudio</h1>
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          Volver
        </Button>
      </div>

      {/* Datos solicitud */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{sol.tipo.charAt(0).toUpperCase() + sol.tipo.slice(1)}</span>
            <Badge variant={ESTADO_VARIANT[sol.estado_codigo] ?? "outline"}>
              {ESTADO_LABEL[sol.estado_codigo] ?? sol.estado_codigo}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-muted-foreground">Prioridad</span>
            <span className="font-medium uppercase">{sol.prioridad}</span>
            <span className="text-muted-foreground">Estudios</span>
            <span className="font-mono text-xs">{estudios}</span>
            <span className="text-muted-foreground">Fecha solicitud</span>
            <span className="tabular-nums">
              {sol.fecha_solicitud ? dateFmt.format(new Date(sol.fecha_solicitud)) : "—"}
            </span>
          </div>
          {sol.observaciones_clinicas && (
            <div>
              <p className="text-muted-foreground">Observaciones clínicas</p>
              <p className="mt-0.5 whitespace-pre-wrap">{sol.observaciones_clinicas}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Acciones sobre solicitud */}
      <div className="flex gap-2">
        {canRegistrarResultado && (
          <Button asChild>
            <Link href={`/ece/estudios/${sol.id}/registrar-resultado`}>
              Registrar resultado
            </Link>
          </Button>
        )}
        {canValidar && (
          <Button
            variant="secondary"
            disabled={validarMutation.isPending}
            onClick={() => {
              setValidarError(null);
              validarMutation.mutate({ solicitudId: sol.id });
            }}
          >
            {validarMutation.isPending ? "Validando…" : "Validar solicitud"}
          </Button>
        )}
      </div>

      {validarError && (
        <p role="alert" className="text-sm text-destructive">{validarError}</p>
      )}

      {/* Resultados */}
      <Card>
        <CardHeader>
          <CardTitle>Resultados</CardTitle>
        </CardHeader>
        <CardContent>
          {resQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando resultados…</p>
          ) : resultados.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin resultados registrados.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Registrado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultados.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-xs truncate">{r.resultado}</TableCell>
                    <TableCell>
                      <Badge variant={r.estado === "aprobado" ? "default" : "secondary"}>
                        {RESULTADO_ESTADO_LABEL[r.estado] ?? r.estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {r.registrado_en ? dateFmt.format(new Date(r.registrado_en)) : "—"}
                    </TableCell>
                    <TableCell>
                      {r.estado === "pendiente_aprobacion" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={aprobarMutation.isPending}
                          onClick={() => aprobarMutation.mutate({ resultadoId: r.id })}
                        >
                          Aprobar
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
