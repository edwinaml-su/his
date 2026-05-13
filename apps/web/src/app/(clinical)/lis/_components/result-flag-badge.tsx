"use client";

/**
 * §17 LIS — Badge para flags de resultados de laboratorio.
 *
 * Mapeo visual estandarizado para los 6 flags clínicos definidos en el
 * schema (`resultFlagEnum` en @his/contracts/schemas/lis.ts):
 *  - NORMAL                       → verde (dentro de rango)
 *  - LOW / HIGH                   → amarillo (fuera de rango, no crítico)
 *  - CRITICAL_LOW / CRITICAL_HIGH → rojo + bold (panic value, requiere
 *                                   notificación clínica inmediata)
 *  - ABNORMAL                     → naranja (cualitativo positivo / fuera
 *                                   de patrón sin gravedad crítica)
 *
 * Se usa en `/lis/orders/[id]` y `/lis/results`. No accede a tRPC.
 */
import * as React from "react";

export type ResultFlag =
  | "NORMAL"
  | "LOW"
  | "HIGH"
  | "CRITICAL_LOW"
  | "CRITICAL_HIGH"
  | "ABNORMAL";

const FLAG_LABEL: Record<ResultFlag, string> = {
  NORMAL: "Normal",
  LOW: "Bajo",
  HIGH: "Alto",
  CRITICAL_LOW: "Crítico bajo",
  CRITICAL_HIGH: "Crítico alto",
  ABNORMAL: "Anormal",
};

const FLAG_CLASS: Record<ResultFlag, string> = {
  NORMAL: "bg-green-100 text-green-700",
  LOW: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-yellow-100 text-yellow-800",
  CRITICAL_LOW: "bg-red-100 text-red-700 font-bold",
  CRITICAL_HIGH: "bg-red-100 text-red-700 font-bold",
  ABNORMAL: "bg-orange-100 text-orange-700",
};

export interface ResultFlagBadgeProps {
  flag: ResultFlag;
  className?: string;
}

export function ResultFlagBadge({ flag, className }: ResultFlagBadgeProps): React.ReactElement {
  const cls = FLAG_CLASS[flag];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${cls}${
        className ? ` ${className}` : ""
      }`}
      aria-label={`Resultado ${FLAG_LABEL[flag]}`}
    >
      {FLAG_LABEL[flag]}
    </span>
  );
}
