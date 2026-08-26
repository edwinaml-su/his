/**
 * CC-0026 D3 — Etiqueta de vencimiento para una CareTask en el tablero.
 * Extraído de `[unidad]/page.tsx` para poder testearlo sin montar React
 * (lección Wave 6: componentes con lógica sin test rompen el coverage
 * threshold global).
 */
export interface DueLabelTask {
  dueAt: Date | string | null;
  status: string;
}

export interface DueLabelResult {
  text: string;
  /** true solo si sigue PENDIENTE y ya pasó `dueAt` — dispara el estilo rojo. */
  overdue: boolean;
}

/** "Vence en Xm" / "Venció hace Xm" — solo "vencida" (rojo) si sigue PENDIENTE. */
export function dueLabel(task: DueLabelTask, now: number = Date.now()): DueLabelResult | null {
  if (!task.dueAt) return null;
  const diffMs = new Date(task.dueAt).getTime() - now;
  const overdue = diffMs < 0 && task.status === "PENDIENTE";
  const minutes = Math.max(0, Math.round(Math.abs(diffMs) / 60_000));
  return {
    text: diffMs < 0 ? `Venció hace ${minutes} min` : `Vence en ${minutes} min`,
    overdue,
  };
}
