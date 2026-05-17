"use client";

/**
 * ECE — Dashboard Maternidad (TDR §ECE Obstetricia)
 *
 * Vista operacional para jefe de servicio de maternidad.
 *
 * Secciones:
 *   - KPIs: trabajo de parto activo / salas expulsión ocupadas /
 *           nacimientos del día / RN en UCIN
 *   - Mosaico de salas: pre-parto / expulsión / post-parto
 *   - Panel de alertas clínicas: partograma + alumbramiento + hemorragia
 *   - Cola de próximas pacientes esperadas
 *
 * Auto-refresh cada 30 s (refetchInterval en cada query).
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

// ─── Constantes ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 30_000;

// ─── Tipos de dominio ──────────────────────────────────────────────────────────

type EstadoSala = "libre" | "pre-parto" | "expulsion" | "post-parto";

interface SalaMock {
  id: string;
  codigo: string;
  tipo: "pre-parto" | "expulsion" | "post-parto";
  estado: EstadoSala;
  pacienteNombre: string | null;
  /** Minutos desde que la paciente ingresó a esta sala */
  minutosEnSala: number | null;
  /** Dilatación en cm (solo pre-parto/expulsión) */
  dilatacionCm: number | null;
}

interface AlertaClinica {
  id: string;
  tipo: "partograma-lento" | "alumbramiento-tardio" | "hemorragia-postparto";
  pacienteNombre: string;
  salaId: string;
  salaCodigo: string;
  minutosTranscurridos: number;
  mensaje: string;
}

interface PacienteEsperada {
  id: string;
  nombre: string;
  semanas: number;
  horaEstimadaIngreso: string;
  motivo: string;
}

interface KpiData {
  trabajoParto: number;
  salasExpulsionOcupadas: number;
  nacimientosHoy: number;
  rnUcin: number;
}

// ─── Datos mock (reemplazar con tRPC cuando router esté disponible) ────────────
// TODO: reemplazar por trpc.eceObstetricia.kpis / salas / alertas / cola

function useMockKpis(): { data: KpiData } {
  const [data] = React.useState<KpiData>({
    trabajoParto: 4,
    salasExpulsionOcupadas: 2,
    nacimientosHoy: 7,
    rnUcin: 1,
  });
  return { data };
}

const SALAS_MOCK: SalaMock[] = [
  {
    id: "s1", codigo: "PP-01", tipo: "pre-parto", estado: "pre-parto",
    pacienteNombre: "García, M.", minutosEnSala: 95, dilatacionCm: 6,
  },
  {
    id: "s2", codigo: "PP-02", tipo: "pre-parto", estado: "pre-parto",
    pacienteNombre: "López, R.", minutosEnSala: 200, dilatacionCm: 4,
  },
  {
    id: "s3", codigo: "PP-03", tipo: "pre-parto", estado: "libre",
    pacienteNombre: null, minutosEnSala: null, dilatacionCm: null,
  },
  {
    id: "s4", codigo: "EX-01", tipo: "expulsion", estado: "expulsion",
    pacienteNombre: "Martínez, K.", minutosEnSala: 18, dilatacionCm: 10,
  },
  {
    id: "s5", codigo: "EX-02", tipo: "expulsion", estado: "expulsion",
    pacienteNombre: "Pérez, L.", minutosEnSala: 25, dilatacionCm: 10,
  },
  {
    id: "s6", codigo: "EX-03", tipo: "expulsion", estado: "libre",
    pacienteNombre: null, minutosEnSala: null, dilatacionCm: null,
  },
  {
    id: "s7", codigo: "PO-01", tipo: "post-parto", estado: "post-parto",
    pacienteNombre: "Hernández, V.", minutosEnSala: 120, dilatacionCm: null,
  },
  {
    id: "s8", codigo: "PO-02", tipo: "post-parto", estado: "post-parto",
    pacienteNombre: "Ramos, S.", minutosEnSala: 45, dilatacionCm: null,
  },
  {
    id: "s9", codigo: "PO-03", tipo: "post-parto", estado: "libre",
    pacienteNombre: null, minutosEnSala: null, dilatacionCm: null,
  },
];

const ALERTAS_MOCK: AlertaClinica[] = [
  {
    id: "a1",
    tipo: "partograma-lento",
    pacienteNombre: "López, R.",
    salaId: "s2",
    salaCodigo: "PP-02",
    minutosTranscurridos: 200,
    mensaje: "Dilatación 4 cm — progresión por debajo de la curva de alerta (≤0.5 cm/h por >2 h)",
  },
  {
    id: "a2",
    tipo: "alumbramiento-tardio",
    pacienteNombre: "Martínez, K.",
    salaId: "s4",
    salaCodigo: "EX-01",
    minutosTranscurridos: 38,
    mensaje: "Alumbramiento sin completar a los 38 min del nacimiento (límite: 30 min)",
  },
];

const COLA_MOCK: PacienteEsperada[] = [
  {
    id: "c1", nombre: "Flores, A.", semanas: 39, horaEstimadaIngreso: "14:30", motivo: "Trabajo de parto",
  },
  {
    id: "c2", nombre: "Torres, M.", semanas: 37, horaEstimadaIngreso: "15:00", motivo: "Inducción programada",
  },
  {
    id: "c3", nombre: "Reyes, J.", semanas: 40, horaEstimadaIngreso: "16:15", motivo: "Trabajo de parto",
  },
];

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
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const TIPO_LABEL: Record<SalaMock["tipo"], string> = {
  "pre-parto": "Pre-parto",
  expulsion: "Expulsión",
  "post-parto": "Post-parto",
};

const ESTADO_BADGE: Record<
  EstadoSala,
  { text: string; className: string }
> = {
  libre: {
    text: "Libre",
    className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  },
  "pre-parto": {
    text: "En trabajo de parto",
    className: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  },
  expulsion: {
    text: "En expulsión",
    className: "bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100",
  },
  "post-parto": {
    text: "Post-parto",
    className: "bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100",
  },
};

function SalaCard({ sala }: { sala: SalaMock }) {
  const badge = ESTADO_BADGE[sala.estado];
  const ariaLabel = sala.pacienteNombre
    ? `${TIPO_LABEL[sala.tipo]} ${sala.codigo} — ${sala.pacienteNombre} — ${badge.text}`
    : `${TIPO_LABEL[sala.tipo]} ${sala.codigo} — Libre`;

  return (
    <article
      aria-label={ariaLabel}
      className="rounded-lg border bg-card p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {TIPO_LABEL[sala.tipo]}
        </span>
        <span className="font-mono text-sm font-medium">{sala.codigo}</span>
      </div>

      <Badge className={cn("text-xs", badge.className)}>{badge.text}</Badge>

      {sala.pacienteNombre && (
        <div className="mt-2 space-y-1 text-sm">
          <p className="font-medium truncate">{sala.pacienteNombre}</p>
          {sala.minutosEnSala !== null && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" aria-hidden />
              <span>En sala: {formatMinutos(sala.minutosEnSala)}</span>
            </p>
          )}
          {sala.dilatacionCm !== null && (
            <p className="text-xs text-muted-foreground">
              Dilatación: <span className="font-semibold">{sala.dilatacionCm} cm</span>
            </p>
          )}
        </div>
      )}

      {!sala.pacienteNombre && (
        <p className="mt-2 text-xs text-muted-foreground">Sin paciente asignada</p>
      )}
    </article>
  );
}

const ALERTA_CONFIG: Record<
  AlertaClinica["tipo"],
  { label: string; className: string; iconClass: string }
> = {
  "partograma-lento": {
    label: "Partograma — Dilatación lenta",
    className: "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/40",
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  "alumbramiento-tardio": {
    label: "Alumbramiento > 30 min",
    className: "border-orange-400 bg-orange-50 dark:border-orange-600 dark:bg-orange-950/40",
    iconClass: "text-orange-600 dark:text-orange-400",
  },
  "hemorragia-postparto": {
    label: "Hemorragia post-parto",
    className: "border-red-500 bg-red-50 dark:border-red-700 dark:bg-red-950/40",
    iconClass: "text-red-600 dark:text-red-400",
  },
};

function AlertaCard({ alerta }: { alerta: AlertaClinica }) {
  const cfg = ALERTA_CONFIG[alerta.tipo];
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
          {alerta.pacienteNombre} — Sala {alerta.salaCodigo}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{alerta.mensaje}</p>
        <p className="mt-1 text-xs font-medium text-foreground/60">
          Tiempo transcurrido: {formatMinutos(alerta.minutosTranscurridos)}
        </p>
      </div>
    </li>
  );
}

// ─── Sección mosaico de salas ──────────────────────────────────────────────────

const GRUPOS: { tipo: SalaMock["tipo"]; label: string }[] = [
  { tipo: "pre-parto", label: "Pre-parto" },
  { tipo: "expulsion", label: "Expulsión" },
  { tipo: "post-parto", label: "Post-parto" },
];

function MosaicoSalas({ salas }: { salas: SalaMock[] }) {
  return (
    <div className="space-y-4">
      {GRUPOS.map(({ tipo, label }) => {
        const salasTipo = salas.filter((s) => s.tipo === tipo);
        return (
          <div key={tipo}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{label}</h3>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))",
              }}
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

// ─── Page principal ────────────────────────────────────────────────────────────

export default function MaternidadDashboardPage() {
  // Auto-refresh: el intervalo simula refetchInterval cuando tRPC esté cableado.
  // Con datos mock usamos un contador que fuerza re-render cada 30 s
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Suprime warning de "tick no usado" — fuerza re-render intencionalmente
  void tick;

  const { data: kpis } = useMockKpis();
  const salas: SalaMock[] = SALAS_MOCK;
  const alertas: AlertaClinica[] = ALERTAS_MOCK;
  const cola: PacienteEsperada[] = COLA_MOCK;

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
        <div
          role="status"
          aria-label="Indicadores operacionales de maternidad"
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <KpiCard
            label="En trabajo de parto"
            value={kpis.trabajoParto}
            icon={Users}
            colorClass="border-blue-200 dark:border-blue-800"
          />
          <KpiCard
            label="Salas expulsión ocupadas"
            value={kpis.salasExpulsionOcupadas}
            icon={BedDouble}
            colorClass="border-rose-200 dark:border-rose-800"
          />
          <KpiCard
            label="Nacimientos hoy"
            value={kpis.nacimientosHoy}
            icon={Baby}
            colorClass="border-emerald-200 dark:border-emerald-800"
          />
          <KpiCard
            label="RN en UCIN"
            value={kpis.rnUcin}
            icon={Bed}
            colorClass="border-amber-200 dark:border-amber-800"
          />
        </div>
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
          <MosaicoSalas salas={salas} />
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

          {alertas.length === 0 ? (
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
              {alertas.map((alerta) => (
                <AlertaCard key={alerta.id} alerta={alerta} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── Cola de próximas pacientes ─────────────────────────────────────── */}
      <section aria-labelledby="cola-heading">
        <h2
          id="cola-heading"
          className="mb-3 text-base font-semibold text-foreground"
        >
          Próximas pacientes esperadas
        </h2>

        {cola.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay pacientes en cola.
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
                    Hora est.
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
                {cola.map((p, idx) => (
                  <tr
                    key={p.id}
                    className={cn(
                      "border-b last:border-b-0 transition-colors hover:bg-muted/30",
                      idx % 2 === 1 && "bg-muted/10",
                    )}
                  >
                    <td className="px-4 py-2.5 font-medium">{p.nombre}</td>
                    <td className="px-4 py-2.5 tabular-nums">{p.semanas} sem</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums">{p.horaEstimadaIngreso}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Indicador de hemorragia post-parto — simulado aparte como señal crítica */}
      <section aria-labelledby="hpp-heading" className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
        <h2
          id="hpp-heading"
          className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400"
        >
          <Droplets className="h-4 w-4" aria-hidden />
          Protocolo hemorragia post-parto
        </h2>
        <p className="mt-1 text-xs text-red-600 dark:text-red-300">
          Sin casos activos reportados. Ante sospecha activa el código rojo desde sala de expulsión.
        </p>
      </section>
    </div>
  );
}
