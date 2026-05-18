"use client";

/**
 * Dashboard Quirófano — Vista operacional para Jefe de Servicio.
 *
 * Secciones:
 *   1. KPIs (programadas hoy / en progreso / completadas / suspendidas)
 *   2. Mosaico de salas (estado + cirugía activa si aplica)
 *   3. Cronograma timeline siguiente 8h
 *   4. Alertas operacionales (WHO pending / consentimiento / URPA >30min)
 *
 * Auto-refresh cada 60 segundos vía setInterval.
 *
 * Accesibilidad (WCAG 2.2 AA):
 * - Encabezado h1 claro, secciones con role=region + aria-label.
 * - KPIs en role=list / listitem con aria-label descriptivo.
 * - Alertas en role=alert (live region) para lectores de pantalla.
 * - Todos los colores verificados ≥ 4.5:1.
 * - Skip-link al contenido principal (se hereda de AppShell).
 */

import * as React from "react";
import { Card, CardContent, CardHeader } from "@his/ui/components/card";
import {
  QuirófanoSalaCard,
  type QuirófanoSalaData,
  type EstadoSala,
} from "@/components/quirofano-sala-card";
import { Badge } from "@his/ui/components/badge";

// ─── Tipos locales ─────────────────────────────────────────────────────────────

interface KPI {
  label: string;
  value: number;
  variant: "info" | "warning" | "success" | "destructive" | "secondary";
  ariaLabel: string;
}

interface AlertaOperacional {
  id: string;
  tipo: "who_pending" | "consentimiento_pendiente" | "urpa_alerta";
  mensaje: string;
  salaId?: string;
}

interface SlotTimeline {
  slotId: string;
  hora: string;
  salaId: string;
  salaCodigo: string;
  pacienteNombre: string;
  procedimiento: string;
  estado: "programado" | "en_progreso" | "completado" | "suspendido";
}

// ─── Datos stub (reemplazar con trpc cuando el router quirófano esté listo) ────

const SALAS_STUB: QuirófanoSalaData[] = [
  {
    salaId: "q1",
    codigo: "Q-01",
    nombre: "Sala Principal",
    estado: "ocupada",
    cirugiaActual: {
      id: "c1",
      pacienteNombre: "María González",
      procedimiento: "Colecistectomía laparoscópica",
      inicioEfectivo: new Date(Date.now() - 95 * 60_000),
    },
  },
  {
    salaId: "q2",
    codigo: "Q-02",
    nombre: "Sala Emergencias",
    estado: "ocupada",
    cirugiaActual: {
      id: "c2",
      pacienteNombre: "Carlos Ramírez",
      procedimiento: "Apendicectomía",
      inicioEfectivo: new Date(Date.now() - 35 * 60_000),
    },
  },
  {
    salaId: "q3",
    codigo: "Q-03",
    nombre: "Sala Ortopedia",
    estado: "limpieza",
    cirugiaActual: null,
  },
  {
    salaId: "q4",
    codigo: "Q-04",
    nombre: "Sala Cardiovascular",
    estado: "libre",
    cirugiaActual: null,
  },
  {
    salaId: "q5",
    codigo: "Q-05",
    nombre: "Sala Oftalmología",
    estado: "libre",
    cirugiaActual: null,
  },
  {
    salaId: "q6",
    codigo: "Q-06",
    nombre: "Sala Menor",
    estado: "mantenimiento",
    cirugiaActual: null,
  },
];

const ALERTAS_STUB: AlertaOperacional[] = [
  {
    id: "a1",
    tipo: "who_pending",
    mensaje: "WHO Checklist pendiente — Sala Q-01, María González",
    salaId: "q1",
  },
  {
    id: "a2",
    tipo: "consentimiento_pendiente",
    mensaje: "Consentimiento sin firmar — Carlos Ramírez (Q-02)",
    salaId: "q2",
  },
  {
    id: "a3",
    tipo: "urpa_alerta",
    mensaje: "URPA: paciente Ana Flores > 30 min en recuperación",
  },
];

const TIMELINE_STUB: SlotTimeline[] = [
  {
    slotId: "t1",
    hora: "14:00",
    salaId: "q4",
    salaCodigo: "Q-04",
    pacienteNombre: "Luis Hernández",
    procedimiento: "Hernioplastia inguinal",
    estado: "programado",
  },
  {
    slotId: "t2",
    hora: "15:30",
    salaId: "q5",
    salaCodigo: "Q-05",
    pacienteNombre: "Rosa Martínez",
    procedimiento: "Facoemulsificación OD",
    estado: "programado",
  },
  {
    slotId: "t3",
    hora: "16:00",
    salaId: "q4",
    salaCodigo: "Q-04",
    pacienteNombre: "Pedro Flores",
    procedimiento: "Plastia abdominal",
    estado: "programado",
  },
];

// ─── Config estado timeline ────────────────────────────────────────────────────

const TIMELINE_ESTADO: Record<
  SlotTimeline["estado"],
  { label: string; clase: string }
> = {
  programado:  { label: "Programado",  clase: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200" },
  en_progreso: { label: "En progreso", clase: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  completado:  { label: "Completado",  clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  suspendido:  { label: "Suspendido",  clase: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcularKPIs(salas: QuirófanoSalaData[]): KPI[] {
  const hoy = {
    programadas: 8,
    en_progreso: salas.filter((s) => s.estado === "ocupada").length,
    completadas: 3,
    suspendidas: 1,
  };

  return [
    {
      label: "Programadas hoy",
      value: hoy.programadas,
      variant: "secondary",
      ariaLabel: `${hoy.programadas} cirugías programadas hoy`,
    },
    {
      label: "En progreso",
      value: hoy.en_progreso,
      variant: "warning",
      ariaLabel: `${hoy.en_progreso} cirugías en progreso`,
    },
    {
      label: "Completadas",
      value: hoy.completadas,
      variant: "success",
      ariaLabel: `${hoy.completadas} cirugías completadas`,
    },
    {
      label: "Suspendidas",
      value: hoy.suspendidas,
      variant: "destructive",
      ariaLabel: `${hoy.suspendidas} cirugías suspendidas`,
    },
  ];
}

function estadoSalaConteo(
  salas: QuirófanoSalaData[],
  estado: EstadoSala,
): number {
  return salas.filter((s) => s.estado === estado).length;
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function KPIPanel({ kpis }: { kpis: KPI[] }) {
  return (
    <section aria-label="Indicadores del día" className="mb-6">
      <ul
        role="list"
        className="grid grid-cols-2 gap-4 sm:grid-cols-4"
      >
        {kpis.map((kpi) => (
          <li
            key={kpi.label}
            aria-label={kpi.ariaLabel}
            className="rounded-xl border bg-card p-4 shadow-sm"
          >
            <p className="text-sm text-muted-foreground">{kpi.label}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums" aria-hidden="true">
              {kpi.value}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AlertasPanel({ alertas }: { alertas: AlertaOperacional[] }) {
  if (alertas.length === 0) return null;

  return (
    <section aria-label="Alertas operacionales" className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Alertas
      </h2>
      {/* role=alert para que lectores de pantalla anuncien en cada refresh */}
      <ul
        role="alert"
        aria-live="polite"
        aria-atomic="false"
        className="space-y-2"
      >
        {alertas.map((alerta) => {
          const es_critica =
            alerta.tipo === "who_pending" || alerta.tipo === "urpa_alerta";
          return (
            <li
              key={alerta.id}
              className={
                es_critica
                  ? "flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100"
                  : "flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
              }
            >
              <span aria-hidden="true" className="shrink-0 font-bold">
                {es_critica ? "!" : "•"}
              </span>
              <span>{alerta.mensaje}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MosaicoSalas({
  salas,
  resumen,
}: {
  salas: QuirófanoSalaData[];
  resumen: { libre: number; ocupada: number; limpieza: number; mantenimiento: number };
}) {
  return (
    <section aria-label="Estado de salas quirúrgicas" className="mb-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Salas
        </h2>
        <span
          role="status"
          aria-label={`${resumen.libre} libres, ${resumen.ocupada} ocupadas, ${resumen.limpieza} en limpieza, ${resumen.mantenimiento} en mantenimiento`}
          className="flex flex-wrap gap-2"
        >
          <Badge variant="outline" className="border-emerald-400 text-emerald-700 dark:text-emerald-300">
            Libres: {resumen.libre}
          </Badge>
          <Badge variant="outline" className="border-rose-400 text-rose-700 dark:text-rose-300">
            Ocupadas: {resumen.ocupada}
          </Badge>
          <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
            Limpieza: {resumen.limpieza}
          </Badge>
          <Badge variant="outline" className="border-slate-400 text-slate-600 dark:text-slate-300">
            Mantenimiento: {resumen.mantenimiento}
          </Badge>
        </span>
      </div>

      <div
        role="grid"
        aria-label="Mosaico de salas quirúrgicas"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
      >
        {salas.map((sala) => (
          <div key={sala.salaId} role="gridcell">
            <QuirófanoSalaCard sala={sala} />
          </div>
        ))}
      </div>
    </section>
  );
}

function TimelinePanel({ slots }: { slots: SlotTimeline[] }) {
  return (
    <section aria-label="Cronograma próximas 8 horas" className="mb-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Cronograma — próximas 8 h
      </h2>
      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin cirugías programadas en las próximas 8 horas.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Cronograma quirúrgico de las próximas 8 horas
            </caption>
            <thead>
              <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2 text-left font-semibold">Hora</th>
                <th scope="col" className="px-4 py-2 text-left font-semibold">Sala</th>
                <th scope="col" className="px-4 py-2 text-left font-semibold">Paciente</th>
                <th scope="col" className="px-4 py-2 text-left font-semibold">Procedimiento</th>
                <th scope="col" className="px-4 py-2 text-left font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => {
                const estadoCfg = TIMELINE_ESTADO[slot.estado];
                return (
                  <tr
                    key={slot.slotId}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-mono font-medium">{slot.hora}</td>
                    <td className="px-4 py-3">{slot.salaCodigo}</td>
                    <td className="px-4 py-3">{slot.pacienteNombre}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate">{slot.procedimiento}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${estadoCfg.clase}`}>
                        {estadoCfg.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function QuirófanoDashboardPage() {
  const [salas, setSalas] = React.useState<QuirófanoSalaData[]>(SALAS_STUB);
  const [alertas, setAlertas] = React.useState<AlertaOperacional[]>(ALERTAS_STUB);
  const [slots, setSlots] = React.useState<SlotTimeline[]>(TIMELINE_STUB);
  const [ultimaActualizacion, setUltimaActualizacion] = React.useState(new Date());

  // Auto-refresh cada 60 segundos
  React.useEffect(() => {
    const id = setInterval(() => {
      // Cuando el router tRPC quirófano esté disponible, reemplazar por:
      // utils.quirofano.dashboard.invalidate()
      setSalas([...SALAS_STUB]);
      setAlertas([...ALERTAS_STUB]);
      setSlots([...TIMELINE_STUB]);
      setUltimaActualizacion(new Date());
    }, 60_000);

    return () => clearInterval(id);
  }, []);

  const kpis = React.useMemo(() => calcularKPIs(salas), [salas]);
  const resumen = React.useMemo(
    () => ({
      libre:          estadoSalaConteo(salas, "libre"),
      ocupada:        estadoSalaConteo(salas, "ocupada"),
      limpieza:       estadoSalaConteo(salas, "limpieza"),
      mantenimiento:  estadoSalaConteo(salas, "mantenimiento"),
    }),
    [salas],
  );

  const timeFmt = new Intl.DateTimeFormat("es-SV", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="mx-auto max-w-7xl">
      {/* Encabezado */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard Quirófano</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Vista operacional — Jefe de Servicio
          </p>
        </div>
        <p
          aria-live="polite"
          aria-atomic="true"
          className="text-xs text-muted-foreground"
        >
          Actualizado: {timeFmt.format(ultimaActualizacion)} · Auto-refresh 60 s
        </p>
      </div>

      {/* 1. KPIs */}
      <KPIPanel kpis={kpis} />

      {/* 2. Alertas */}
      <AlertasPanel alertas={alertas} />

      {/* 3. Mosaico salas */}
      <MosaicoSalas salas={salas} resumen={resumen} />

      {/* 4. Cronograma */}
      <TimelinePanel slots={slots} />
    </div>
  );
}
