"use client";

/**
 * US-6.5 — Cronómetro de re-triage automático (Client Component).
 *
 * Equipo Sierra. Card-friendly, accesible, no bloquea con polling.
 *
 * Recibe:
 *  - `startedAt`: inicio del triage (Date | string | null).
 *  - `maxWaitMinutes`: techo Manchester según el nivel.
 *  - `serverNow` (opcional): timestamp del último refetch — el componente lo
 *    usa para calcular el desfase entre reloj cliente y servidor; si los
 *    relojes difieren más de 30s, el componente prefiere el server time
 *    proyectado linealmente. Esto evita falsos positivos en clientes con
 *    reloj mal puesto.
 *  - `paused` (opcional): congela el contador (útil en modales).
 *  - `onSeverityChange` (opcional): callback cuando cruza warning/critical
 *    (lo usa el TriageCard para disparar el beep).
 *
 * Renderiza:
 *  - mm:ss restante en verde (<70%), amarillo (70-100%) o rojo (>100%).
 *  - Si overdue, prefijo "+" y `animate-critical-pulse`.
 *  - aria-live="polite" + aria-atomic="true" para lectores de pantalla.
 *  - Texto sr-only que describe el estado en español ("Tiempo excedido en
 *    1 minuto 23 segundos") — clave para accesibilidad de personal con
 *    discapacidad visual y trabajadores sordos que dependen de captions.
 */
import * as React from "react";

export type TriageTimerSeverity = "NORMAL" | "WARNING" | "CRITICAL";

interface TriageTimerProps {
  startedAt: Date | string;
  maxWaitMinutes: number;
  /** Timestamp devuelto por la query — para corregir desfases de reloj. */
  serverNow?: Date | string | null;
  paused?: boolean;
  className?: string;
  /** Notifica al padre cuando cambia la severidad (NORMAL → WARNING → CRITICAL). */
  onSeverityChange?: (s: TriageTimerSeverity) => void;
}

function severityFor(elapsedMin: number, maxMin: number): TriageTimerSeverity {
  if (maxMin <= 0) return "NORMAL";
  const pct = elapsedMin / maxMin;
  if (pct > 1) return "CRITICAL";
  if (pct > 0.7) return "WARNING";
  return "NORMAL";
}

function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** Texto humano para sr-only — no se acorta para favorecer claridad. */
function describeStatus(elapsedMs: number, maxMs: number): string {
  if (elapsedMs <= maxMs) {
    const remain = Math.max(0, maxMs - elapsedMs);
    const min = Math.floor(remain / 60_000);
    const sec = Math.floor((remain % 60_000) / 1000);
    return `Tiempo restante: ${min} minutos ${sec} segundos.`;
  }
  const over = elapsedMs - maxMs;
  const min = Math.floor(over / 60_000);
  const sec = Math.floor((over % 60_000) / 1000);
  return `Tiempo de espera excedido en ${min} minutos ${sec} segundos. Re-triage requerido.`;
}

export function TriageTimer({
  startedAt,
  maxWaitMinutes,
  serverNow,
  paused = false,
  className,
  onSeverityChange,
}: TriageTimerProps) {
  const start = React.useMemo(() => new Date(startedAt), [startedAt]);
  const maxMs = maxWaitMinutes * 60_000;

  // Corrección de drift: si server y cliente difieren > 30s, aplicamos el
  // offset al cálculo. Re-evaluado solo cuando `serverNow` cambia (cada 10s).
  const drift = React.useMemo(() => {
    if (!serverNow) return 0;
    const sNow = new Date(serverNow).getTime();
    const cNow = Date.now();
    const d = sNow - cNow;
    return Math.abs(d) > 30_000 ? d : 0;
  }, [serverNow]);

  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);

  const elapsedMs = Math.max(0, Date.now() + drift - start.getTime());
  const remainingMs = maxMs - elapsedMs;
  const overdue = elapsedMs > maxMs;
  const elapsedMin = elapsedMs / 60_000;
  const severity = severityFor(elapsedMin, maxWaitMinutes);

  // Notifica al padre solo cuando hay cambio real de severidad.
  const lastSeverity = React.useRef<TriageTimerSeverity>(severity);
  React.useEffect(() => {
    if (lastSeverity.current !== severity) {
      lastSeverity.current = severity;
      onSeverityChange?.(severity);
    }
  }, [severity, onSeverityChange]);

  const bg =
    severity === "CRITICAL"
      ? "bg-red-100 text-red-900 border-red-400 dark:bg-red-950 dark:text-red-200"
      : severity === "WARNING"
        ? "bg-yellow-100 text-yellow-900 border-yellow-400 dark:bg-yellow-950 dark:text-yellow-200"
        : "bg-green-100 text-green-900 border-green-400 dark:bg-green-950 dark:text-green-200";

  const display = overdue ? `+${formatMmSs(elapsedMs - maxMs)}` : formatMmSs(remainingMs);
  // Suppress hydration warning porque el contenido depende de Date.now().
  // Está OK: el primer render coincide con el primer tick.
  return (
    <div
      className={[
        "inline-flex flex-col items-center justify-center rounded-md border px-3 py-2 font-mono tabular-nums",
        bg,
        overdue ? "animate-critical-pulse" : "",
        className ?? "",
      ].join(" ")}
      role="timer"
      aria-live={severity === "CRITICAL" ? "assertive" : "polite"}
      aria-atomic="true"
      data-severity={severity}
      data-overdue={overdue}
    >
      <span className="text-2xl font-bold leading-none" suppressHydrationWarning>
        {display}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-wide opacity-75">
        {overdue ? "EXCEDIDO" : "restante"}
      </span>
      <span className="sr-only" suppressHydrationWarning>
        {describeStatus(elapsedMs, maxMs)}
      </span>
    </div>
  );
}
