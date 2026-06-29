"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc/react";
import { PatientContextBar } from "./patient-context-bar";

interface PatientShellBarProps {
  patientId: string;
}

/**
 * Wrapper que fetchea el paciente y alimenta PatientContextBar — el "segundo
 * header" persistente del paciente activo (clase distinta al header de sesión).
 *
 * Estrategia: client-only con useQuery (enabled: !!patientId) — más simple
 * que RSC fetch y compatible con la arquitectura de trpc.patient.get existente.
 * Si el paciente no se encuentra o hay error, no renderiza nada.
 *
 * Contrato de visibilidad (CC-0008 §B):
 *   - SOLO montar en páginas donde se CONSULTA a un paciente: vista 360°/
 *     históricos del expediente y cuentas/episodios con servicio activo
 *     (ambulatorio u hospitalario).
 *   - NUNCA montar en flujos de captura de identidad (pre-registro `/patients/new`,
 *     admisión) — ahí el paciente aún se está dando de alta, no se "consulta".
 *   - Si no hay paciente cargado, no se muestra (guard `!patient → null`).
 */
export function PatientShellBar({ patientId }: PatientShellBarProps) {
  const { data: patient, isLoading } = trpc.patient.get.useQuery(
    { id: patientId },
    { enabled: !!patientId },
  );

  // No renderizar durante carga ni si el paciente no existe
  if (isLoading || !patient) return null;

  // Mapear alergias al formato de chips (normalizar severity a mayúsculas)
  const allergiesForBar = patient.allergies
    .filter((a) => a.severity !== "life-threatening" || true) // incluimos todos
    .map((a) => ({
      name: a.substanceText,
      severity: a.severity.toUpperCase() as "MILD" | "MODERATE" | "SEVERE",
    }));

  return (
    <PatientContextBar
      patient={{
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        mrn: patient.mrn,
        birthDate: patient.birthDate,
        biologicalSexCode: patient.biologicalSex?.code ?? null,
        isUnknown: patient.isUnknown,
      }}
      alerts={{
        allergies: allergiesForBar,
        // CC-0008 §B — alerta LGBTIQ+ (nombre de pila); se captura en admisión.
        lgbtiq: patient.esLgbtiq ?? false,
        preferredName: patient.preferredName ?? null,
        // isolation, fallRisk, lasa: datos de futuras relaciones (follow-up)
      }}
    />
  );
}
