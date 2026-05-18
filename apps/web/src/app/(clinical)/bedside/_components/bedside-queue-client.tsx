"use client";

/**
 * Bedside Queue Client — placeholder F2-S7 Wave 1.
 *
 * Requiere sub-router `bedside.shiftQueue.pending` no implementado en
 * `bedside.router`. Implementar en Wave 2.
 */
export function BedsideQueueClient() {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
      <p className="font-semibold">Cola Bedside (Placeholder)</p>
      <p className="mt-2">
        La cola de turno de enfermería está en consolidación.
      </p>
    </div>
  );
}
