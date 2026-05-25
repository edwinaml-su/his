"use client";

/**
 * /triage/monitor — Wallboard de monitoreo de triage (modo TV / monitor de pared).
 *
 * Layout kanban con 5 columnas Manchester (RED/ORANGE/YELLOW/GREEN/BLUE).
 * Cada card muestra:
 *  - Nombre + identificación visual de sexo (♀ magenta / ♂ cian).
 *  - Edad + MRN.
 *  - Paso del proceso clínico actual (En triage / En consulta / Pendiente lab,
 *    imagen, admisión / Admitido / Alta próxima).
 *  - Cronómetro elapsed/max + estado overdue.
 *
 * Auto-refresh cada 5 segundos.
 *
 * Optimizado para TV: high contrast, font grande, no requiere scroll en 1080p.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Maximize2 } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

type Color = "RED" | "ORANGE" | "YELLOW" | "GREEN" | "BLUE";
type SexCode = "M" | "F" | "I" | "U";
type ProcessStep =
  | "TRIAGE"
  | "WAITING_DOCTOR"
  | "IN_CONSULTATION"
  | "PENDING_LAB"
  | "PENDING_IMAGING"
  | "PENDING_ADMISSION"
  | "ADMITTED"
  | "DISCHARGE_READY"
  | "UNKNOWN";

interface MonitorItem {
  id: string;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
    ageYears: number | null;
    sexCode: SexCode | null;
    isUnknown: boolean;
  };
  encounterId: string | null;
  assignedLevel: {
    color: Color;
    name: string;
    priority: number;
    maxWaitMinutes: number;
    uiColorHex: string | null;
  };
  startedAt: Date;
  elapsedMinutes: number;
  remainingMinutes: number;
  isOverdue: boolean;
  severity: "NORMAL" | "WARNING" | "CRITICAL";
  processStep: ProcessStep;
  processStepLabel: string;
}

interface MonitorLevel {
  color: Color;
  name: string;
  uiColorHex: string | null;
  maxWaitMinutes: number;
  count: number;
  overdueCount: number;
  items: MonitorItem[];
}

interface MonitorResponse {
  serverNow: Date;
  totalActive: number;
  totalOverdue: number;
  levels: MonitorLevel[];
}

// ---------------------------------------------------------------------------
// Theming por color Manchester — bg para header, border-l para cards.
// ---------------------------------------------------------------------------
const LEVEL_THEME: Record<
  Color,
  { headerBg: string; headerText: string; cardAccent: string; emoji: string }
> = {
  RED:    { headerBg: "bg-red-700",    headerText: "text-white",  cardAccent: "border-l-red-600",    emoji: "🔴" },
  ORANGE: { headerBg: "bg-orange-600", headerText: "text-white",  cardAccent: "border-l-orange-500", emoji: "🟠" },
  YELLOW: { headerBg: "bg-yellow-400", headerText: "text-black",  cardAccent: "border-l-yellow-500", emoji: "🟡" },
  GREEN:  { headerBg: "bg-green-600",  headerText: "text-white",  cardAccent: "border-l-green-600",  emoji: "🟢" },
  BLUE:   { headerBg: "bg-blue-600",   headerText: "text-white",  cardAccent: "border-l-blue-600",   emoji: "🔵" },
};

const PROCESS_STEP_STYLE: Record<ProcessStep, { dot: string; label: string }> = {
  TRIAGE:            { dot: "bg-slate-500",    label: "text-slate-700 dark:text-slate-300" },
  WAITING_DOCTOR:    { dot: "bg-amber-500",    label: "text-amber-700 dark:text-amber-400" },
  IN_CONSULTATION:   { dot: "bg-emerald-500",  label: "text-emerald-700 dark:text-emerald-400" },
  PENDING_LAB:       { dot: "bg-purple-500",   label: "text-purple-700 dark:text-purple-400" },
  PENDING_IMAGING:   { dot: "bg-indigo-500",   label: "text-indigo-700 dark:text-indigo-400" },
  PENDING_ADMISSION: { dot: "bg-orange-500",   label: "text-orange-700 dark:text-orange-400" },
  ADMITTED:          { dot: "bg-blue-600",     label: "text-blue-700 dark:text-blue-400" },
  DISCHARGE_READY:   { dot: "bg-teal-500",     label: "text-teal-700 dark:text-teal-400" },
  UNKNOWN:           { dot: "bg-gray-400",     label: "text-gray-600 dark:text-gray-400" },
};

// Magenta = femenino, Cian = masculino — convención solicitada.
const SEX_STYLE: Record<
  SexCode,
  { icon: string; bg: string; text: string; label: string }
> = {
  F: { icon: "♀", bg: "bg-fuchsia-500", text: "text-white",  label: "Femenino" },
  M: { icon: "♂", bg: "bg-cyan-500",    text: "text-white",  label: "Masculino" },
  I: { icon: "⚧", bg: "bg-purple-500",  text: "text-white",  label: "Intersexual" },
  U: { icon: "?", bg: "bg-gray-400",    text: "text-white",  label: "No determinado" },
};

function formatMinutes(m: number): string {
  if (m < 0) {
    const abs = Math.abs(m);
    if (abs < 60) return `+${Math.floor(abs)} min`;
    return `+${Math.floor(abs / 60)}h ${Math.floor(abs % 60)}m`;
  }
  if (m < 60) return `${Math.floor(m)} min`;
  return `${Math.floor(m / 60)}h ${Math.floor(m % 60)}m`;
}

function PatientCard({ item }: { item: MonitorItem }) {
  const theme = LEVEL_THEME[item.assignedLevel.color];
  const sex = item.patient.sexCode ? SEX_STYLE[item.patient.sexCode] : null;
  const step = PROCESS_STEP_STYLE[item.processStep];
  const fullName = `${item.patient.firstName} ${item.patient.lastName}`.trim();
  const overdueRing = item.isOverdue
    ? "ring-2 ring-red-500 ring-offset-1 animate-pulse"
    : item.severity === "WARNING"
      ? "ring-1 ring-amber-400"
      : "";

  return (
    <Link
      href={`/triage/${item.id}/discriminators`}
      className={[
        "block rounded-md border-l-4 bg-card p-2 shadow-sm transition-transform hover:scale-[1.02] hover:shadow-md",
        theme.cardAccent,
        overdueRing,
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        {sex && (
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base font-bold ${sex.bg} ${sex.text}`}
            aria-label={sex.label}
            title={sex.label}
          >
            {sex.icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">
            {item.patient.isUnknown ? `NN — ${item.patient.mrn}` : fullName}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {!item.patient.isUnknown && <span>{item.patient.mrn}</span>}
            {item.patient.ageYears !== null && (
              <span className="ml-1">· {item.patient.ageYears}a</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${step.dot}`} aria-hidden="true" />
          <span className={`text-xs font-medium ${step.label}`}>
            {item.processStepLabel}
          </span>
        </div>
        <span
          className={`tabular-nums text-xs font-mono ${
            item.isOverdue
              ? "font-bold text-red-600"
              : item.severity === "WARNING"
                ? "text-amber-600"
                : "text-muted-foreground"
          }`}
          aria-label={`Tiempo ${item.isOverdue ? "excedido" : "transcurrido"}`}
        >
          {item.isOverdue ? "−" : ""}
          {formatMinutes(item.isOverdue ? -item.remainingMinutes : item.elapsedMinutes)}
        </span>
      </div>
    </Link>
  );
}

function LevelColumn({ level }: { level: MonitorLevel }) {
  const theme = LEVEL_THEME[level.color];
  return (
    <section
      className="flex min-h-[60vh] flex-col rounded-md border bg-muted/20"
      aria-label={`Pacientes nivel ${level.name}`}
    >
      <header
        className={`flex items-center justify-between rounded-t-md px-3 py-2 ${theme.headerBg} ${theme.headerText}`}
      >
        <div className="flex items-center gap-2">
          <span aria-hidden="true">{theme.emoji}</span>
          <span className="text-sm font-bold uppercase tracking-wide">{level.name}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-extrabold tabular-nums">{level.count}</span>
          {level.overdueCount > 0 && (
            <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold">
              +{level.overdueCount}
            </span>
          )}
        </div>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {level.items.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Sin pacientes
          </p>
        ) : (
          level.items.map((item) => <PatientCard key={item.id} item={item} />)
        )}
      </div>
      <footer className="border-t px-2 py-1 text-[10px] text-muted-foreground">
        Espera máx. {level.maxWaitMinutes} min
      </footer>
    </section>
  );
}

export default function TriageMonitorPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const query = trpcAny.triageDashboard.monitorWallboard.useQuery(undefined, {
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  const data = (query.data ?? null) as MonitorResponse | null;

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      document.exitFullscreen().catch(() => undefined);
    }
  }

  // Leyenda compact en footer fijo de la pantalla.
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/triage">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Volver
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Monitor de Triage</h1>
            <p className="text-xs text-muted-foreground">
              {data
                ? `${data.totalActive} activos · ${data.totalOverdue} excedidos · actualiza cada 5s`
                : "Cargando…"}
              {query.isFetching && " · refrescando"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            <RefreshCw className={`mr-1 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
          <Button variant="outline" size="sm" onClick={toggleFullscreen}>
            <Maximize2 className="mr-1 h-4 w-4" />
            Pantalla completa
          </Button>
        </div>
      </header>

      {query.error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(query.error as { message?: string })?.message ?? "Error al cargar wallboard."}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-2 overflow-hidden sm:grid-cols-2 lg:grid-cols-5">
        {(data?.levels ?? []).map((level) => (
          <LevelColumn key={level.color} level={level} />
        ))}
        {!data &&
          (["RED", "ORANGE", "YELLOW", "GREEN", "BLUE"] as Color[]).map((c) => (
            <section
              key={c}
              className="flex min-h-[60vh] animate-pulse flex-col rounded-md border bg-muted/30"
            />
          ))}
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
        <span className="font-semibold uppercase">Leyenda:</span>
        <span className="inline-flex items-center gap-1">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-fuchsia-500 text-[10px] font-bold text-white">♀</span>
          Femenino
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 text-[10px] font-bold text-white">♂</span>
          Masculino
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          En triage
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Espera consulta
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          En consulta
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-purple-500" />
          Lab
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-indigo-500" />
          Imagen
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-orange-500" />
          Pendiente admisión
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-blue-600" />
          Admitido
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-teal-500" />
          Alta próxima
        </span>
      </footer>
    </div>
  );
}
