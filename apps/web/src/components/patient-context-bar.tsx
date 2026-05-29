"use client";

import * as React from "react";
import { AlertTriangle, Shield, PersonStanding } from "lucide-react";
import { Badge } from "@his/ui/components/badge";
import { Separator } from "@his/ui/components/separator";
import { cn } from "@his/ui/lib/utils";

// Calcula edad en años completos desde birthDate hasta hoy.
function calcAge(birthDate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

export interface PatientContextBarProps {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
    birthDate: Date | null;
    biologicalSexCode: string | null; // M / F / I / U
    isUnknown?: boolean;
  };
  location?: {
    establishment: string;
    service?: string;
    bed?: string;
  };
  alerts?: {
    allergies?: { name: string; severity: "MILD" | "MODERATE" | "SEVERE" }[];
    isolation?: string; // ej. "Contacto", "Gotitas"
    fallRisk?: "LOW" | "MEDIUM" | "HIGH";
    lasa?: boolean;
  };
  className?: string;
}

// Mapa de severidad a variante de Badge
const allergySeverityVariant = {
  MILD: "warning",
  MODERATE: "warning",
  SEVERE: "destructive",
} as const satisfies Record<string, "warning" | "destructive">;

// Etiqueta legible para nivel de riesgo de caída
const fallRiskLabel: Record<string, string> = {
  LOW: "Bajo",
  MEDIUM: "Medio",
  HIGH: "Alto",
};

/**
 * Franja persistente de identificación segura del paciente activo.
 * Visible en todas las rutas del expediente.
 *
 * A11y: role="region" + aria-label. Cada alerta lleva ícono + texto,
 * nunca solo color (cumple §3.2 color-alone).
 */
export function PatientContextBar({
  patient,
  location,
  alerts,
  className,
}: PatientContextBarProps) {
  const isUnknown = patient.isUnknown ?? false;
  const displayName = isUnknown
    ? "Paciente NN"
    : `${patient.firstName} ${patient.lastName}`;

  const ageDisplay = (() => {
    if (isUnknown || !patient.birthDate) return "N/A";
    return `${calcAge(patient.birthDate)} años`;
  })();

  const locationText = (() => {
    if (!location) return null;
    const parts = [location.establishment, location.service, location.bed].filter(Boolean);
    return parts.join(" › ");
  })();

  const hasAlerts =
    (alerts?.allergies?.length ?? 0) > 0 ||
    !!alerts?.isolation ||
    !!alerts?.fallRisk ||
    !!alerts?.lasa;

  return (
    <div
      role="region"
      aria-label="Información del paciente activo"
      className={cn(
        // sticky bajo el top bar (top-14 = 3.5rem = altura estándar del header)
        "sticky top-14 z-30 flex min-h-[44px] items-center gap-3 border-b border-border",
        "bg-surface-1 px-4 py-2 text-sm",
        className,
      )}
    >
      {/* IZQUIERDA — identidad */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-semibold text-foreground">{displayName}</span>
        <Separator orientation="vertical" className="h-4" />
        <span className="font-mono text-xs text-muted-foreground">MRN {patient.mrn}</span>
        {!isUnknown && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-muted-foreground">{ageDisplay}</span>
            {patient.biologicalSexCode && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-muted-foreground">{patient.biologicalSexCode}</span>
              </>
            )}
          </>
        )}
      </div>

      {/* CENTRO — ubicación física */}
      {locationText && (
        <>
          <Separator orientation="vertical" className="h-4" />
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={locationText}>
            {locationText}
          </span>
        </>
      )}

      {/* DERECHA — chips de alertas */}
      {hasAlerts && (
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
          {alerts?.allergies?.map((allergy) => (
            <Badge
              key={allergy.name}
              variant={allergySeverityVariant[allergy.severity] ?? "warning"}
              // bg-allergy mantiene el color distintivo rosa oscuro del design system
              className="min-h-[28px] gap-1 bg-allergy text-allergy-foreground hover:bg-allergy/90"
              aria-label={`Alergia ${allergy.severity.toLowerCase()} a ${allergy.name}`}
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <span>Alergia: {allergy.name}</span>
            </Badge>
          ))}

          {alerts?.isolation && (
            <Badge
              variant="secondary"
              className="min-h-[28px] gap-1"
              aria-label={`Aislamiento: ${alerts.isolation}`}
            >
              <Shield className="h-3 w-3" aria-hidden="true" />
              <span>Aislamiento: {alerts.isolation}</span>
            </Badge>
          )}

          {alerts?.fallRisk && (
            <Badge
              variant={alerts.fallRisk === "HIGH" ? "destructive" : "warning"}
              className="min-h-[28px] gap-1"
              aria-label={`Riesgo de caída: ${fallRiskLabel[alerts.fallRisk]}`}
            >
              <PersonStanding className="h-3 w-3" aria-hidden="true" />
              <span>Caída: {fallRiskLabel[alerts.fallRisk]}</span>
            </Badge>
          )}

          {alerts?.lasa && (
            <Badge
              variant="secondary"
              // bg-lasa = marrón distintivo definido en el design system
              className="min-h-[28px] gap-1 bg-lasa text-lasa-foreground hover:bg-lasa/90"
              aria-label="Medicamentos LASA presentes"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <span>LASA</span>
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
