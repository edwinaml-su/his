"use client";

/**
 * ECE — Detalle de admisión (genérico, ambulatorio u hospitalario).
 *
 * Para admisiones que TAMBIÉN tienen episodio_hospitalario, se muestra un banner
 * con link a /ece/episodio-hospitalario/[id] (que tiene su flujo de alta + cama).
 * El usuario puede ver el detalle ambulatorio igual.
 *
 * Pestañas dinámicas: solo se muestran si el proceso tiene ≥1 registro.
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BedDouble,
  Calendar,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FlaskConical,
  HeartPulse,
  ImageIcon,
  NotebookPen,
  Scissors,
  Stethoscope,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";
import {
  ProcesoGridTab,
  type ProcesoColumn,
  type ProcesoDetailField,
} from "../../episodio-hospitalario/[id]/_components/proceso-grid-tab";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "short",
});

const dateTimeFmt = new Intl.DateTimeFormat("es-SV", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtDT(value: Date | string | null | undefined): string {
  return value ? dateTimeFmt.format(new Date(value)) : "—";
}

function orDash(value: unknown): React.ReactNode {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  abierto: "default",
  en_curso: "default",
  alta_iniciada: "secondary",
  cerrado: "outline",
  cancelado: "destructive",
};

const MODALIDAD_LABEL: Record<string, string> = {
  ambulatorio: "Ambulatorio",
  hospitalario: "Hospitalario",
};

const CATEGORIA_LABEL: Record<string, string> = {
  consulta_externa: "Consulta externa",
  emergencia: "Emergencia",
  hospitalizacion: "Hospitalización",
  hospital_de_dia: "Hospital de día",
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function AdmisionDetallePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const query = trpc.eceEpisodioHospitalario.getDetalleAdmision.useQuery(
    { id },
    { enabled: !!id },
  );

  // Procesos por episodio. Habilitados solo cuando hay episodioId. La tipificación
  // se cierra dentro de cada bloque para evitar accesos a campos no enviados.
  const opts = { enabled: !!id };
  const signosQ = trpc.eceSignosVitales.list.useQuery({ episodioId: id }, opts);
  const indicacionesQ = trpc.eceIndicaciones.list.useQuery({ episodioId: id }, opts);
  const enfermeriaQ = trpc.eceRegistroEnfermeria.list.useQuery({ episodioId: id }, opts);
  const triajeQ = trpc.eceTriaje.list.useQuery({ episodioId: id }, opts);
  const estudiosQ = trpc.eceSolicitudEstudio.list.useQuery({ episodioId: id, limit: 100 }, opts);
  const procedimientosQ = trpc.eceActoQx.list.useQuery({ episodioId: id, limit: 100 }, opts);

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground p-6">Cargando admisión…</p>;
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="m-6 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {query.error.message}
      </div>
    );
  }

  const ad = query.data;
  if (!ad) return null;

  // ── Filas normalizadas (algunos list devuelven {items}, otros array) ──
  const signosRows = signosQ.data?.items ?? [];
  const indicacionesRows = indicacionesQ.data?.items ?? [];
  const enfermeriaRows = enfermeriaQ.data ?? [];
  const triajeRows = triajeQ.data ?? [];
  const estudiosRows = estudiosQ.data?.items ?? [];
  const procedimientosRows = procedimientosQ.data?.items ?? [];

  // ── Definiciones de columnas (mismo patrón que episodio-hospitalario) ──
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
  ];
  const signosDetail: ProcesoDetailField<(typeof signosRows)[number]>[] = [
    { label: "Fecha/hora toma", render: (r) => dateFmt.format(new Date(r.fecha_hora_toma)) },
    { label: "Presión arterial", render: (r) => `${r.presion_sistolica ?? "—"}/${r.presion_diastolica ?? "—"} mmHg` },
    { label: "Frecuencia cardíaca", render: (r) => orDash(r.frecuencia_cardiaca) },
    { label: "Frecuencia respiratoria", render: (r) => orDash(r.frecuencia_respiratoria) },
    { label: "Temperatura (°C)", render: (r) => orDash(r.temperatura) },
    { label: "Saturación O₂ (%)", render: (r) => orDash(r.saturacion_o2) },
    { label: "Escala de dolor", render: (r) => orDash(r.escala_dolor) },
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
    { label: "Motivo de consulta", render: (r) => orDash(r.motivo_consulta), full: true },
  ];

  type EstudioRow = (typeof estudiosRows)[number];
  const estudiosCols: ProcesoColumn<EstudioRow>[] = [
    { key: "fecha", header: "Fecha", render: (r) => fmtDT(r.fecha_hora) },
    { key: "tipo", header: "Tipo", render: (r) => <Badge variant="outline">{r.tipo}</Badge> },
    {
      key: "estado",
      header: "Estado",
      render: (r) => <Badge variant={r.estado === "anulado" ? "destructive" : "secondary"}>{r.estado}</Badge>,
    },
    { key: "indicacion", header: "Indicación clínica", render: (r) => orDash(r.indicacion_clinica) },
  ];
  const estudiosDetail: ProcesoDetailField<EstudioRow>[] = [
    { label: "Tipo", render: (r) => r.tipo },
    { label: "Fecha/hora", render: (r) => dateFmt.format(new Date(r.fecha_hora)) },
    { label: "Estado", render: (r) => r.estado },
    { label: "Médico solicitante", render: (r) => r.medico_solicitante_id },
    { label: "Indicación clínica", render: (r) => orDash(r.indicacion_clinica), full: true },
    {
      label: "Exámenes (JSONB)",
      render: (r) => <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(r.examenes, null, 2)}</pre>,
      full: true,
    },
  ];

  type ProcRow = (typeof procedimientosRows)[number];
  const procedimientosCols: ProcesoColumn<ProcRow>[] = [
    { key: "fecha", header: "Fecha", render: (r) => fmtDT(r.hora_inicio) },
    { key: "diag", header: "Diagnóstico pre", render: (r) => orDash(r.diagnostico_pre) },
    {
      key: "estado",
      header: "Estado",
      render: (r) => <Badge variant="outline">{r.estado_codigo}</Badge>,
    },
  ];
  const procedimientosDetail: ProcesoDetailField<ProcRow>[] = [
    { label: "Fecha/hora inicio", render: (r) => fmtDT(r.hora_inicio) },
    { label: "Fecha/hora fin", render: (r) => fmtDT(r.hora_fin) },
    { label: "Estado workflow", render: (r) => r.estado_codigo },
    { label: "Cirujano", render: (r) => orDash(r.cirujano_id) },
    { label: "Anestesiólogo", render: (r) => orDash(r.anestesiologo_id) },
    { label: "Diagnóstico pre", render: (r) => orDash(r.diagnostico_pre), full: true },
    { label: "Diagnóstico post", render: (r) => orDash(r.diagnostico_post), full: true },
    { label: "Procedimiento realizado", render: (r) => orDash(r.procedimiento_realizado), full: true },
    { label: "Hallazgos", render: (r) => orDash(r.hallazgos), full: true },
  ];

  // Tabs dinámicas — solo se muestran si hay registros.
  const showSignos = signosRows.length > 0;
  const showIndicaciones = indicacionesRows.length > 0;
  const showEnfermeria = enfermeriaRows.length > 0;
  const showTriaje = triajeRows.length > 0;
  const showEstudios = estudiosRows.length > 0;
  const showProcedimientos = procedimientosRows.length > 0;

  return (
    <div className="space-y-4">
      {/* Navegación */}
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/ece">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Admisiones
          </Link>
        </Button>
      </div>

      {/* Banner si la admisión tiene hospitalización */}
      {ad.episodio_hospitalario_id && (
        <div className="flex items-start gap-3 rounded-md border border-info/40 bg-info/10 p-3 text-sm">
          <BedDouble className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <div className="flex-1 space-y-1">
            <p className="font-medium">Esta admisión incluye hospitalización</p>
            <p className="text-muted-foreground">
              Para ver el ciclo hospitalario completo (cama, alta, epicrisis) abre el
              detalle del episodio hospitalario.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/ece/episodio-hospitalario/${ad.id}`}>Ir al hospitalario</Link>
          </Button>
        </div>
      )}

      {/* Cabecera */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-muted-foreground" aria-hidden />
                <CardTitle className="text-xl">{ad.paciente_nombre}</CardTitle>
                <Badge variant={ESTADO_VARIANT[ad.estado] ?? "outline"}>
                  {ad.estado.replace(/_/g, " ")}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground font-mono">
                Admisión: {ad.public_encounter_id ? `${ad.public_encounter_id.slice(0, 8)}…` : ad.id.slice(0, 8) + "…"}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">Modalidad</dt>
              <dd className="font-medium">{MODALIDAD_LABEL[ad.modalidad] ?? ad.modalidad}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">Área</dt>
              <dd>
                {ad.servicio_nombre ??
                  (ad.servicio_categoria ? CATEGORIA_LABEL[ad.servicio_categoria] ?? ad.servicio_categoria : "—")}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" aria-hidden />
                Inicio
              </dt>
              <dd className="tabular-nums">{dateFmt.format(new Date(ad.fecha_inicio))}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">Cierre</dt>
              <dd className="tabular-nums">
                {ad.fecha_cierre ? dateFmt.format(new Date(ad.fecha_cierre)) : "—"}
              </dd>
            </div>
            <div className="col-span-2 space-y-0.5 md:col-span-4">
              <dt className="text-xs text-muted-foreground">Motivo</dt>
              <dd className="whitespace-pre-wrap">{ad.motivo || "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="resumen">
        <TabsList aria-label="Secciones de la admisión">
          <TabsTrigger value="resumen" className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" aria-hidden /> Resumen
          </TabsTrigger>
          {showTriaje && (
            <TabsTrigger value="triaje" className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" aria-hidden /> Triaje
            </TabsTrigger>
          )}
          {showSignos && (
            <TabsTrigger value="signos" className="flex items-center gap-1.5">
              <HeartPulse className="h-3.5 w-3.5" aria-hidden /> Signos
            </TabsTrigger>
          )}
          {showIndicaciones && (
            <TabsTrigger value="indicaciones" className="flex items-center gap-1.5">
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden /> Indicaciones
            </TabsTrigger>
          )}
          {showEnfermeria && (
            <TabsTrigger value="enfermeria" className="flex items-center gap-1.5">
              <Stethoscope className="h-3.5 w-3.5" aria-hidden /> Enfermería
            </TabsTrigger>
          )}
          {showEstudios && (
            <TabsTrigger value="estudios" className="flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Estudios
            </TabsTrigger>
          )}
          {showProcedimientos && (
            <TabsTrigger value="procedimientos" className="flex items-center gap-1.5">
              <Scissors className="h-3.5 w-3.5" aria-hidden /> Procedimientos
            </TabsTrigger>
          )}
          <TabsTrigger value="evolucion" className="flex items-center gap-1.5">
            <NotebookPen className="h-3.5 w-3.5" aria-hidden /> Evolución
          </TabsTrigger>
          <TabsTrigger value="documentos" className="flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Documentos
          </TabsTrigger>
          <TabsTrigger value="imagenes" className="flex items-center gap-1.5">
            <ImageIcon className="h-3.5 w-3.5" aria-hidden /> Imágenes
          </TabsTrigger>
        </TabsList>

        {/* Resumen */}
        <TabsContent value="resumen" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contenido de la admisión</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {ad.episodio_hospitalario_id && (
                  <Badge variant="secondary" className="gap-1">
                    <BedDouble className="h-3 w-3" aria-hidden /> Hospitalización
                  </Badge>
                )}
                {ad.procedimientos_count > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <Scissors className="h-3 w-3" aria-hidden /> {ad.procedimientos_count} procedimiento{ad.procedimientos_count !== 1 && "s"}
                  </Badge>
                )}
                {ad.lab_count > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <FlaskConical className="h-3 w-3" aria-hidden /> {ad.lab_count} lab
                  </Badge>
                )}
                {ad.imagen_count > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <ImageIcon className="h-3 w-3" aria-hidden /> {ad.imagen_count} imagen
                  </Badge>
                )}
                {ad.gabinete_count > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <Activity className="h-3 w-3" aria-hidden /> {ad.gabinete_count} gabinete
                  </Badge>
                )}
                {!ad.episodio_hospitalario_id
                  && ad.procedimientos_count === 0
                  && ad.lab_count === 0
                  && ad.imagen_count === 0
                  && ad.gabinete_count === 0 && (
                    <span className="text-sm text-muted-foreground">
                      Sin actividad clínica registrada aún en esta admisión.
                    </span>
                  )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

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

        {showEstudios && (
          <TabsContent value="estudios" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <ProcesoGridTab
                  rows={estudiosRows}
                  isLoading={estudiosQ.isLoading}
                  error={estudiosQ.error}
                  columns={estudiosCols}
                  detailTitle="Detalle de solicitud de estudio"
                  detailFields={estudiosDetail}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {showProcedimientos && (
          <TabsContent value="procedimientos" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <ProcesoGridTab
                  rows={procedimientosRows}
                  isLoading={procedimientosQ.isLoading}
                  error={procedimientosQ.error}
                  columns={procedimientosCols}
                  detailTitle="Detalle de procedimiento quirúrgico"
                  detailFields={procedimientosDetail}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="evolucion" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Button asChild variant="outline" size="sm">
                <Link href={`/ece/evolucion?episodioId=${ad.id}`}>
                  Ver notas de evolución del episodio
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          <Card>
            <CardContent className="pt-6 space-y-2">
              <Button asChild variant="outline" size="sm" className="justify-start">
                <Link href={`/ece/consentimiento?episodioId=${ad.id}`}>
                  Consentimientos del episodio
                </Link>
              </Button>
              {ad.servicio_categoria === "emergencia" && (
                <Button asChild variant="outline" size="sm" className="justify-start">
                  <Link href={`/ece/atencion-emergencia?episodioId=${ad.id}`}>
                    Atención de emergencia
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="imagenes" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Las imágenes y reportes RIS se gestionan desde el módulo Imágenes del menú
                principal. Los conteos de la cabecera indican cuántas solicitudes hay para
                este episodio.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
