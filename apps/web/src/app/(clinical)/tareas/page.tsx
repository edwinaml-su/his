"use client";

/**
 * /tareas — Bandeja BPM centralizada (Ola 1).
 *
 * 29 fuentes BPM activas: 6 base + 11 NTEC + 7 JCI + 5 Quirófano.
 * Cada usuario solo ve tareas para las que tiene rol RBAC.
 *
 * Spec: packages/contracts/src/schemas/workflow-inbox.ts
 */
import * as React from "react";
import Link from "next/link";
import {
  Inbox,
  AlertTriangle,
  Clock,
  ChevronRight,
  Loader2,
  Filter,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

type Priority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

interface Task {
  id: string;
  type: string;
  typeLabel: string;
  priority: Priority;
  patientName: string | null;
  patientMrn: string | null;
  description: string;
  createdAt: string | Date;
  ageMinutes: number;
  remainingMinutes: number | null;
  isOverdue: boolean;
  deepLink: string;
  requiredRoles: string[];
}

interface CountByType {
  type: string;
  typeLabel: string;
  count: number;
  overdueCount: number;
}

interface InboxResponse {
  serverNow: string | Date;
  totalTasks: number;
  overdueTasks: number;
  countsByType: CountByType[];
  tasks: Task[];
}

const PRIORITY_THEME: Record<
  Priority,
  { bg: string; text: string; ring: string; label: string }
> = {
  CRITICAL: { bg: "bg-red-600", text: "text-white", ring: "ring-2 ring-red-500 animate-pulse", label: "Crítico" },
  HIGH:     { bg: "bg-orange-500", text: "text-white", ring: "ring-1 ring-orange-400", label: "Alto" },
  NORMAL:   { bg: "bg-blue-500", text: "text-white", ring: "", label: "Normal" },
  LOW:      { bg: "bg-slate-400", text: "text-white", ring: "", label: "Bajo" },
};

// Mapeo color de fondo del icono por tipo (agrupado por dominio).
function typeBgColor(type: string): string {
  if (type.startsWith("PRESCRIPTION") || type.startsWith("MED_")) return "bg-emerald-100 text-emerald-700";
  if (type.startsWith("TRIAGE") || type === "WRISTBAND_MISSING") return "bg-red-100 text-red-700";
  if (type.startsWith("LAB_")) return "bg-purple-100 text-purple-700";
  if (type.startsWith("IMAGING_") || type === "STUDY_TO_SCHEDULE") return "bg-indigo-100 text-indigo-700";
  if (type.startsWith("SURGERY_") || type === "ANESTHESIA_RECORD_OPEN" || type === "URPA_DISCHARGE_PENDING" || type === "WHO_CHECKLIST_INCOMPLETE")
    return "bg-rose-100 text-rose-700";
  if (type.startsWith("ECE_") || type === "HC_TO_SIGN" || type === "EPICRISIS_TO_SIGN" || type === "EVOLUTION_TO_WRITE" ||
      type === "VALORACION_INICIAL_PENDING" || type === "MEDICAL_CONSENT_PENDING" || type === "ORDEN_INGRESO_PENDING" ||
      type === "ATENCION_EMERGENCIA_PENDING" || type === "RRI_PENDING" || type === "ISSS_CERT_PENDING")
    return "bg-amber-100 text-amber-700";
  if (type === "VERBAL_ORDER_TO_CONFIRM" || type === "CRITICAL_RESULT_TO_NOTIFY" ||
      type === "DOUBLE_CHECK_PENDING" || type === "FALL_REPORT_PENDING" || type === "MORSE_REEVALUATE")
    return "bg-pink-100 text-pink-700";
  // Ola 2
  if (type === "BED_TO_CLEAN" || type === "BED_TO_RELEASE") return "bg-sky-100 text-sky-700";
  if (type === "TRANSFER_PENDING_ACCEPT" || type === "ADMISSION_VITALS_MISSING") return "bg-blue-100 text-blue-700";
  if (type === "APPOINTMENT_TO_CHECKIN" || type === "CONSULTATION_NOTE_PENDING" || type === "APPOINTMENT_NO_SHOW_FOLLOWUP")
    return "bg-teal-100 text-teal-700";
  if (type === "RESPIRATORY_ORDER_PENDING" || type === "NUTRITION_ORDER_PENDING") return "bg-violet-100 text-violet-700";
  if (type === "PARTOGRAMA_OVERDUE" || type === "RN_APGAR_PENDING" || type === "NRP_POSTEVENT_DEBRIEF")
    return "bg-fuchsia-100 text-fuchsia-700";
  if (type === "BLOOD_VERIFY_PENDING" || type === "BLOOD_REACTION_REPORT") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-700";
}

function fmtAge(min: number): string {
  if (min < 60) return `${Math.floor(min)}m`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = Math.floor(min % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(min / (60 * 24))}d`;
}

function fmtRemaining(min: number | null): string {
  if (min === null) return "—";
  if (min < 0) return `+${fmtAge(Math.abs(min))} excedido`;
  return `${fmtAge(min)} restante`;
}

export default function TareasPage() {
  const [selectedTypes, setSelectedTypes] = React.useState<Set<string>>(new Set());
  const [onlyOverdue, setOnlyOverdue] = React.useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const query = trpcAny.workflowInbox.miBandeja.useQuery(
    {
      types: selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined,
      onlyOverdue,
      limit: 200,
    },
    { refetchInterval: 30_000, refetchOnWindowFocus: true },
  );

  const data = (query.data ?? null) as InboxResponse | null;

  function toggleType(t: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function clearFilters() {
    setSelectedTypes(new Set());
    setOnlyOverdue(false);
  }

  const tasks = data?.tasks ?? [];
  const counts = data?.countsByType ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Inbox className="h-6 w-6" />
            Mi bandeja de tareas
          </h1>
          <p className="text-sm text-muted-foreground">
            Tareas BPM enrutadas según tus roles activos.
            {data ? (
              <>
                {" — "}
                <strong>{data.totalTasks}</strong> pendientes
                {data.overdueTasks > 0 ? (
                  <>
                    {", "}
                    <span className="font-bold text-red-600">
                      {data.overdueTasks} excedidas
                    </span>
                  </>
                ) : null}
                {query.isFetching && " · actualizando"}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={onlyOverdue ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyOverdue((v) => !v)}
          >
            <AlertTriangle className="mr-1 h-4 w-4" />
            Solo excedidas
          </Button>
          {(selectedTypes.size > 0 || onlyOverdue) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          )}
        </div>
      </div>

      {counts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Filter className="h-4 w-4" />
              Por tipo de tarea
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {counts.map((c) => {
                const selected = selectedTypes.has(c.type);
                return (
                  <button
                    key={c.type}
                    type="button"
                    onClick={() => toggleType(c.type)}
                    className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      selected ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"
                    }`}
                  >
                    <span>{c.typeLabel}</span>
                    <Badge variant="outline" className="font-mono text-xs">{c.count}</Badge>
                    {c.overdueCount > 0 && (
                      <Badge variant="destructive" className="text-[10px]">{c.overdueCount}</Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Tareas pendientes</span>
            {tasks.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {tasks.length} mostradas
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {query.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(query.error as { message?: string })?.message ?? "Error al cargar bandeja."}
            </div>
          )}

          {data && tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="text-sm font-medium">
                {selectedTypes.size > 0 || onlyOverdue
                  ? "Sin tareas para los filtros aplicados."
                  : "Sin tareas pendientes."}
              </p>
              <p className="text-xs text-muted-foreground">
                Vuelve más tarde o usa el menú lateral para acciones independientes.
              </p>
            </div>
          )}

          {tasks.length > 0 && (
            <ul className="space-y-2">
              {tasks.map((t) => {
                const theme = PRIORITY_THEME[t.priority];
                const iconBg = typeBgColor(t.type);
                return (
                  <li key={t.id}>
                    <Link
                      href={t.deepLink}
                      className={`flex items-start gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-accent ${theme.ring}`}
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${iconBg}`}
                        aria-hidden="true"
                      >
                        <Inbox className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{t.typeLabel}</span>
                          <Badge className={`${theme.bg} ${theme.text} text-[10px]`}>{theme.label}</Badge>
                          {t.isOverdue && (
                            <Badge variant="destructive" className="text-[10px]">SLA excedido</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">{t.description}</p>
                        {(t.patientName || t.patientMrn) && (
                          <p className="mt-0.5 text-xs">
                            <span className="font-medium">
                              {t.patientName ?? "Paciente sin nombre"}
                            </span>
                            {t.patientMrn && (
                              <span className="ml-1 font-mono text-muted-foreground">
                                · {t.patientMrn}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {fmtAge(t.ageMinutes)}
                        </span>
                        <span
                          className={
                            t.isOverdue
                              ? "font-mono font-semibold text-red-600"
                              : t.priority === "HIGH"
                                ? "font-mono text-orange-600"
                                : "font-mono text-muted-foreground"
                          }
                        >
                          {fmtRemaining(t.remainingMinutes)}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
