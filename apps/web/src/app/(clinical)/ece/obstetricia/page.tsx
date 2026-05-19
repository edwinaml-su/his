"use client";

/**
 * ECE — Dashboard Maternidad (NTEC Art. 25)
 *
 * Vista operacional para jefe de servicio de maternidad.
 *
 * Secciones:
 *   - KPIs: partos hoy / pendientes / cesáreas / fallecidos maternos
 *   - Mosaico de salas: pre-parto / expulsión / post-parto
 *   - Panel de alertas clínicas: partograma + alumbramiento + HPP
 *   - Cola de episodios en labor activa
 *
 * Auto-refresh cada 30 s via refetchInterval (reemplaza setInterval manual).
 *
 * Accesibilidad (WCAG 2.2 AA):
 *   - h1 único, h2 por sección
 *   - role="status" en KPIs y alertas para lectores de pantalla
 *   - Colores nunca como único indicador (texto + ícono siempre)
 *   - aria-label descriptivo en cada card de sala
 *   - Focus ring visible en elementos interactivos
 */

import * as React from "react";
import {
  Baby,
  Bed,
  BedDouble,
  AlertTriangle,
  Clock,
  Droplets,
  Users,
  type LucideProps,
} from "lucide-react";
import { Badge } from "@his/ui/components/badge";
import { cn } from "@his/ui/lib/utils";
import { trpc } from "@/lib/trpc/react";

// ─── Constantes ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 30_000;

// ─── Tipos locales (espejo de los tipos del router para evitar import deep) ───

interface Sala {
  id: string;
  codigo: string;
  tipo: string;
  estado: string;
  paciente_nombre: string | null;
  minutos_en_sala: number | null;
  dilatacion_cm: number | null;
}

interface Alerta {
  id: string;
  tipo: string;
  paciente_nombre: string;
  sala_codigo: string;
  minutos_transcurridos: number;
  mensaje: string;
}

interface PacienteEsperada {
  id: string;
  paciente_nombre: string;
  semanas_gestacion: number | null;
  hora_ingreso: string;
  motivo: string | null;
}

interface Kpis {
  partos_hoy: number;
  partos_pendientes: number;
  cesareas_hoy: number;
  fallecidos_maternos_hoy: number;
}

// ─── Sub-componentes ───────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number;
  icon: React.ComponentType<Omit<LucideProps, "ref">>;
  colorClass: string;
}

function KpiCard({ label, value, icon: Icon, colorClass }: KpiCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-lg border bg-card p-4 shadow-sm",
        colorClass,
      )}
    >
      <div className="rounded-md bg-background/60 p-2.5">
        <Icon className="h-6 w-6 text-foreground" aria-hidden />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none tabular-nums text-foreground">
          {value}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function formatMinutos(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const TIPO_LABEL: Record<string, string> = {
  "pre-parto": "Pre-parto",
  expulsion: "Expulsión",
  "post-parto": "Post-parto",
};

const ESTADO_BADGE: Record<string, { text: string; className: string }> = {
  libre: {
    text: "Libre",
    className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  },
  ocupada: {
    text: "Ocupada",
    className: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  },
  limpieza: {
    text: "En limpieza",
    className: "bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100",
  },
};

function SalaCard({ sala }: { sala: Sala }) {
  // ESTADO_BADGE cubre los estados conocidos; fallback a libre para desconocidos
  const badge = ESTADO_BADGE[sala.estado] ?? ESTADO_BADGE.libre!;
  const tipoLabel = TIPO_LABEL[sala.tipo] ?? sala.tipo;
  const ariaLabel = sala.paciente_nombre
    ? `${tipoLabel} ${sala.codigo} — ${sala.paciente_nombre} — ${badge.text}`
    : `${tipoLabel} ${sala.codigo} — Libre`;

  return (
    <article
      aria-label={ariaLabel}
      className="rounded-lg border bg-card p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {tipoLabel}
        </span>
        <span className="font-mono text-sm font-medium">{sala.codigo}</span>
      </div>

      <Badge className={cn("text-xs", badge.className)}>{badge.text}</Badge>

      {sala.paciente_nombre && (
        <div className="mt-2 space-y-1 text-sm">
          <p className="font-medium truncate">{sala.paciente_nombre}</p>
          {sala.minutos_en_sala !== null && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" aria-hidden />
              <span>En sala: {formatMinutos(sala.minutos_en_sala)}</span>
            </p>
          )}
          {sala.dilatacion_cm !== null && (
            <p className="text-xs text-muted-foreground">
              Dilatación: <span className="font-semibold">{sala.dilatacion_cm} cm</span>
            </p>
          )}
        </div>
      )}

      {!sala.paciente_nombre && (
        <p className="mt-2 text-xs text-muted-foreground">Sin paciente asignada</p>
      )}
    </article>
  );
}

const ALERTA_CONFIG: Record<string, { label: string; className: string; iconClass: string }> = {
  "ece.partograma.alerta": {
    label: "Partograma — Dilatación lenta",
    className: "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/40",
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  "ece.alumbramiento.tardio": {
    label: "Alumbramiento > 30 min",
    className: "border-orange-400 bg-orange-50 dark:border-orange-600 dark:bg-orange-950/40",
    iconClass: "text-orange-600 dark:text-orange-400",
  },
  "ece.hemorragia.postparto.sospecha": {
    label: "Hemorragia post-parto",
    className: "border-red-500 bg-red-50 dark:border-red-700 dark:bg-red-950/40",
    iconClass: "text-red-600 dark:text-red-400",
  },
  "ece.hpp.activo": {
    label: "HPP activo",
    className: "border-red-600 bg-red-100 dark:border-red-800 dark:bg-red-950/60",
    iconClass: "text-red-700 dark:text-red-300",
  },
  "ece.distocia.detectada": {
    label: "Distocia detectada",
    className: "border-rose-400 bg-rose-50 dark:border-rose-600 dark:bg-rose-950/40",
    iconClass: "text-rose-600 dark:text-rose-400",
  },
};

const ALERTA_DEFAULT_CFG = {
  label: "Alerta clínica",
  className: "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/40",
  iconClass: "text-amber-600 dark:text-amber-400",
};

function AlertaCard({ alerta }: { alerta: Alerta }) {
  const cfg = ALERTA_CONFIG[alerta.tipo] ?? ALERTA_DEFAULT_CFG;
  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border-l-4 p-3",
        cfg.className,
      )}
    >
      <AlertTriangle
        className={cn("mt-0.5 h-4 w-4 shrink-0", cfg.iconClass)}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
          {cfg.label}
        </p>
        <p className="mt-0.5 truncate text-sm font-medium">
          {alerta.paciente_nombre}{alerta.sala_codigo ? ` — Sala ${alerta.sala_codigo}` : ""}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{alerta.mensaje}</p>
        <p className="mt-1 text-xs font-medium text-foreground/60">
          Tiempo transcurrido: {formatMinutos(alerta.minutos_transcurridos)}
        </p>
      </div>
    </li>
  );
}

// ─── Sección mosaico de salas ──────────────────────────────────────────────────

const GRUPOS: { tipo: string; label: string }[] = [
  { tipo: "pre-parto", label: "Pre-parto" },
  { tipo: "expulsion", label: "Expulsión" },
  { tipo: "post-parto", label: "Post-parto" },
];

function MosaicoSalas({ salas }: { salas: Sala[] }) {
  return (
    <div className="space-y-4">
      {GRUPOS.map(({ tipo, label }) => {
        const salasTipo = salas.filter((s) => s.tipo === tipo);
        if (salasTipo.length === 0) return null;
        return (
          <div key={tipo}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{label}</h3>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))" }}
            >
              {salasTipo.map((sala) => (
                <SalaCard key={sala.id} sala={sala} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Estado de carga / error ──────────────────────────────────────────────────

function LoadingPlaceholder({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={`Cargando ${label}`}
      className="animate-pulse rounded-lg border bg-muted/20 p-4 text-xs text-muted-foreground"
    >
      Cargando {label}…
    </div>
  );
}

// ─── Page principal ────────────────────────────────────────────────────────────

export default function MaternidadDashboardPage() {
  const { data: kpis, isLoading: kpisLoading } =
    trpc.eceObstetricia.kpis.useQuery(undefined, { refetchInterval: REFRESH_INTERVAL_MS });

  const { data: salas = [], isLoading: salasLoading } =
    trpc.eceObstetricia.salas.useQuery(undefined, { refetchInterval: REFRESH_INTERVAL_MS });

  const { data: alertas = [], isLoading: alertasLoading } =
    trpc.eceObstetricia.alertas.useQuery(undefined, { refetchInterval: REFRESH_INTERVAL_MS });

  const { data: cola = [], isLoading: colaLoading } =
    trpc.eceObstetricia.cola.useQuery(undefined, { refetchInterval: REFRESH_INTERVAL_MS });

  const kpiData: Kpis = kpis ?? {
    partos_hoy: 0,
    partos_pendientes: 0,
    cesareas_hoy: 0,
    fallecidos_maternos_hoy: 0,
  };

  const hppActivo = (alertas as Alerta[]).some(
    (a: Alerta) => a.tipo === "ece.hpp.activo" || a.tipo === "ece.hemorragia.postparto.sospecha",
  );

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          Dashboard — Maternidad
        </h1>
        <p className="text-sm text-muted-foreground">
          Visión operacional jefe de servicio · Actualización cada 30 s
        </p>
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="kpis-heading">
        <h2 id="kpis-heading" className="sr-only">
          Indicadores clave
        </h2>
        {kpisLoading ? (
          <LoadingPlaceholder label="indicadores" />
        ) : (
          <div
            role="status"
            aria-label="Indicadores operacionales de maternidad"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            <KpiCard
              label="Partos hoy"
              value={kpiData.partos_hoy}
              icon={Baby}
              colorClass="border-emerald-200 dark:border-emerald-800"
            />
            <KpiCard
              label="En labor activa"
              value={kpiData.partos_pendientes}
              icon={Users}
              colorClass="border-blue-200 dark:border-blue-800"
            />
            <KpiCard
              label="Cesáreas hoy"
              value={kpiData.cesareas_hoy}
              icon={BedDouble}
              colorClass="border-rose-200 dark:border-rose-800"
            />
            <KpiCard
              label="Fallecidos maternos"
              value={kpiData.fallecidos_maternos_hoy}
              icon={Bed}
              colorClass="border-amber-200 dark:border-amber-800"
            />
          </div>
        )}
      </section>

      {/* ── Mosaico de salas + alertas (2 columnas en lg) ─────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Mosaico ocupa 2/3 */}
        <section className="lg:col-span-2" aria-labelledby="salas-heading">
          <h2
            id="salas-heading"
            className="mb-3 text-base font-semibold text-foreground"
          >
            Salas — estado actual
          </h2>
          {salasLoading ? (
            <LoadingPlaceholder label="salas" />
          ) : salas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin salas activas.</p>
          ) : (
            <MosaicoSalas salas={salas} />
          )}
        </section>

        {/* Alertas ocupa 1/3 */}
        <section aria-labelledby="alertas-heading">
          <h2
            id="alertas-heading"
            className="mb-3 flex items-center gap-2 text-base font-semibold text-foreground"
          >
            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
            Alertas clínicas
          </h2>

          {alertasLoading ? (
            <LoadingPlaceholder label="alertas" />
          ) : alertas.length === 0 ? (
            <div
              role="status"
              aria-label="Sin alertas clínicas activas"
              className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground"
            >
              Sin alertas activas
            </div>
          ) : (
            <ul
              role="status"
              aria-label={`${alertas.length} alerta${alertas.length !== 1 ? "s" : ""} clínica${alertas.length !== 1 ? "s" : ""} activa${alertas.length !== 1 ? "s" : ""}`}
              aria-live="polite"
              className="space-y-3"
            >
              {(alertas as Alerta[]).map((alerta: Alerta) => (
                <AlertaCard key={alerta.id} alerta={alerta} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── Cola de episodios en labor ─────────────────────────────────────── */}
      <section aria-labelledby="cola-heading">
        <h2
          id="cola-heading"
          className="mb-3 text-base font-semibold text-foreground"
        >
          Episodios en labor activa
        </h2>

        {colaLoading ? (
          <LoadingPlaceholder label="cola" />
        ) : cola.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay episodios activos en labor.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Paciente
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Semanas
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Hora ingreso
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Motivo
                  </th>
                </tr>
              </thead>
              <tbody>
                {(cola as PacienteEsperada[]).map((p: PacienteEsperada, idx: number) => (
                  <tr
                    key={p.id}
                    className={cn(
                      "border-b last:border-b-0 transition-colors hover:bg-muted/30",
                      idx % 2 === 1 && "bg-muted/10",
                    )}
                  >
                    <td className="px-4 py-2.5 font-medium">{p.paciente_nombre}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {p.semanas_gestacion !== null ? `${p.semanas_gestacion} sem` : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums">{p.hora_ingreso}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.motivo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Protocolo HPP — visible solo cuando hay alerta activa o siempre como referencia */}
      <section
        aria-labelledby="hpp-heading"
        className={cn(
          "rounded-lg border p-4",
          hppActivo
            ? "border-red-500 bg-red-100 dark:border-red-700 dark:bg-red-950/60"
            : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
        )}
      >
        <h2
          id="hpp-heading"
          className={cn(
            "flex items-center gap-2 text-sm font-semibold",
            hppActivo
              ? "text-red-800 dark:text-red-200"
              : "text-red-700 dark:text-red-400",
          )}
        >
          <Droplets className="h-4 w-4" aria-hidden />
          Protocolo hemorragia post-parto
          {hppActivo && (
            <span className="ml-auto rounded bg-red-600 px-2 py-0.5 text-xs text-white">
              ACTIVO
            </span>
          )}
        </h2>
        <p className="mt-1 text-xs text-red-600 dark:text-red-300">
          {hppActivo
            ? "Alerta HPP activa — revisar panel de alertas y activar código rojo si corresponde."
            : "Sin casos activos reportados. Ante sospecha activa el código rojo desde sala de expulsión."}
        </p>
      </section>
    </div>
  );
}
