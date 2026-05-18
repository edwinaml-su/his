"use client";

/**
 * US.F2.6.10 — Cross-check alergias paciente vs GTIN.
 *
 * Renderiza:
 *   - Hard Stop: modal full-screen rojo con ingrediente + botón "Cancelar dispensación" único.
 *   - Warning: dialog con confirmación explícita farmacéutico + checkbox + textarea motivo.
 *   - Ok: no renderiza nada (null).
 *
 * La confirmación de Warning se persiste en audit_log por el servidor al llamar
 * dispense.create (el caller incluye allergyWarningAck en las notas de auditoría).
 *
 * a11y: role="alertdialog", aria-modal="true", aria-describedby para el cuerpo.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import type { AllergyCheckResult } from "@his/contracts";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface AllergyCheckDialogProps {
  result: AllergyCheckResult | null;
  /** Llamado cuando el farmacéutico cancela (hard stop o warning rechazado). */
  onCancel: () => void;
  /** Llamado cuando el farmacéutico confirma un warning con motivo. */
  onConfirmWarning: (reason: string) => void;
}

// ---------------------------------------------------------------------------
// Hard Stop modal (full-screen, no dismiss via overlay click)
// ---------------------------------------------------------------------------

function HardStopModal({
  result,
  onCancel,
}: {
  result: AllergyCheckResult;
  onCancel: () => void;
}) {
  const firstMatch = result.matches[0];
  const component = firstMatch?.component ?? "principio activo";
  const allergyText = firstMatch?.patientAllergyText ?? "";
  const severity = firstMatch?.severity ?? "";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="hard-stop-title"
      aria-describedby="hard-stop-body"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-destructive/95 p-4"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-2xl">
        <p
          id="hard-stop-title"
          className="text-2xl font-bold text-destructive"
          aria-live="assertive"
        >
          ALERGIA CONOCIDA — DISPENSACION BLOQUEADA
        </p>

        <div id="hard-stop-body" className="mt-4 space-y-2 text-sm">
          <p>
            <span className="font-semibold">Farmaco:</span>{" "}
            <span className="font-mono">{result.drugName}</span>
          </p>
          <p>
            <span className="font-semibold">Principio activo alergénico:</span>{" "}
            <span className="font-mono uppercase">{component}</span>
          </p>
          <p>
            <span className="font-semibold">Alergia registrada:</span>{" "}
            {allergyText}
          </p>
          {severity && (
            <p>
              <span className="font-semibold">Severidad:</span> {severity}
            </p>
          )}
          {result.matches.length > 1 && (
            <ul className="list-disc pl-5 text-destructive">
              {result.matches.map((m, i) => (
                <li key={i}>
                  {m.component} — alergia: {m.patientAllergyText}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 rounded bg-destructive/10 p-3 font-medium text-destructive">
            La dispensación ha sido bloqueada automaticamente por seguridad del
            paciente. Notifique al médico prescriptor y registre el incidente.
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          <Button
            variant="destructive"
            size="lg"
            onClick={onCancel}
            aria-label="Cancelar dispensación y volver"
          >
            Cancelar dispensación
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Warning dialog (confirmación explícita farmacéutico)
// ---------------------------------------------------------------------------

function WarningDialog({
  result,
  onCancel,
  onConfirm,
}: {
  result: AllergyCheckResult;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [reason, setReason] = React.useState("");

  const canConfirm = acknowledged && reason.trim().length >= 5;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="warning-title"
      aria-describedby="warning-body"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
        <p
          id="warning-title"
          className="text-xl font-bold text-yellow-700"
          aria-live="polite"
        >
          Alerta — Excipiente alergénico detectado
        </p>

        <div id="warning-body" className="mt-4 space-y-2 text-sm">
          <p>
            <span className="font-semibold">Fármaco:</span>{" "}
            <span className="font-mono">{result.drugName}</span>
          </p>
          <ul className="list-disc pl-5 text-yellow-800">
            {result.matches.map((m, i) => (
              <li key={i}>
                <span className="font-semibold">{m.component}</span>{" "}
                (excipiente) — alergia registrada: {m.patientAllergyText}
              </li>
            ))}
          </ul>
          <p className="rounded bg-yellow-50 p-2 text-yellow-900">
            Este medicamento contiene un excipiente al que el paciente puede
            ser alérgico. La dispensación requiere confirmación explícita del
            farmacéutico responsable.
          </p>
        </div>

        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              aria-required="true"
            />
            <span>
              Confirmo que he revisado el perfil de alergias del paciente y
              entiendo el riesgo asociado a este excipiente.
            </span>
          </label>

          <label className="block text-sm">
            <span className="font-medium">
              Motivo clínico de continuar dispensación{" "}
              <span className="text-destructive">*</span>
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Ej.: no hay alternativa terapéutica disponible; médico informado y acepta riesgo."
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
              aria-required="true"
              minLength={5}
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancelar dispensación
          </Button>
          <Button
            onClick={() => onConfirm(reason.trim())}
            disabled={!canConfirm}
            className="bg-yellow-600 text-white hover:bg-yellow-700"
          >
            Confirmar y continuar
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export function AllergyCheckDialog({
  result,
  onCancel,
  onConfirmWarning,
}: AllergyCheckDialogProps) {
  if (!result || result.status === "ok") return null;

  if (result.status === "hardStop") {
    return <HardStopModal result={result} onCancel={onCancel} />;
  }

  return (
    <WarningDialog
      result={result}
      onCancel={onCancel}
      onConfirm={onConfirmWarning}
    />
  );
}
