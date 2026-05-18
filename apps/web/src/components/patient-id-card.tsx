"use client";

import * as React from "react";

/**
 * PatientIdCard — componente reusable de identificación de paciente por GSRN.
 *
 * US.F2.6.37-40: Escaneo de pulsera → ficha completa con alergias y encuentro activo.
 *
 * Uso:
 *   <PatientIdCard onIdentified={(data) => ...} onError={(code) => ...} />
 *
 * Flujo:
 *   1. Entrada GSRN vía input manual o BarcodeScanner (HID-teclado).
 *   2. Validación Módulo-10 en cliente (mismo algoritmo que router).
 *   3. Lookup tRPC → ficha paciente.
 *   4. Callback onIdentified / onError según resultado.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Validación GSRN cliente (espeja router)
// ---------------------------------------------------------------------------

function gs1CheckDigitValid(code: string): boolean {
  if (!/^\d{18}$/.test(code)) return false;
  const len = code.length;
  let sum = 0;
  for (let i = 0; i < len - 1; i++) {
    const fromRight = len - 1 - i;
    const weight = fromRight % 2 === 1 ? 3 : 1;
    sum += parseInt(code[i]!, 10) * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === parseInt(code[len - 1]!, 10);
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type LookupResult = {
  gsrn: string;
  gsrnAssignedAt: Date;
  patient: {
    id: string;
    mrn: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    secondLastName: string | null;
    birthDate: Date | null;
    bloodTypeAbo: string | null;
    bloodRh: string | null;
    active: boolean;
  };
  allergies: {
    id: string;
    substanceText: string;
    severity: string;
    reaction: string | null;
    verified: boolean;
  }[];
  activeEncounter: {
    id: string;
    encounterNumber: string;
    admittedAt: Date;
    admissionType: string;
    primaryDiagnosisId: string | null;
  } | null;
};

export interface PatientIdCardProps {
  /** GSRN pre-cargado (ej. desde escaneo externo al componente). */
  gsrnInput?: string;
  /** Callback cuando la identificación es exitosa. */
  onIdentified: (data: LookupResult) => void;
  /** Callback cuando ocurre un error de identificación. */
  onError: (code: string, message: string) => void;
  /** Si true, muestra el botón "Refrescar Pulsera" (requiere rol ADMIN/ADMISION). */
  showRefreshButton?: boolean;
  /** Si true, el input manual está habilitado. Solo usar en estaciones admin. */
  allowManualInput?: boolean;
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function AllergyBadge({ allergen, severity }: { allergen: string; severity: string }) {
  const colorMap: Record<string, string> = {
    severe: "bg-red-600 text-white",
    "life-threatening": "bg-red-800 text-white",
    moderate: "bg-orange-500 text-white",
    mild: "bg-yellow-200 text-yellow-900",
  };
  const color = colorMap[severity] ?? "bg-gray-200 text-gray-800";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {allergen}
    </span>
  );
}

function PatientDetail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-gray-500 min-w-[7rem]">{label}:</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function PatientCard({ data }: { data: LookupResult }) {
  const { patient, allergies, activeEncounter, gsrn } = data;

  const fullName = [
    patient.firstName,
    patient.middleName,
    patient.lastName,
    patient.secondLastName,
  ]
    .filter(Boolean)
    .join(" ");

  const age = patient.birthDate
    ? Math.floor(
        (Date.now() - new Date(patient.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
      )
    : null;

  return (
    <div className="rounded-lg border border-green-300 bg-green-50 p-4 space-y-3">
      {/* Cabecera */}
      <div className="flex items-start gap-3">
        {/* Avatar placeholder */}
        <div className="h-14 w-14 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xl font-bold shrink-0">
          {patient.firstName[0]}
          {patient.lastName[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-semibold text-gray-900 truncate">{fullName}</p>
          <p className="text-sm text-gray-500">
            {age !== null ? `${age} años` : "Edad desconocida"}
            {patient.bloodTypeAbo ? ` · Grupo ${patient.bloodTypeAbo}${patient.bloodRh ?? ""}` : ""}
          </p>
          <p className="text-xs font-mono text-gray-400 mt-0.5">GSRN: {gsrn}</p>
        </div>
        <span className="shrink-0 px-2 py-1 rounded bg-green-100 text-green-800 text-xs font-semibold">
          IDENTIFICADO
        </span>
      </div>

      {/* Datos clave */}
      <div className="space-y-1 border-t pt-2">
        <PatientDetail label="MRN" value={patient.mrn} />
        {activeEncounter && (
          <PatientDetail label="Encuetro activo" value={activeEncounter.encounterNumber} />
        )}
      </div>

      {/* Alergias */}
      {allergies.length > 0 && (
        <div className="border-t pt-2">
          <p className="text-xs font-semibold text-red-700 mb-1 uppercase tracking-wide">
            Alergias activas
          </p>
          <div className="flex flex-wrap gap-1.5">
            {allergies.map((a) => (
              <AllergyBadge key={a.id} allergen={a.substanceText} severity={a.severity} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function PatientIdCard({
  gsrnInput,
  onIdentified,
  onError,
  showRefreshButton = false,
  allowManualInput = false,
}: PatientIdCardProps) {
  const [gsrn, setGsrn] = useState(gsrnInput ?? "");
  const [identifiedData, setIdentifiedData] = useState<LookupResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sincronizar prop externa
  useEffect(() => {
    if (gsrnInput) {
      setGsrn(gsrnInput);
    }
  }, [gsrnInput]);

  const lookup = trpc.patientIdentification.lookupByGsrn.useQuery(
    { gsrn },
    {
      enabled: false, // manual trigger
      retry: false,
    },
  );

  const handleSubmit = useCallback(async () => {
    setValidationError(null);
    setIdentifiedData(null);

    const trimmed = gsrn.trim();

    if (trimmed.length !== 18) {
      setValidationError("El GSRN debe tener exactamente 18 dígitos.");
      return;
    }

    if (!gs1CheckDigitValid(trimmed)) {
      setValidationError("Código GSRN inválido (dígito verificador GS1 incorrecto).");
      return;
    }

    try {
      const result = await lookup.refetch();
      if (result.data) {
        setIdentifiedData(result.data);
        onIdentified(result.data);
      }
    } catch (err) {
      const error = err as { message?: string };
      const code = error.message ?? "ERROR_DESCONOCIDO";
      onError(code, code === "GSRN_NO_REGISTRADO"
        ? "Pulsera no registrada en esta organización."
        : code === "PULSERA_INACTIVA"
          ? "Pulsera revocada. Contacte admisión para reimpresión."
          : "Error al identificar al paciente. Intente nuevamente.");
    }
  }, [gsrn, lookup, onIdentified, onError]);

  // Auto-submit cuando llega gsrnInput externo de 18 dígitos válidos
  useEffect(() => {
    if (gsrnInput && gs1CheckDigitValid(gsrnInput.trim())) {
      setGsrn(gsrnInput.trim());
      // Pequeño defer para que el estado se actualice
      setTimeout(() => void handleSubmit(), 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gsrnInput]);

  const isLoading = lookup.isFetching;

  return (
    <div className="space-y-4">
      {/* Input / escáner */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Escanear pulsera GSRN
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="\d{18}"
            maxLength={18}
            value={gsrn}
            onChange={(e) => {
              setGsrn(e.target.value);
              setValidationError(null);
              setIdentifiedData(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
            // HID-teclado: el escáner envía todos los caracteres en < 50ms seguidos de Enter.
            // Tratar el input como read-only visualmente pero aceptar el evento de teclado.
            readOnly={!allowManualInput}
            className={[
              "flex-1 rounded-md border px-3 py-2 text-sm font-mono",
              "focus:outline-none focus:ring-2 focus:ring-blue-500",
              !allowManualInput
                ? "bg-gray-50 cursor-default"
                : "bg-white",
              validationError ? "border-red-400" : "border-gray-300",
            ].join(" ")}
            placeholder={allowManualInput ? "Ingresar GSRN de 18 dígitos" : "Esperando escaneo..."}
            aria-label="GSRN de la pulsera del paciente"
            aria-invalid={!!validationError}
            aria-describedby={validationError ? "gsrn-error" : undefined}
            autoFocus
          />
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isLoading || gsrn.length !== 18}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-busy={isLoading}
          >
            {isLoading ? "Buscando..." : "Identificar"}
          </button>
        </div>

        {validationError && (
          <p id="gsrn-error" className="text-sm text-red-600" role="alert">
            {validationError}
          </p>
        )}

        {lookup.error && (
          <p className="text-sm text-red-600" role="alert">
            {lookup.error.message === "GSRN_NO_REGISTRADO"
              ? "Pulsera no registrada en esta organización."
              : lookup.error.message === "PULSERA_INACTIVA"
                ? "Pulsera revocada. Contacte admisión para reimpresión."
                : "Error al identificar. Verifique el código e intente nuevamente."}
          </p>
        )}
      </div>

      {/* Ficha del paciente */}
      {identifiedData && <PatientCard data={identifiedData} />}

      {/* Botón refrescar pulsera (solo admin/admision) */}
      {showRefreshButton && identifiedData && (
        <div className="border-t pt-3">
          <a
            href={`/patients/${identifiedData.patient.id}/gsrn-history`}
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
          >
            Ver historial de pulseras / Emitir nueva
          </a>
        </div>
      )}
    </div>
  );
}
