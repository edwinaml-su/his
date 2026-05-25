"use client";

/**
 * AdministrationWizard — Wizard 3-step de administración bedside.
 *
 * Step 1: scan pulsera paciente (GSRN)
 * Step 2: scan badge enfermera (GSRN)
 * Step 3: scan medicamento (DataMatrix → GTIN)
 *
 * Al completar: llama bedside.validate5Correct.validate (alias Stream 10).
 * Si OK → confirma con bedside.administration.record (eMAR BCMA).
 * Hard-stop → modal rojo full-screen.
 *
 * Restaurado en F2-S7 Wave 2 — adapta input al schema de administrationRouter.
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
type LasaAlert = {
  pairedDrugId:   string;
  pairedDrugName: string;
  razon:          string;
  severidad:      string;
};

type WizardState =
  | { phase: "scanning"; step: WizardStep }
  | { phase: "validating" }
  | { phase: "doubleCheck"; lasaAlert: LasaAlert | null }
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
  // Double-check state — sólo activo cuando servidor responde requiresDoubleCheck=true.
  const [doubleCheckBy, setDoubleCheckBy]   = useState("");
  const [doubleCheckPin, setDoubleCheckPin] = useState("");
  const [doubleCheckError, setDoubleCheckError] = useState<string | undefined>();

  const validate5Correct = trpc.bedside.validate5Correct.validate.useMutation();
  const recordAdministration = trpc.bedside.administration.record.useMutation();

  // Step 1: scan pulsera paciente (GSRN)
  const handlePatientScan = useCallback(
    (raw: string) => {
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

  // Extraído para reutilizar desde el flujo normal y desde el re-envío double-check.
  const submitAdministration = useCallback(
    async (
      currentScans: Partial<ScanData>,
      gtin: string,
      lot: string,
      expiry: string,
      extraDoubleCheck?: { doubleCheckBy: string; doubleCheckPin: string },
    ) => {
      try {
        const adminResult = await recordAdministration.mutateAsync({
          patientGsrn:     currentScans.patientGsrn!,
          staffGsrn:       currentScans.nurseGsrn!,
          medicamentoGtin: gtin,
          lote:            lot,
          dosis:           `GS1:${expiry}`,
          via:             "IV",
          indicationId,
          ...extraDoubleCheck,
        });

        if (adminResult.requiresDoubleCheck) {
          // Servidor señala que se necesita verificación independiente.
          setWizardState({ phase: "doubleCheck", lasaAlert: adminResult.lasaAlert ?? null });
          return;
        }

        setWizardState({
          phase: "success",
          administrationId: adminResult.administrationId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes("IPSG3_DOUBLE_CHECK_FAILED") ||
          message.includes("IPSG3_DOUBLE_CHECK_SAME_PERSON")
        ) {
          setDoubleCheckError(message);
          return;
        }
        setWizardState({ phase: "hardStop", reason: extractHardStopReason(message) });
      }
    },
    [indicationId, recordAdministration],
  );

  const handleDoubleCheckSubmit = useCallback(async () => {
    setDoubleCheckError(undefined);
    if (!doubleCheckBy.trim() || !doubleCheckPin.trim()) {
      setDoubleCheckError("Ingrese el ID y PIN de la enfermera verificadora.");
      return;
    }
    const currentScans = scans;
    await submitAdministration(
      currentScans,
      currentScans.gtin ?? "",
      currentScans.lot  ?? "",
      currentScans.expiry ?? "",
      {
        doubleCheckBy:  doubleCheckBy.trim(),
        doubleCheckPin: doubleCheckPin.trim(),
      },
    );
  }, [doubleCheckBy, doubleCheckPin, scans, submitAdministration]);

  // Step 3: scan medicamento (DataMatrix GS1)
  const handleMedicationScan = useCallback(
    async (raw: string) => {
      const parseResult = parseGs1String(raw.trim());
      if (!parseResult.ok) {
        setStepStatuses((s) => ({ ...s, 3: "error" }));
        setStepErrors((e) => ({
          ...e,
          3: parseResult.error.message ?? "Error al parsear DataMatrix GS1",
        }));
        return;
      }

      const { gtin, lot, expiry } = parseResult.data;
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

      // Validar 5 correctos
      try {
        await validate5Correct.mutateAsync({
          patientGsrn: currentScans.patientGsrn!,
          nurseGsrn:   currentScans.nurseGsrn!,
          gtin,
          lot,
          expiry,
          indicationId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setWizardState({ phase: "hardStop", reason: extractHardStopReason(message) });
        return;
      }

      // Registrar administración (eMAR BCMA)
      // La vía "IV" es el default bedside — US.F2.6.24 prevé un selector de vía
      // en una pantalla de confirmación futura.
      await submitAdministration(currentScans, gtin, lot, expiry);
    },
    [scans, indicationId, validate5Correct, submitAdministration],
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

  // JCI IPSG.3 ME 4 — modal de verificación independiente
  if (wizardState.phase === "doubleCheck") {
    return (
      <DoubleCheckModal
        lasaAlert={wizardState.lasaAlert}
        doubleCheckBy={doubleCheckBy}
        doubleCheckPin={doubleCheckPin}
        error={doubleCheckError}
        submitting={recordAdministration.isPending}
        onDoubleCheckByChange={setDoubleCheckBy}
        onDoubleCheckPinChange={setDoubleCheckPin}
        onSubmit={() => void handleDoubleCheckSubmit()}
        onCancel={() => router.push("/bedside")}
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

  // patientId disponible para prefetch futuro — no eliminar prop
  void patientId;

  const currentStep = wizardState.phase === "validating" ? 3 : wizardState.step;

  return (
    <div className="space-y-4">
      <ProgressBar currentStep={currentStep} validating={wizardState.phase === "validating"} />

      <ScanStep
        label="Paso 1 — Pulsera paciente"
        description="Escanee la pulsera GSRN del paciente"
        expectedType="GSRN"
        onScan={handlePatientScan}
        status={stepStatuses[1]}
        errorMessage={stepErrors[1]}
        disabled={wizardState.phase !== "scanning" || wizardState.step !== 1}
      />

      <ScanStep
        label="Paso 2 — Badge enfermera"
        description="Escanee su badge GSRN institucional"
        expectedType="GSRN"
        onScan={handleNurseScan}
        status={stepStatuses[2]}
        errorMessage={stepErrors[2]}
        disabled={wizardState.phase !== "scanning" || wizardState.step !== 2}
      />

      <ScanStep
        label="Paso 3 — Medicamento"
        description="Escanee el DataMatrix GS1 de la unidosis"
        expectedType="DataMatrix"
        onScan={(raw) => void handleMedicationScan(raw)}
        status={stepStatuses[3]}
        errorMessage={stepErrors[3]}
        disabled={wizardState.phase !== "scanning" || wizardState.step !== 3}
      />

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
    { n: 1 as const, label: "Paciente" },
    { n: 2 as const, label: "Enfermera" },
    { n: 3 as const, label: "Medicamento" },
  ];

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
                  "mx-2 -mt-5 h-0.5 flex-1",
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

/**
 * JCI IPSG.3 ME 4 — Modal de verificación independiente doble-check.
 * Se muestra cuando el servidor responde requiresDoubleCheck=true.
 * No bloquea la UI completa — permite cancelar (error auditado).
 */
function DoubleCheckModal({
  lasaAlert,
  doubleCheckBy,
  doubleCheckPin,
  error,
  submitting,
  onDoubleCheckByChange,
  onDoubleCheckPinChange,
  onSubmit,
  onCancel,
}: {
  lasaAlert: LasaAlert | null;
  doubleCheckBy: string;
  doubleCheckPin: string;
  error: string | undefined;
  submitting: boolean;
  onDoubleCheckByChange: (v: string) => void;
  onDoubleCheckPinChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="double-check-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <svg aria-hidden="true" className="h-6 w-6 text-amber-600" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h2 id="double-check-title" className="text-base font-bold text-gray-900">
              Double-check requerido
            </h2>
            <p className="text-xs text-gray-500">JCI IPSG.3 — Medicamento de alto riesgo</p>
          </div>
        </div>

        {lasaAlert && (
          <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3">
            <p className="text-xs font-semibold text-orange-700">Alerta LASA</p>
            <p className="text-xs text-orange-600">
              Riesgo de confusión con <span className="font-medium">{lasaAlert.pairedDrugName}</span>
              {" "}({lasaAlert.razon})
            </p>
          </div>
        )}

        <p className="mb-4 text-sm text-gray-700">
          Este medicamento requiere verificación independiente de una segunda enfermera.
          Ingrese el ID institucional y PIN de la enfermera verificadora.
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="dc-by" className="block text-xs font-medium text-gray-700">
              ID de la enfermera verificadora
            </label>
            <input
              id="dc-by"
              type="text"
              value={doubleCheckBy}
              onChange={(e) => onDoubleCheckByChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="UUID o código institucional"
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="dc-pin" className="block text-xs font-medium text-gray-700">
              PIN de la verificadora
            </label>
            <input
              id="dc-pin"
              type="password"
              value={doubleCheckPin}
              onChange={(e) => onDoubleCheckPinChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="PIN institucional"
              autoComplete="current-password"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs font-medium text-red-600" role="alert">
            {error.includes("IPSG3_DOUBLE_CHECK_SAME_PERSON")
              ? "La verificadora debe ser una persona distinta a quien administra."
              : error.includes("IPSG3_DOUBLE_CHECK_FAILED")
                ? "PIN incorrecto o verificadora no encontrada."
                : error}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {submitting ? "Verificando..." : "Confirmar double-check"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Cancelar administración
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
