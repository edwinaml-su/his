"use client";

/**
 * Herramienta standalone de identificación de paciente por pulsera GSRN.
 * US.F2.6.37-40 — Ruta: /patient-id
 *
 * Reusa <PatientIdCard>. Disponible para cualquier usuario clínico que
 * necesite verificar la identidad de un paciente desde cualquier punto.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PatientIdCard } from "@/components/patient-id-card";

export default function PatientIdPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [identified, setIdentified] = useState(false);

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          Identificación de Paciente
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Escanee la pulsera GSRN del paciente para verificar su identidad.
        </p>
      </div>

      {errorMessage && (
        <div
          className="rounded-md border border-red-300 bg-red-50 p-4"
          role="alert"
        >
          <p className="text-sm font-semibold text-red-800">Error de identificación</p>
          <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="mt-2 text-sm text-red-600 underline"
          >
            Intentar nuevamente
          </button>
        </div>
      )}

      {!errorMessage && (
        <PatientIdCard
          onIdentified={(data) => {
            setIdentified(true);
            setErrorMessage(null);
            // Navegar al expediente completo del paciente
            setTimeout(() => {
              router.push(`/patients/${data.patient.id}`);
            }, 1500);
          }}
          onError={(_code, message) => {
            setErrorMessage(message);
          }}
          showRefreshButton={false}
          allowManualInput={false}
        />
      )}

      {identified && !errorMessage && (
        <p className="text-sm text-green-700 text-center">
          Redirigiendo al expediente del paciente...
        </p>
      )}
    </div>
  );
}
