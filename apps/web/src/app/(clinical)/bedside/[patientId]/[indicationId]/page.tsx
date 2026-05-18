/**
 * /bedside/[patientId]/[indicationId] — Wizard de administración bedside 3-step.
 *
 * Flujo GS1 Proceso E (US.F2.6.23-26):
 *   Step 1: Scan pulsera paciente (GSRN)
 *   Step 2: Scan badge enfermera (GSRN)
 *   Step 3: Scan medicamento (DataMatrix GTIN)
 *
 * Al completar los 3 scans: llama bedside.validate5Correct (Stream 10).
 * Si OK → pantalla verde + bedside.administration.record (Stream 12 eMAR).
 * Si HARD_STOP → modal full-screen rojo con razón + botón Cancelar.
 *
 * DoD §4.2 anti-manual-entry: ScanStep rechaza tipeo humano.
 */

import { redirect } from "next/navigation";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";
import { AdministrationWizard } from "../../_components/administration-wizard";

interface PageProps {
  params: Promise<{ patientId: string; indicationId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { indicationId } = await params;
  return {
    title: `Administración bedside — ${indicationId.slice(0, 8)} | AVANTE HIS`,
  };
}

export default async function AdministrationPage({ params }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tenant = await getTenantContext();
  if (!tenant) redirect("/login");

  const { patientId, indicationId } = await params;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <a
          href="/bedside"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          aria-label="Volver a la cola de turno"
        >
          <ChevronLeftIcon />
          Volver a la cola
        </a>
        <h1 className="text-2xl font-bold text-gray-900">Administración Bedside</h1>
        <p className="mt-1 text-sm text-gray-500">
          Flujo GS1 — Regla de los 5 Correctos
        </p>
      </div>

      {/* Wizard */}
      <AdministrationWizard
        patientId={patientId}
        indicationId={indicationId}
      />
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}
