"use client";

/**
 * ECE — Detalle de episodio hospitalario.
 *
 * Cabecera: paciente + cama + fecha ingreso + duración.
 * Tabs: Resumen / Documentos / Indicaciones / Evolución / Estudios.
 * Botón "Iniciar alta" visible solo para MC (PHYSICIAN).
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  BedDouble,
  Calendar,
  User,
  FileText,
  ClipboardList,
  NotebookPen,
  FlaskConical,
  ChevronLeft,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";
import { WizardProximosDocumentos } from "./_components/wizard-proximos-documentos";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "short",
});

function diasDesde(fecha: Date | string): number {
  const ms = Date.now() - new Date(fecha).getTime();
  return Math.floor(ms / 86_400_000);
}

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  en_curso: "default",
  alta_iniciada: "secondary",
  cerrado: "outline",
  cancelado: "destructive",
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function EpisodioHospitalarioDetallePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const query = trpc.eceEpisodioHospitalario.getDetalle.useQuery(
    { id },
    { enabled: !!id },
  );

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground p-6">Cargando episodio…</p>;
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive m-6"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {query.error.message}
      </div>
    );
  }

  const ep = query.data;
  if (!ep) return null;

  const dias = diasDesde(ep.fecha_ingreso);
  const estado = ep.estado;
  const puedeIniciarAlta = estado === "en_curso";

  return (
    <div className="space-y-4">
      {/* Navegación */}
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/ece/episodio-hospitalario">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Tablero
          </Link>
        </Button>
      </div>

      {/* Cabecera */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <BedDouble className="h-5 w-5 text-muted-foreground" aria-hidden />
                <CardTitle className="text-xl">{ep.paciente_nombre}</CardTitle>
                <Badge variant={ESTADO_VARIANT[estado] ?? "outline"}>{estado.replace("_", " ")}</Badge>
              </div>
              <p className="text-sm text-muted-foreground font-mono">
                ID episodio: {ep.id.slice(0, 8)}…
              </p>
            </div>
            {puedeIniciarAlta && (
              <Button asChild>
                <Link href={`/ece/episodio-hospitalario/${id}/alta`}>
                  Iniciar alta
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div className="space-y-0.5">
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                <BedDouble className="h-3 w-3" aria-hidden />
                Cama
              </dt>
              <dd className="font-mono font-medium">{ep.cama_codigo ?? "—"}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" aria-hidden />
                Ingreso
              </dt>
              <dd className="tabular-nums">{dateFmt.format(new Date(ep.fecha_ingreso))}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">Duración</dt>
              <dd className="font-semibold">
                {dias} día{dias !== 1 ? "s" : ""}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" aria-hidden />
                Médico tratante
              </dt>
              <dd>{ep.medico_nombre ?? "—"}</dd>
            </div>
            <div className="col-span-2 space-y-0.5">
              <dt className="text-xs text-muted-foreground">Sala / Servicio</dt>
              <dd>{ep.sala_nombre ?? ep.sala_id}</dd>
            </div>
            <div className="col-span-2 space-y-0.5">
              <dt className="text-xs text-muted-foreground">Documentos firmados</dt>
              <dd className="font-semibold">{ep.documentos_firmados_count}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="resumen">
        <TabsList aria-label="Secciones del episodio">
          <TabsTrigger value="resumen" className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Resumen
          </TabsTrigger>
          <TabsTrigger value="documentos" className="flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden />
            Documentos
          </TabsTrigger>
          <TabsTrigger value="indicaciones" className="flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden />
            Indicaciones
          </TabsTrigger>
          <TabsTrigger value="evolucion" className="flex items-center gap-1.5">
            <NotebookPen className="h-3.5 w-3.5" aria-hidden />
            Evolución
          </TabsTrigger>
          <TabsTrigger value="estudios" className="flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden />
            Estudios
          </TabsTrigger>
        </TabsList>

        {/* Resumen */}
        <TabsContent value="resumen" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Motivo de ingreso</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">
                {ep.motivo_ingreso || "Sin descripción registrada."}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documentos — Wizard Fase 5 calculado desde depende_de del workflow */}
        <TabsContent value="documentos" className="mt-4 space-y-3">
          <WizardProximosDocumentos episodioAtencionId={ep.episodio_atencion_id} />

          {/* Accesos rápidos a vistas históricas (mantiene los anteriores) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">
                Accesos directos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                <Button asChild variant="outline" size="sm" className="justify-start">
                  <Link href={`/ece/epicrisis?episodioId=${ep.episodio_atencion_id}`}>
                    Ver epicrisis
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="justify-start">
                  <Link href={`/ece/consentimiento?episodioId=${ep.episodio_atencion_id}`}>
                    Ver consentimientos
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Indicaciones */}
        <TabsContent value="indicaciones" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Button asChild variant="outline" size="sm">
                <Link href={`/ece/indicaciones?episodioId=${ep.episodio_atencion_id}`}>
                  Ver indicaciones médicas
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Evolución */}
        <TabsContent value="evolucion" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Button asChild variant="outline" size="sm">
                <Link href={`/ece/evolucion?episodioId=${ep.episodio_atencion_id}`}>
                  Ver notas de evolución
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Estudios */}
        <TabsContent value="estudios" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Módulo LIS/RIS disponible desde el menú principal.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
