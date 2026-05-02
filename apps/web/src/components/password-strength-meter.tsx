"use client";

/**
 * PasswordStrengthMeter — feedback visual de fortaleza de contraseña.
 *
 * US-2.10 — Política de contraseñas.
 *
 * Render:
 *   - Barra de progreso de 5 segmentos (índices 0..4) con colores semánticos
 *     escalando red → orange → yellow → green → emerald.
 *   - Etiqueta textual en es-SV: "Muy débil", "Débil", "Aceptable", "Fuerte",
 *     "Excelente".
 *   - Lista bullet de errores debajo (si los hay), con tono `text-destructive`.
 *
 * El componente es PURO: no llama a la Server Action ni hace fetch. El padre
 * (signup / change-password page) llama a `validatePassword` y le pasa
 * `score` + `errors` ya calculados. Esto evita doble cómputo y permite que
 * el padre debounce / throttle a su gusto.
 *
 * Accesibilidad:
 *   - `role="progressbar"` con `aria-valuemin/max/now` para que un lector de
 *     pantalla anuncie el nivel.
 *   - `aria-live="polite"` en la lista de errores para que las correcciones
 *     se anuncien sin robar foco.
 *
 * Tokens de color: usamos clases inline `bg-{color}-500` (Tailwind) en lugar
 * de tokens del design system porque hoy `@his/ui` no expone una escala
 * "strength". Cuando se añada (Sprint 2 — UIUX), se reemplazan por
 * `bg-strength-{level}` sin cambiar la API del componente.
 */

import * as React from "react";

export type PasswordStrengthMeterProps = {
  /** Score 0..4 calculado por `validatePassword` / `estimatePasswordStrength`. */
  score: 0 | 1 | 2 | 3 | 4;
  /** Lista de errores en es-SV. Vacía cuando la password cumple la política. */
  errors?: string[];
  /** Si la palabra es vacía, ocultamos el meter para no mostrar "Muy débil"
   *  cuando el usuario aún no ha tipeado nada. */
  empty?: boolean;
  /** Clases extra para el contenedor raíz. */
  className?: string;
};

const LEVEL_LABELS: readonly string[] = [
  "Muy débil",
  "Débil",
  "Aceptable",
  "Fuerte",
  "Excelente",
] as const;

/**
 * Color de relleno por nivel. Tailwind necesita ver las clases completas
 * en el código para que el compilador las incluya en el bundle, así que
 * NO podemos hacer `bg-${color}-500` dinámico. De ahí la tabla literal.
 */
const LEVEL_FILL: readonly string[] = [
  "bg-red-500",
  "bg-orange-500",
  "bg-yellow-500",
  "bg-green-500",
  "bg-emerald-500",
] as const;

/**
 * Color del texto de la etiqueta — espejo del fill, un tono más oscuro para
 * cumplir contraste WCAG AA sobre fondo claro.
 */
const LEVEL_TEXT: readonly string[] = [
  "text-red-600",
  "text-orange-600",
  "text-yellow-700",
  "text-green-700",
  "text-emerald-700",
] as const;

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function PasswordStrengthMeter({
  score,
  errors = [],
  empty = false,
  className,
}: PasswordStrengthMeterProps): React.ReactElement | null {
  if (empty) return null;

  // Defensivo: si llega un score fuera de rango, lo apretamos a [0..4].
  const clamped = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
  const label = LEVEL_LABELS[clamped];
  const fill = LEVEL_FILL[clamped];
  const textColor = LEVEL_TEXT[clamped];

  return (
    <div className={cn("space-y-2", className)} data-testid="password-strength-meter">
      {/* Barra de 5 segmentos. Cada segmento ilumina si su índice <= score. */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={clamped}
        aria-label={`Fortaleza de contraseña: ${label}`}
        className="flex gap-1"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i <= clamped ? fill : "bg-muted",
            )}
          />
        ))}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className={cn("font-medium", textColor)}>{label}</span>
      </div>

      {errors.length > 0 ? (
        <ul
          className="list-disc space-y-0.5 pl-5 text-xs text-destructive"
          aria-live="polite"
          data-testid="password-strength-errors"
        >
          {errors.map((msg, idx) => (
            <li key={`${idx}-${msg}`}>{msg}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default PasswordStrengthMeter;
