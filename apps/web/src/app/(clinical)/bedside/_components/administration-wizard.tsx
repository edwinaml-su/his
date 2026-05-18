"use client";

/**
 * AdministrationWizard — Wizard 3-step de administración bedside.
 *
 * Step 1: scan pulsera paciente (GSRN)
 * Step 2: scan badge enfermera (GSRN)
 * Step 3: scan medicamento (DataMatrix → GTIN)
 *
 * Al completar: llama validate5Correct (Stream 10). Si OK → confirma con
 * administration.record (Stream 12 eMAR). Hard-stop → modal rojo full-screen.
 *
 * Optimización viewport: flex-col en móvil, max-w-2xl centrado en tablet.
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import { ScanStep, type ScanStepStatus } from "./scan-step";
import { parseGs1String } from "@/lib/gs1/parse-ai";
import { cn } from "@his/ui/lib/utils";

interface AdministrationWizardProps {
  patientId: string;
  indicationId: string;
}

type WizardStep = 1 | 2 | 3;
type WizardState =
  | { phase: "scanning"; step: WizardStep }
  | { phase: "validating" }
  | { phase: "success"; administrationId: string | null }
  | { phase: "hardStop"; reason: string };

interface ScanData {
  patientGsrn: string;
  nurseGsrn: string;
  gtin: string;
  lot: string;
  expiry: string;
}

/** Extrae el hard-stop reason del mensaje de error tRPC. */
function extractHardStopReason(errorMessage: string): string {
  // Formato: "HARD_STOP:CODIGO" o "HARD_STOP:CODIGO:detalle"
  const match = errorMessage.match(/HARD_STOP:([^:]+)(?::(.+))?/);
  if (!match) return errorMessage;
  const code = match[1] ?? "DESCONOCIDO";
  const detail = match[2];
  const labels: Record<string, string> = {
    MEDICAMENTO_VENCIDO: "Medicamento vencido — no se puede administrar",
    PROFESIONAL_NO_HABILITADO: "Profesional no habilitado o credenciales suspendidas",
    GSRN_PACIENTE_NO_ENCONTRADO: "Pulsera GSRN no encontrada — verifique con admisión",
    LOTE_EN_RECALL: "Lote en recall activo — medicamento bloqueado",
    SIN_INDICACION_ACTIVA: "No existe indicación activa para este paciente",
    MEDICAMENTO_INCORRECTO: "Medicamento incorrecto — no coincide con la indicación",
    HORA_FUERA_DE_VENTANA: detail
      ? `Fuera de ventana terapéutica (${detail} minutos de diferencia)`
      : "Fuera de ventana terapéutica",
  };
  return labels[code] ?? `Hard Stop: ${code}`;
}

export function AdministrationWizard({
  patientId,
  indicationId,
}: AdministrationWizardProps) {
  const router = useRouter();

  const [wizardState, setWizardState] = useState<WizardState>({
    phase: "scanning",
    step: 1,
  });
  const [scans, setScans] = useState<Partial<ScanData>>({});
  const [stepStatuses, setStepStatuses] = useState<Record<WizardStep, ScanStepStatus>>({
    1: "waiting",
    2: "waiting",
    3: "waiting",
  });
  const [stepErrors, setStepErrors] = useState<Record<WizardStep, string | undefined>>({
    1: undefined,
    2: undefined,
    3: undefined,
  });

  const validate5Correct = trpc.bedside.validate5Correct.validate.useMutation();
  const recordAdministration = trpc.bedside.administration.record.useMutation();

  // Step 1: scan pulsera paciente (GSRN)
  const handlePatientScan = useCallback(
    (raw: string) => {
      // Validar formato GSRN: 18 dígitos
      const clean = raw.trim();
      if (!/^\d{18}$/.test(clean)) {
        setStepStatuses((s) => ({ ...s, 1: "error" }));
        setStepErrors((e) => ({
          ...e,
          1: `Código no válido (${clean.length} chars). Se esperaba GSRN-18 (18 dígitos).`,
        }));
        return;
      }
      setScans((s) => ({ ...s, patientGsrn: clean }));
      setStepStatuses((s) => ({ ...s, 1: "success" }));
      setWizardState({ phase: "scanning", step: 2 });
    },
    [],
  );

  // Step 2: scan badge enfermera (GSRN)
  const handleNurseScan = useCallback(
    (raw: string) => {
      const clean = raw.trim();
      if (!/^\d{18}$/.test(clean)) {
        setStepStatuses((s) => ({ ...s, 2: "error" }));
        setStepErrors((e) => ({
          ...e,
          2: `Código no válido (${clean.length} chars). Se esperaba GSRN-18 (18 dígitos).`,
        }));
        return;
      }
      setScans((s) => ({ ...s, nurseGsrn: clean }));
      setStepStatuses((s) => ({ ...s, 2: "success" }));
      setWizardState({ phase: "scanning", step: 3 });
    },
    [],
  );

  // Step 3: scan medicamento (DataMatrix GS1)
  const handleMedicationScan = useCallback(
    async (raw: string) => {
      const result = parseGs1String(raw.trim());
      if (!result.ok) {
        setStepStatuses((s) => ({ ...s, 3: "error" }));
        setStepErrors((e) => ({
          ...e,
          3: result.error.message ?? "Error al parsear DataMatrix GS1",
        }));
        return;
      }

      const { gtin, lot, expiry } = result.data;
      if (!gtin || !lot || !expiry) {
        setStepStatuses((s) => ({ ...s, 3: "error" }));
        setStepErrors((e) => ({
          ...e,
          3: "DataMatrix incompleto — se requiere GTIN (AI 01), lote (AI 10) y vencimiento (AI 17)",
        }));
        return;
      }

      const currentScans = { ...scans, gtin, lot, expiry };
      setScans(currentScans);
      setStepStatuses((s) => ({ ...s, 3: "success" }));
      setWizardState({ phase: "validating" });

      // Validar 5 correctos (Stream 10)
      try {
        await validate5Correct.mutateAsync({
          patientGsrn: currentScans.patientGsrn!,
          nurseGsrn: currentScans.nurseGsrn!,
          gtin,
          lot,
          expiry,
          indicationId,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        setWizardState({ phase: "hardStop", reason: extractHardStopReason(message) });
        return;
      }

      // Registrar administración (Stream 12 — eMAR)
      try {
        const result2 = await recordAdministration.mutateAsync({
          indicationId,
          patientGsrn: currentScans.patientGsrn!,
          nurseGsrn: currentScans.nurseGsrn!,
          gtin,
          lot,
          expiry,
          route: "IV" as const, // TODO (US.F2.6.24): selector de vía en pantalla de confirmación
        });
        setWizardState({
          phase: "success",
          administrationId: result2.administrationId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setWizardState({ phase: "hardStop", reason: extractHardStopReason(message) });
      }
    },
    [scans, indicationId, validate5Correct, recordAdministration],
  );

  // ---- Renderizado por fase ----

  if (wizardState.phase === "hardStop") {
    return (
      <HardStopScreen
        reason={wizardState.reason}
        onCancel={() => router.push("/bedside")}
        onRetry={() => {
          setWizardState({ phase: "scanning", step: 1 });
          setScans({});
          setStepStatuses({ 1: "waiting", 2: "waiting", 3: "waiting" });
          setStepErrors({ 1: undefined, 2: undefined, 3: undefined });
        }}
      />
    );
  }

  if (wizardState.phase === "success") {
    return (
      <SuccessScreen
        administrationId={wizardState.administrationId}
        onDone={() => router.push("/bedside")}
      />
    );
  }

  const currentStep = wizardState.phase === "validating" ? 3 : wizardState.step;

  return (
    <div className="space-y-4">
      {/* Barra de progreso */}
      <ProgressBar currentStep={currentStep} validating={wizardState.phase === "validating"} />

      {/* Step 1 — Pulsera paciente */}
      <ScanStep
        label="Paso 1 — Pulsera paciente"
        description="Escanee la pulsera GSRN del paciente"
        expectedType="GSRN"
        onScan={handlePatientScan}
        status={stepStatuses[1]}
        errorMessage={stepErrors[1]}
        disabled={wizardState.phase !== "scanning" || wizardState.step !== 1}
      />

      {/* Step 2 — Badge enfermera */}
      <ScanStep
        label="Paso 2 — Badge enfermera"
        description="Escanee su badge GSRN institucional"
        expectedType="GSRN"
        onScan={handleNurseScan}
        status={stepStatuses[2]}
        errorMessage={stepErrors[2]}
        disabled={wizardState.phase !== "scanning" || wizardState.step !== 2}
      />

      {/* Step 3 — Medicamento DataMatrix */}
      <ScanStep
        label="Paso 3 — Medicamento"
        description="Escanee el DataMatrix GS1 de la unidosis"
        expectedType="DataMatrix"
        onScan={(raw) => void handleMedicationScan(raw)}
        status={stepStatuses[3]}
        errorMessage={stepErrors[3]}
        disabled={wizardState.phase !== "scanning" || wizardState.step !== 3}
      />

      {/* Spinner de validación */}
      {wizardState.phase === "validating" && (
        <div
          className="flex items-center justify-center gap-3 rounded-xl bg-blue-50 p-6"
          role="status"
          aria-live="polite"
        >
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          <span className="text-sm font-medium text-blue-700">
            Validando 5 correctos...
          </span>
        </div>
      )}

      {/* Botón cancelar */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => router.push("/bedside")}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          Cancelar y volver a la cola
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function ProgressBar({
  currentStep,
  validating,
}: {
  currentStep: WizardStep;
  validating: boolean;
}) {
  const steps = [
    { n: 1, label: "Paciente" },
    { n: 2, label: "Enfermera" },
    { n: 3, label: "Medicamento" },
  ] as const;

  return (
    <div className="mb-2" role="navigation" aria-label="Progreso del flujo bedside">
      <div className="flex items-center justify-between">
        {steps.map((s, idx) => (
          <div key={s.n} className="flex flex-1 items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
                  currentStep > s.n
                    ? "bg-green-600 text-white"
                    : currentStep === s.n
                      ? validating
                        ? "animate-pulse bg-blue-500 text-white"
                        : "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-400",
                )}
                aria-current={currentStep === s.n ? "step" : undefined}
              >
                {currentStep > s.n ? "✓" : s.n}
              </div>
              <span className="mt-1 text-xs text-gray-500">{s.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-2 -mt-5",
                  currentStep > s.n ? "bg-green-500" : "bg-gray-200",
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HardStopScreen({
  reason,
  onCancel,
  onRetry,
}: {
  reason: string;
  onCancel: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-red-700 px-6 text-white"
      role="alertdialog"
      aria-modal="true"
      aria-label="Hard Stop de administración"
      aria-live="assertive"
    >
      <div className="max-w-sm text-center">
        {/* Ícono */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/20">
          <svg
            aria-hidden="true"
            className="h-10 w-10 text-white"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm-1.72 6.97a.75.75 0 10-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 101.06 1.06L12 13.06l1.72 1.72a.75.75 0 101.06-1.06L13.06 12l1.72-1.72a.75.75 0 10-1.06-1.06L12 10.94l-1.72-1.72z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        <h2 className="mb-3 text-3xl font-extrabold tracking-tight">HARD STOP</h2>
        <p className="mb-2 text-lg font-semibold">Administración bloqueada</p>
        <p className="mb-8 text-sm opacity-90">{reason}</p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="w-full rounded-lg bg-white px-6 py-3 font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-white"
          >
            Reiniciar flujo
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-lg border border-white/50 px-6 py-3 font-semibold text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function SuccessScreen({
  administrationId,
  onDone,
}: {
  administrationId: string | null;
  onDone: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-2xl bg-green-600 px-8 py-12 text-white"
      role="status"
      aria-live="polite"
    >
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/20">
        <svg
          aria-hidden="true"
          className="h-10 w-10 text-white"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
            clipRule="evenodd"
          />
        </svg>
      </div>

      <h2 className="mb-2 text-2xl font-extrabold">Administración Confirmada</h2>
      <p className="mb-1 text-sm opacity-90">
        Los 5 correctos fueron verificados correctamente.
      </p>
      {administrationId && (
        <p className="mb-8 font-mono text-xs opacity-70">
          ID: {administrationId}
        </p>
      )}

      <button
        type="button"
        onClick={onDone}
        className="rounded-lg bg-white px-8 py-3 font-semibold text-green-700 hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-green-600"
      >
        Volver a la cola
      </button>
    </div>
  );
}
