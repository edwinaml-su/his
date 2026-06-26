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
  HeartPulse,
  Stethoscope,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";
import { WizardProximosDocumentos } from "./_components/wizard-proximos-documentos";
import {
  ProcesoGridTab,
  type ProcesoColumn,
  type ProcesoDetailField,
} from "./_components/proceso-grid-tab";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "short",
});

/** Formato compacto para celdas de grid: «02 jun, 14:30». */
const dateTimeFmt = new Intl.DateTimeFormat("es-SV", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtDT(value: Date | string | null | undefined): string {
  return value ? dateTimeFmt.format(new Date(value)) : "—";
}

/** Muestra un valor o «—» si es null/undefined/"" . */
function orDash(value: unknown): React.ReactNode {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

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

  // Procesos clínicos de la admisión — se consultan por episodio_atencion_id.
  // Se llaman SIEMPRE (reglas de hooks) y se habilitan cuando hay episodio.
  const epAtId = query.data?.episodio_atencion_id;
  const procesoOpts = { enabled: !!epAtId };
  const signosQ = trpc.eceSignosVitales.list.useQuery(
    { episodioId: epAtId ?? "" },
    procesoOpts,
  );
  const indicacionesQ = trpc.eceIndicaciones.list.useQuery(
    { episodioId: epAtId ?? "" },
    procesoOpts,
  );
  const enfermeriaQ = trpc.eceRegistroEnfermeria.list.useQuery(
    { episodioId: epAtId ?? "" },
    procesoOpts,
  );
  const triajeQ = trpc.eceTriaje.list.useQuery(
    { episodioId: epAtId ?? "" },
    procesoOpts,
  );

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground p-6">Cargando cuenta…</p>;
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

  // ── Procesos clínicos: filas normalizadas (unos list devuelven {items}) ──
  const signosRows = signosQ.data?.items ?? [];
  const indicacionesRows = indicacionesQ.data?.items ?? [];
  const enfermeriaRows = enfermeriaQ.data ?? [];
  const triajeRows = triajeQ.data ?? [];

  const signosCols: ProcesoColumn<(typeof signosRows)[number]>[] = [
    { key: "fecha", header: "Fecha/hora", render: (r) => fmtDT(r.fecha_hora_toma) },
    {
      key: "pa",
      header: "PA",
      render: (r) => `${r.presion_sistolica ?? "—"}/${r.presion_diastolica ?? "—"}`,
    },
    { key: "fc", header: "FC", render: (r) => orDash(r.frecuencia_cardiaca) },
    { key: "fr", header: "FR", render: (r) => orDash(r.frecuencia_respiratoria) },
    { key: "temp", header: "Temp °C", render: (r) => orDash(r.temperatura) },
    { key: "spo2", header: "SpO₂ %", render: (r) => orDash(r.saturacion_o2) },
    {
      key: "estado",
      header: "Estado",
      render: (r) => <Badge variant="outline">{r.estado_registro}</Badge>,
    },
  ];
  const signosDetail: ProcesoDetailField<(typeof signosRows)[number]>[] = [
    { label: "Fecha/hora toma", render: (r) => dateFmt.format(new Date(r.fecha_hora_toma)) },
    { label: "Presión arterial", render: (r) => `${r.presion_sistolica ?? "—"}/${r.presion_diastolica ?? "—"} mmHg` },
    { label: "Frecuencia cardíaca", render: (r) => orDash(r.frecuencia_cardiaca) },
    { label: "Frecuencia respiratoria", render: (r) => orDash(r.frecuencia_respiratoria) },
    { label: "Temperatura (°C)", render: (r) => orDash(r.temperatura) },
    { label: "Saturación O₂ (%)", render: (r) => orDash(r.saturacion_o2) },
    { label: "Escala de dolor", render: (r) => orDash(r.escala_dolor) },
    { label: "Peso (kg)", render: (r) => orDash(r.peso_kg) },
    { label: "Talla (cm)", render: (r) => orDash(r.talla_cm) },
    { label: "IMC", render: (r) => orDash(r.imc) },
    { label: "Glucometría (mg/dL)", render: (r) => orDash(r.glucometria_mgdl) },
    { label: "Estado", render: (r) => orDash(r.estado_registro) },
  ];

  const indicacionesCols: ProcesoColumn<(typeof indicacionesRows)[number]>[] = [
    { key: "fecha", header: "Fecha/hora", render: (r) => fmtDT(r.fecha_hora) },
    { key: "vigencia", header: "Vigencia", render: (r) => <Badge variant="outline">{r.vigencia}</Badge> },
    { key: "medico", header: "Médico", render: (r) => orDash(r.medico_prescriptor) },
    { key: "estado", header: "Estado", render: (r) => orDash(r.estado_registro) },
  ];
  const indicacionesDetail: ProcesoDetailField<(typeof indicacionesRows)[number]>[] = [
    { label: "Fecha/hora", render: (r) => dateFmt.format(new Date(r.fecha_hora)) },
    { label: "Versión", render: (r) => orDash(r.version) },
    { label: "Vigencia", render: (r) => orDash(r.vigencia) },
    { label: "Médico prescriptor", render: (r) => orDash(r.medico_prescriptor) },
    { label: "Estado", render: (r) => orDash(r.estado_registro) },
    { label: "Retroactivo", render: (r) => (r.digitado_retroactivamente ? "Sí" : "No") },
    { label: "Transcripción enfermería", render: (r) => orDash(r.transcripcion_enf), full: true },
  ];

  const enfermeriaCols: ProcesoColumn<(typeof enfermeriaRows)[number]>[] = [
    { key: "fecha", header: "Fecha/hora", render: (r) => fmtDT(r.registrado_en) },
    { key: "turno", header: "Turno", render: (r) => orDash(r.turno) },
    { key: "estado", header: "Estado", render: (r) => orDash(r.estado_registro) },
  ];
  const enfermeriaDetail: ProcesoDetailField<(typeof enfermeriaRows)[number]>[] = [
    { label: "Turno", render: (r) => orDash(r.turno) },
    { label: "Estado", render: (r) => orDash(r.estado_registro) },
    { label: "Registrado", render: (r) => dateFmt.format(new Date(r.registrado_en)) },
    { label: "Valoración enfermería", render: (r) => orDash(r.valoracion_enf), full: true },
    { label: "Nota de evolución", render: (r) => orDash(r.nota_evolucion), full: true },
    { label: "Plan de cuidados", render: (r) => orDash(r.plan_cuidados), full: true },
    { label: "SBAR", render: (r) => orDash(r.sbar), full: true },
  ];

  const triajeCols: ProcesoColumn<(typeof triajeRows)[number]>[] = [
    { key: "fecha", header: "Fecha/hora", render: (r) => fmtDT(r.fecha_hora_clasificacion) },
    { key: "nivel", header: "Nivel", render: (r) => <Badge variant="outline">{r.nivel_prioridad}</Badge> },
    { key: "motivo", header: "Motivo", render: (r) => orDash(r.motivo_consulta) },
    { key: "destino", header: "Destino", render: (r) => orDash(r.destino_asignado) },
  ];
  const triajeDetail: ProcesoDetailField<(typeof triajeRows)[number]>[] = [
    { label: "Fecha/hora clasificación", render: (r) => dateFmt.format(new Date(r.fecha_hora_clasificacion)) },
    { label: "Nivel de prioridad", render: (r) => orDash(r.nivel_prioridad) },
    { label: "Destino asignado", render: (r) => orDash(r.destino_asignado) },
    { label: "Tiempo de espera (min)", render: (r) => orDash(r.tiempo_espera_min) },
    { label: "Estado", render: (r) => orDash(r.estado_registro) },
    { label: "Estado workflow", render: (r) => orDash(r.estado_workflow) },
    { label: "Motivo de consulta", render: (r) => orDash(r.motivo_consulta), full: true },
  ];

  // Pestañas dinámicas: solo se muestran si el proceso tiene ≥1 registro.
  const showSignos = signosRows.length > 0;
  const showIndicaciones = indicacionesRows.length > 0;
  const showEnfermeria = enfermeriaRows.length > 0;
  const showTriaje = triajeRows.length > 0;

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
                Cuenta hospitalaria N.°: {ep.id.slice(0, 8)}…
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
        <TabsList aria-label="Secciones de la cuenta hospitalaria">
          <TabsTrigger value="resumen" className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Resumen
          </TabsTrigger>
          {showSignos && (
            <TabsTrigger value="signos" className="flex items-center gap-1.5">
              <HeartPulse className="h-3.5 w-3.5" aria-hidden />
              Signos
            </TabsTrigger>
          )}
          {showIndicaciones && (
            <TabsTrigger value="indicaciones" className="flex items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" aria-hidden />
              Indicaciones
            </TabsTrigger>
          )}
          {showEnfermeria && (
            <TabsTrigger value="enfermeria" className="flex items-center gap-1.5">
              <Stethoscope className="h-3.5 w-3.5" aria-hidden />
              Enfermería
            </TabsTrigger>
          )}
          {showTriaje && (
            <TabsTrigger value="triaje" className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" aria-hidden />
              Triaje
            </TabsTrigger>
          )}
          <TabsTrigger value="documentos" className="flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden />
            Documentos
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

        {/* Signos vitales — grid de tomas + modal de detalle */}
        {showSignos && (
          <TabsContent value="signos" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <ProcesoGridTab
                  rows={signosRows}
                  isLoading={signosQ.isLoading}
                  error={signosQ.error}
                  columns={signosCols}
                  detailTitle="Detalle de toma de signos vitales"
                  detailFields={signosDetail}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Indicaciones médicas — grid + modal */}
        {showIndicaciones && (
          <TabsContent value="indicaciones" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <ProcesoGridTab
                  rows={indicacionesRows}
                  isLoading={indicacionesQ.isLoading}
                  error={indicacionesQ.error}
                  columns={indicacionesCols}
                  detailTitle="Detalle de indicación médica"
                  detailFields={indicacionesDetail}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Registro de enfermería — grid + modal */}
        {showEnfermeria && (
          <TabsContent value="enfermeria" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <ProcesoGridTab
                  rows={enfermeriaRows}
                  isLoading={enfermeriaQ.isLoading}
                  error={enfermeriaQ.error}
                  columns={enfermeriaCols}
                  detailTitle="Detalle de registro de enfermería"
                  detailFields={enfermeriaDetail}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Triaje — grid + modal */}
        {showTriaje && (
          <TabsContent value="triaje" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <ProcesoGridTab
                  rows={triajeRows}
                  isLoading={triajeQ.isLoading}
                  error={triajeQ.error}
                  columns={triajeCols}
                  detailTitle="Detalle de hoja de triaje"
                  detailFields={triajeDetail}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

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
