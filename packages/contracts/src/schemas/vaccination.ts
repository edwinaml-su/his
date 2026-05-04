/**
 * US-4.5 / US-7.3 — Schemas Zod para vacunación PAI (Programa Ampliado de Inmunizaciones).
 *
 * Modelo en BD: `Vaccine` (catálogo) + `PatientVaccination` (registro de aplicación).
 * Calendario PAI El Salvador 2026 cargado por seed-vaccines-sv.ts (US-7.3).
 *
 * Nota: el catálogo `Vaccine` es per-país (countryId). El campo `scheduleNote` documenta
 * en texto libre la edad / condición. La lógica de "dosis esperadas" se deriva en runtime
 * en el router (parsing simple del scheduleNote o constante por code) — TODO Sprint 2:
 * tabla `VaccineSchedule` normalizada con doseNumber + recommendedAgeMonths.
 *
 * Patrón: imitando consent.ts y bed.ts (TRPCError homogéneo, pagination consistente).
 */
import { z } from "zod";

/** Ruta de administración estándar (se almacena como string libre en `Vaccine.routeOfAdmin`). */
export const vaccineRouteEnum = z.enum([
  "IM", // intramuscular
  "SC", // subcutánea
  "ID", // intradérmica
  "ORAL",
  "IN", // intranasal
]);
export type VaccineRoute = z.infer<typeof vaccineRouteEnum>;

/** Sitios anatómicos comunes para registro de aplicación. */
export const anatomicalSiteEnum = z.enum([
  "left-deltoid",
  "right-deltoid",
  "left-anterolateral-thigh",
  "right-anterolateral-thigh",
  "left-gluteus",
  "right-gluteus",
  "oral",
  "intranasal",
]);
export type AnatomicalSite = z.infer<typeof anatomicalSiteEnum>;

// ----- Inputs -----

export const vaccineListInput = z.object({
  /** Filtra por país (acepta countryId UUID o ISO alpha-3). null/omit = catálogo del tenant. */
  countryId: z.string().uuid().optional(),
  countryIso: z.string().trim().length(3).optional(),
  activeOnly: z.boolean().default(true),
  search: z.string().trim().min(1).optional(),
});
export type VaccineListInput = z.infer<typeof vaccineListInput>;

export const vaccineCreateInput = z.object({
  countryId: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  manufacturer: z.string().trim().max(120).optional(),
  routeOfAdmin: vaccineRouteEnum.optional(),
  scheduleNote: z.string().trim().max(2000).optional(),
});
export type VaccineCreateInput = z.infer<typeof vaccineCreateInput>;

export const recordVaccinationInput = z.object({
  patientId: z.string().uuid(),
  vaccineId: z.string().uuid(),
  doseNumber: z.coerce.number().int().min(1).max(20).default(1),
  administeredAt: z.coerce.date(),
  lotNumber: z.string().trim().max(60).optional(),
  expirationDate: z.coerce.date().optional(),
  anatomicalSite: anatomicalSiteEnum.optional(),
  reactionsObserved: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Si true, ignora la alerta de alergia conocida (consentimiento clínico). */
  overrideAllergyAlert: z.boolean().default(false),
});
export type RecordVaccinationInput = z.infer<typeof recordVaccinationInput>;

export const vaccinationByPatientInput = z.object({
  patientId: z.string().uuid(),
});
export type VaccinationByPatientInput = z.infer<typeof vaccinationByPatientInput>;

// ----- Calendario PAI (constantes para UI y validación derivada) -----

/**
 * Esquema esperado de dosis por código de vacuna PAI El Salvador 2026.
 * Fuente: MINSAL — Norma Nacional de Vacunación PAI 2026.
 *
 * `expectedDoses` = total de dosis para esquema completo en menores de 5 años.
 * `agesMonths` = edades recomendadas (informativo; UI muestra dosis pendientes).
 *
 * TODO Sprint 2: mover a tabla `VaccineSchedule` (countryId, vaccineCode, doseNumber, ageMonths).
 */
export interface PaiScheduleEntry {
  code: string;
  expectedDoses: number;
  agesMonths: ReadonlyArray<number | string>;
}

export const PAI_SCHEDULE_SV: ReadonlyArray<PaiScheduleEntry> = [
  { code: "BCG", expectedDoses: 1, agesMonths: [0] },
  { code: "HEPB-RN", expectedDoses: 1, agesMonths: [0] },
  { code: "PENTAVALENTE", expectedDoses: 3, agesMonths: [2, 4, 6] },
  { code: "POLIO-IPV", expectedDoses: 3, agesMonths: [2, 4, 6] },
  { code: "ROTAVIRUS", expectedDoses: 2, agesMonths: [2, 4] },
  { code: "NEUMOCOCO", expectedDoses: 3, agesMonths: [2, 4, 12] },
  { code: "INFLUENZA", expectedDoses: 1, agesMonths: ["anual desde 6m"] },
  { code: "SRP", expectedDoses: 3, agesMonths: [12, 18, 84] },
  { code: "DPT", expectedDoses: 2, agesMonths: [18, 48] },
  { code: "TD", expectedDoses: 1, agesMonths: ["10a / embarazo"] },
  { code: "VPH", expectedDoses: 2, agesMonths: ["9a niñas"] },
  { code: "FA", expectedDoses: 1, agesMonths: [12] },
  { code: "COVID19", expectedDoses: 2, agesMonths: ["esquema vigente"] },
];

/** Lookup helper para el router/UI: devuelve dosis esperadas por code, default 1. */
export function expectedDosesFor(code: string): number {
  return PAI_SCHEDULE_SV.find((e) => e.code === code)?.expectedDoses ?? 1;
}
