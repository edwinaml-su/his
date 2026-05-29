import * as React from "react";
import { TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { cn } from "../lib/utils";

export interface SparklineProps {
  /** Serie de valores. Ej: signos vitales últimas 24h cada hora. */
  values: number[];
  /** Etiqueta accesible. Ej: "Presión sistólica últimas 24 horas". */
  ariaLabel: string;
  /** Color semántico. */
  severity?: "normal" | "warning" | "critical";
  /** Mostrar flecha de tendencia al final de la serie. */
  showTrend?: boolean;
  /** Ancho px (default 80). */
  width?: number;
  /** Alto px (default 24). */
  height?: number;
  /** Etiqueta del valor actual a la derecha. */
  valueLabel?: string;
  /** Unidad. Ej: "mmHg", "bpm". */
  unit?: string;
  className?: string;
}

/** Calcula slope de los últimos 3 puntos: positivo = sube, negativo = baja. */
function calcSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const tail = values.slice(-3);
  const first = tail[0] ?? 0;
  const last = tail[tail.length - 1] ?? 0;
  return last - first;
}

/** Normaliza una serie de valores al rango [padding, height-padding]. */
function normalizePoints(
  values: number[],
  width: number,
  height: number,
  padding = 2,
): string {
  if (values.length === 0) return "";
  if (values.length === 1) {
    const y = height / 2;
    return `0,${y} ${width},${y}`;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // evitar división por cero
  const usableH = height - padding * 2;
  const stepX = width / (values.length - 1);

  return values
    .map((v, i) => {
      const x = i * stepX;
      // Invertir Y: valor alto → posición arriba (Y pequeño)
      const y = padding + usableH - ((v - min) / range) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const STROKE_BY_SEVERITY = {
  normal: "stroke-muted-foreground",
  warning: "stroke-warning",
  critical: "stroke-destructive",
} satisfies Record<NonNullable<SparklineProps["severity"]>, string>;

/**
 * Gráfica sparkline SVG inline — server-friendly (sin hooks).
 * Cumple §3 rediseño v2.0: color + texto + ícono para warning/critical.
 * Sin animaciones (prefers-reduced-motion respetado por omisión).
 */
export function Sparkline({
  values,
  ariaLabel,
  severity = "normal",
  showTrend = false,
  width = 80,
  height = 24,
  valueLabel,
  unit,
  className,
}: SparklineProps) {
  const points = normalizePoints(values, width, height);
  const slope = showTrend ? calcSlope(values) : 0;
  const hasSeverityIndicator = severity === "warning" || severity === "critical";

  const TrendIcon =
    slope > 0 ? TrendingUp : slope < 0 ? TrendingDown : AlertCircle;

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      // No es interactivo; aria-label está en el SVG
    >
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        // prefers-reduced-motion respetado: no hay animaciones que desactivar
      >
        {points && (
          <polyline
            points={points}
            className={cn("fill-none", STROKE_BY_SEVERITY[severity])}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {values.length === 0 && (
          <line
            x1={0}
            y1={height / 2}
            x2={width}
            y2={height / 2}
            className="stroke-muted-foreground/30"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {/* Valor actual + unidad */}
      {valueLabel !== undefined && (
        <span
          className={cn(
            "tabular-nums text-[10px] leading-none",
            severity === "critical" && "font-semibold text-destructive",
            severity === "warning" && "font-semibold text-warning",
            severity === "normal" && "text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {valueLabel}
          {unit && <span className="ml-px opacity-70">{unit}</span>}
        </span>
      )}

      {/* Ícono de tendencia/severidad — solo para warning y critical */}
      {hasSeverityIndicator && (
        <TrendIcon
          className={cn(
            "h-3 w-3 shrink-0",
            severity === "critical" && "text-destructive",
            severity === "warning" && "text-warning",
          )}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
