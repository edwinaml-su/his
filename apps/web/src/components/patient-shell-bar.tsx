"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import { PatientContextBar } from "./patient-context-bar";
import { BreakGlassButton } from "./break-glass-button";

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
 *
 * US-2.7 — puerta de entrada de break-glass: cuando `trpc.patient.get` falla
 * (paciente fuera del alcance normal del usuario — otra org/establecimiento),
 * este es el punto donde un clínico topa con el muro en medio de una consulta.
 * En vez de no renderizar nada, ofrecemos `<BreakGlassButton>` aquí — es el
 * único lugar del shell que ya conoce el `patientId` que se intentaba abrir.
 */
export function PatientShellBar({ patientId }: PatientShellBarProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const {
    data: patient,
    isLoading,
    error,
  } = trpc.patient.get.useQuery({ id: patientId }, { enabled: !!patientId });

  // Encuentro abierto más reciente → zona centro (ubicación) de la barra.
  // Si el paciente no tiene servicio activo, location queda undefined y la
  // barra oculta la zona centro (contrato CC-0008 §B).
  const { data: openEncounters } = trpc.encounter.list.useQuery(
    { patientId, status: "OPEN", page: 1, pageSize: 1 },
    { enabled: !!patientId },
  );

  const handleBreakGlassActivated = React.useCallback(() => {
    void utils.patient.get.invalidate({ id: patientId });
    router.refresh();
  }, [utils, patientId, router]);

  // Sin acceso normal (la query falló) → ofrecer la puerta de entrada de
  // emergencia en vez de no mostrar nada.
  if (!isLoading && !patient && error) {
    return (
      <BreakGlassButton
        patientId={patientId}
        hasNormalAccess={false}
        onActivated={handleBreakGlassActivated}
      />
    );
  }

  // No renderizar durante carga ni si el paciente no existe
  if (isLoading || !patient) return null;

  const activeEncounter = openEncounters?.items[0];
  const location = activeEncounter
    ? {
        establishment: activeEncounter.establishment.name,
        service: activeEncounter.serviceUnit?.name ?? undefined,
        bed: activeEncounter.bedAssignments[0]?.bed.code ?? undefined,
      }
    : undefined;

  // Mapear alergias al formato de chips (normalizar severity a mayúsculas)
  const allergiesForBar = patient.allergies
    .filter((a) => a.severity !== "life-threatening" || true) // incluimos todos
    .map((a) => ({
      name: a.substanceText,
      severity: a.severity.toUpperCase() as "MILD" | "MODERATE" | "SEVERE",
    }));

  return (
    <PatientContextBar
      location={location}
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
