"use client";

/**
 * Bedside Administration Wizard — placeholder F2-S7 Wave 1.
 *
 * El wizard 3-step completo requiere sub-routers `validate5Correct`,
 * `administration` y `shiftQueue` que no están implementados en
 * `bedside.router`. Implementar en F2-S7 Wave 2 con el agente Stream 11
 * + nuevos endpoints en el router.
 *
 * Por ahora: link directo al validador 5 Correctos disponible y aviso.
 */
export function AdministrationWizard({
  patientId,
  indicationId,
}: {
  patientId: string;
  indicationId: string;
}) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
      <p className="font-semibold">Bedside Wizard (Placeholder)</p>
      <p className="mt-2">
        El wizard 3-step PWA está en consolidación. Por ahora use el validador
        5 Correctos vía API <code>bedside.validate5Correctos</code>.
      </p>
      <p className="mt-2 text-xs text-amber-700">
        Paciente: {patientId} — Indicación: {indicationId}
      </p>
    </div>
  );
}
