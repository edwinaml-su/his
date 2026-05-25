"use client";

/**
 * /tareas — Bandeja BPM centralizada de tareas pendientes por usuario.
 *
 * Patrón BPM: lista todas las tareas pendientes asignadas según el rol RBAC
 * del usuario. Combina fuentes: recetas, triages, lab, imagen, dispensación,
 * BCMA. Permite ir directo al formulario de cada tarea (deep link).
 *
 * Auto-refresh: 30s. Filtros por tipo, prioridad, overdue.
 *
 * No reemplaza el menú lateral — es un shortcut centralizado. Las acciones
 * independientes siguen disponibles desde sus respectivos módulos.
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

type TaskType =
  | "PRESCRIPTION_TO_SIGN"
  | "PRESCRIPTION_TO_DISPENSE"
  | "TRIAGE_IN_PROGRESS"
  | "LAB_TO_PROCESS"
  | "LAB_TO_VALIDATE"
  | "IMAGING_TO_REPORT"
  | "IMAGING_TO_VALIDATE"
  | "ECE_RECTIFICACION_PENDING"
  | "ECE_DOC_TO_CERTIFY"
  | "MED_TO_ADMINISTER";

type Priority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

interface Task {
  id: string;
  type: TaskType;
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
  type: TaskType;
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
  CRITICAL: {
    bg: "bg-red-600",
    text: "text-white",
    ring: "ring-2 ring-red-500 animate-pulse",
    label: "Crítico",
  },
  HIGH:   { bg: "bg-orange-500", text: "text-white", ring: "ring-1 ring-orange-400", label: "Alto" },
  NORMAL: { bg: "bg-blue-500",   text: "text-white", ring: "", label: "Normal" },
  LOW:    { bg: "bg-slate-400",  text: "text-white", ring: "", label: "Bajo" },
};

const TYPE_ICON_BG: Record<TaskType, string> = {
  PRESCRIPTION_TO_SIGN:      "bg-emerald-100 text-emerald-700",
  PRESCRIPTION_TO_DISPENSE:  "bg-cyan-100 text-cyan-700",
  TRIAGE_IN_PROGRESS:        "bg-red-100 text-red-700",
  LAB_TO_PROCESS:            "bg-purple-100 text-purple-700",
  LAB_TO_VALIDATE:           "bg-purple-100 text-purple-700",
  IMAGING_TO_REPORT:         "bg-indigo-100 text-indigo-700",
  IMAGING_TO_VALIDATE:       "bg-indigo-100 text-indigo-700",
  ECE_RECTIFICACION_PENDING: "bg-amber-100 text-amber-700",
  ECE_DOC_TO_CERTIFY:        "bg-amber-100 text-amber-700",
  MED_TO_ADMINISTER:         "bg-pink-100 text-pink-700",
};

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
  const [selectedTypes, setSelectedTypes] = React.useState<Set<TaskType>>(new Set());
  const [onlyOverdue, setOnlyOverdue] = React.useState(false);
  const [selectedPriority, setSelectedPriority] = React.useState<Priority | "">("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const query = trpcAny.workflowInbox.miBandeja.useQuery(
    {
      types: selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined,
      onlyOverdue,
      priority: selectedPriority || undefined,
      limit: 200,
    },
    { refetchInterval: 30_000, refetchOnWindowFocus: true },
  );

  const data = (query.data ?? null) as InboxResponse | null;

  function toggleType(t: TaskType) {
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
    setSelectedPriority("");
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
            Tareas BPM enrutadas según tus roles activos. Las acciones
            independientes siguen disponibles desde el menú lateral.
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
          {(selectedTypes.size > 0 || onlyOverdue || selectedPriority) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          )}
        </div>
      </div>

      {/* Resumen por tipo de tarea — clickable como filtro */}
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
                      selected
                        ? "border-primary bg-primary/10 font-medium"
                        : "hover:bg-accent"
                    }`}
                  >
                    <span>{c.typeLabel}</span>
                    <Badge variant="outline" className="font-mono text-xs">
                      {c.count}
                    </Badge>
                    {c.overdueCount > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
                        {c.overdueCount}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de tareas */}
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
                {selectedTypes.size > 0 || onlyOverdue || selectedPriority
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
                const iconBg = TYPE_ICON_BG[t.type];
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
                          <Badge className={`${theme.bg} ${theme.text} text-[10px]`}>
                            {theme.label}
                          </Badge>
                          {t.isOverdue && (
                            <Badge variant="destructive" className="text-[10px]">
                              SLA excedido
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {t.description}
                        </p>
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
