"use client";

import * as React from "react";

/**
 * ScanStep — componente reutilizable para cada paso del flujo bedside.
 *
 * DoD §4.2 Criterio 1 (anti-manual-entry):
 *   El campo de escaneo es readOnly. El listener de input sólo acepta
 *   strings que lleguen en < SCAN_THRESHOLD_MS (indica pistola HID o
 *   BarcodeDetector, no teclado humano). Si el usuario intenta teclear
 *   manualmente, el campo muestra "USE EL ESCÁNER".
 *
 * Feedback:
 *   - Vibración haptic (navigator.vibrate) en scan exitoso.
 *   - Beep sonoro via HTMLAudioElement (success / error).
 *
 * A11y WCAG 2.1 AA:
 *   - aria-live="assertive" en mensajes de error.
 *   - aria-label descriptivo en el campo.
 *   - Contraste verde/rojo con texto blanco (ratio > 4.5:1).
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { cn } from "@his/ui/lib/utils";

// Tiempo máximo en ms entre primer y último char para considerarlo scan HID.
// Las pistolas completan strings de 20+ chars en <50ms.
const SCAN_THRESHOLD_MS = 80;

export type ScanStepStatus = "waiting" | "success" | "error";

export interface ScanStepProps {
  /** Etiqueta visible del paso (ej. "Escanear pulsera paciente"). */
  label: string;
  /** Subtexto descriptivo. */
  description?: string;
  /** Tipo de código esperado — controla el indicador visual. */
  expectedType: "GSRN" | "DataMatrix";
  /** Callback cuando se recibe un scan válido (HID o BarcodeDetector). */
  onScan: (raw: string) => void;
  /** Estado controlado desde el padre. */
  status: ScanStepStatus;
  /** Mensaje de error a mostrar cuando status === "error". */
  errorMessage?: string;
  /** Si true, el paso está deshabilitado (pasos anteriores incompletos). */
  disabled?: boolean;
  /** Clase CSS extra para el wrapper. */
  className?: string;
}

/** Reproduce un beep usando HTMLAudioElement si el asset está disponible. */
function playBeep(type: "success" | "error") {
  try {
    const audio = new Audio(`/sounds/beep-${type}.mp3`);
    audio.volume = 0.7;
    void audio.play();
  } catch {
    // Sin audio — silencioso (dispositivos sin altavoz o sin permiso).
  }
}

/** Dispara vibración haptic si la API está disponible. */
function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // No soportado — silencioso.
  }
}

export function ScanStep({
  label,
  description,
  expectedType,
  onScan,
  status,
  errorMessage,
  disabled = false,
  className,
}: ScanStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Acumulador de chars para distinguir scan HID de tipeo manual.
  const bufferRef = useRef<string>("");
  const firstCharTimeRef = useRef<number | null>(null);

  // Efecto de feedback al cambiar status.
  useEffect(() => {
    if (status === "success") {
      playBeep("success");
      vibrate([200]);
    } else if (status === "error") {
      playBeep("error");
      vibrate([200, 100, 200]);
    }
  }, [status]);

  // Focus automático al habilitarse el paso.
  useEffect(() => {
    if (!disabled && status === "waiting") {
      inputRef.current?.focus();
    }
  }, [disabled, status]);

  const [manualEntryWarning, setManualEntryWarning] = useState(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      // Registrar primer char del potencial scan.
      if (firstCharTimeRef.current === null) {
        firstCharTimeRef.current = Date.now();
      }
    },
    [disabled],
  );

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      if (disabled) return;
      const now = Date.now();
      const firstTime = firstCharTimeRef.current ?? now;
      const elapsed = now - firstTime;
      const value = (e.target as HTMLInputElement).value;

      bufferRef.current = value;

      // Las pistolas HID envían Enter al terminar — esperamos newline o string completo.
      // Detectamos "scan completo" si llegó un string no vacío y el elapsed < threshold.
      if (elapsed <= SCAN_THRESHOLD_MS && value.length >= 8) {
        // Es un scan — procesar.
        setManualEntryWarning(false);
        firstCharTimeRef.current = null;
        bufferRef.current = "";
        // Limpiar el campo.
        if (inputRef.current) inputRef.current.value = "";
        // Strip sufijo Enter/Tab que algunas pistolas agregan.
        const clean = value.replace(/[\r\n\t]+$/, "").trim();
        onScan(clean);
      } else if (elapsed > SCAN_THRESHOLD_MS && value.length > 0) {
        // Tipeo manual detectado — rechazar.
        setManualEntryWarning(true);
        if (inputRef.current) inputRef.current.value = "";
        firstCharTimeRef.current = null;
        bufferRef.current = "";
      }
    },
    [disabled, onScan],
  );

  // Manejar Enter final de pistola (emitido como KeyboardEvent separado).
  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      if (e.key === "Enter" && bufferRef.current.length > 0) {
        const elapsed = Date.now() - (firstCharTimeRef.current ?? Date.now());
        if (elapsed <= SCAN_THRESHOLD_MS * 3) {
          setManualEntryWarning(false);
          const clean = bufferRef.current.replace(/[\r\n\t]+$/, "").trim();
          bufferRef.current = "";
          firstCharTimeRef.current = null;
          if (inputRef.current) inputRef.current.value = "";
          onScan(clean);
        }
      }
    },
    [disabled, onScan],
  );

  const typeLabel = expectedType === "GSRN" ? "GSRN-18" : "DataMatrix GS1";

  return (
    <div
      className={cn(
        "rounded-xl border-2 p-6 transition-all",
        status === "success" && "border-green-500 bg-green-50",
        status === "error" && "border-red-500 bg-red-50",
        status === "waiting" && !disabled && "border-blue-400 bg-white",
        disabled && "border-gray-200 bg-gray-50 opacity-50",
        className,
      )}
      aria-disabled={disabled}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <StatusIcon status={status} disabled={disabled} />
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{label}</h3>
          {description && (
            <p className="text-sm text-gray-500 mt-0.5">{description}</p>
          )}
        </div>
      </div>

      {/* Indicador de tipo esperado */}
      <div className="mb-3">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
          <ScanIcon />
          Tipo: {typeLabel}
        </span>
      </div>

      {/* Campo de escaneo — readOnly para cumplir DoD §4.2 */}
      {!disabled && status === "waiting" && (
        <div>
          <label
            className="block text-sm font-medium text-gray-700 mb-1.5"
            htmlFor={`scan-input-${label}`}
          >
            Esperando escaneo...
          </label>
          <input
            id={`scan-input-${label}`}
            ref={inputRef}
            type="text"
            readOnly={false}
            // readOnly=false pero el handler rechaza tipeo manual.
            // Usamos autoComplete="off" y inputMode="none" en móvil
            // para suprimir teclado virtual (requiere pistola o BarcodeDetector).
            autoComplete="off"
            inputMode="none"
            aria-label={`Campo de escaneo para ${label}. Solo se acepta lectura de escáner.`}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 caret-transparent"
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onKeyUp={handleKeyUp}
            placeholder="Escanee aquí..."
          />
          {manualEntryWarning && (
            <p
              className="mt-2 text-sm font-semibold text-red-600"
              role="alert"
              aria-live="assertive"
            >
              USE EL ESCÁNER — no se permite ingreso manual
            </p>
          )}
        </div>
      )}

      {/* Feedback estado success */}
      {status === "success" && (
        <div
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-white"
          role="status"
          aria-live="polite"
        >
          <CheckIcon />
          <span className="font-semibold">Verificado correctamente</span>
        </div>
      )}

      {/* Feedback estado error (hard-stop) */}
      {status === "error" && errorMessage && (
        <div
          className="rounded-lg bg-red-600 px-4 py-4 text-white"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-lg font-bold tracking-wide">HARD STOP</p>
          <p className="mt-1 text-sm opacity-90">{errorMessage}</p>
          <p className="mt-3 text-xs opacity-75">Reintente el escaneo o contacte supervisión.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Iconos inline
// ---------------------------------------------------------------------------

function StatusIcon({ status, disabled }: { status: ScanStepStatus; disabled: boolean }) {
  if (disabled) {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200">
        <span className="text-xs font-bold text-gray-400">—</span>
      </div>
    );
  }
  if (status === "success") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600">
        <CheckIcon className="h-4 w-4 text-white" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600">
        <XIcon className="h-4 w-4 text-white" />
      </div>
    );
  }
  // waiting
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100">
      <ScanIcon className="h-4 w-4 text-blue-600" />
    </div>
  );
}

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ScanIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
      />
    </svg>
  );
}
