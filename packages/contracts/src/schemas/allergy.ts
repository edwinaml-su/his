/**
 * US-4.7 — Schemas Zod para alergias detalladas del paciente.
 *
 * Modelo en BD: `PatientAllergy` (ya existente, NO se modifica schema en este sprint).
 * Campos disponibles en BD: substanceConceptId, substanceText, reaction, severity,
 * onsetDate, verified, active.
 *
 * Campos extra solicitados por US-4.7 que NO existen aún en columna:
 *   - clinicalManifestation (rash / anaphylaxis / dyspnea / ...)
 *   - lastReactionDate
 *   - status (ACTIVE / INACTIVE / RESOLVED)
 *   - confidence (CONFIRMED / SUSPECTED / REFUTED)
 *
 * Estrategia MVP: se aceptan en el input y se persisten serializados en `reaction` (texto)
 * con un sentinel `[META]{json}` al final, hasta que Sprint 2 amplíe el schema. El status
 * se mapea a `active` (ACTIVE → active=true, RESOLVED/INACTIVE → active=false).
 *
 * TODO Sprint 2: añadir columnas dedicadas (`clinicalManifestation`, `lastReactionDate`,
 * `status`, `confidence`) a `PatientAllergy` y migrar parsing.
 */
import { z } from "zod";

/** Severidad clínica (compatible con valores almacenados en `PatientAllergy.severity`). */
export const allergySeverityEnum = z.enum([
  "mild",
  "moderate",
  "severe",
  "life-threatening", // anaphylactic
]);
export type AllergySeverity = z.infer<typeof allergySeverityEnum>;

/** Manifestación clínica observada (US-4.7). */
export const allergyManifestationEnum = z.enum([
  "rash",
  "urticaria",
  "pruritus",
  "angioedema",
  "dyspnea",
  "bronchospasm",
  "anaphylaxis",
  "hypotension",
  "vomiting",
  "diarrhea",
  "other",
]);
export type AllergyManifestation = z.infer<typeof allergyManifestationEnum>;

/** Estado clínico de la alergia (US-4.7). */
export const allergyStatusEnum = z.enum(["ACTIVE", "INACTIVE", "RESOLVED"]);
export type AllergyStatus = z.infer<typeof allergyStatusEnum>;

/** Confianza diagnóstica (US-4.7 — basado en HL7 FHIR AllergyIntolerance.verificationStatus). */
export const allergyConfidenceEnum = z.enum(["CONFIRMED", "SUSPECTED", "REFUTED"]);
export type AllergyConfidence = z.infer<typeof allergyConfidenceEnum>;

/** Listado curado de substancias comunes para autocomplete (free text aún permitido). */
export const COMMON_ALLERGENS: ReadonlyArray<{ code: string; label: string; group: string }> = [
  { code: "penicilina", label: "Penicilina", group: "Antibióticos" },
  { code: "amoxicilina", label: "Amoxicilina", group: "Antibióticos" },
  { code: "cefalosporinas", label: "Cefalosporinas", group: "Antibióticos" },
  { code: "sulfas", label: "Sulfas (sulfonamidas)", group: "Antibióticos" },
  { code: "aine", label: "AINEs (ibuprofeno, diclofenaco)", group: "Analgésicos" },
  { code: "aas", label: "Ácido acetilsalicílico (AAS)", group: "Analgésicos" },
  { code: "latex", label: "Látex", group: "Materiales" },
  { code: "contraste-yodado", label: "Medio de contraste yodado", group: "Diagnóstico" },
  { code: "lidocaina", label: "Lidocaína / anestésicos locales", group: "Anestésicos" },
  { code: "huevo", label: "Huevo", group: "Alimentos" },
  { code: "leche", label: "Leche / proteína de vaca", group: "Alimentos" },
  { code: "mani", label: "Maní", group: "Alimentos" },
  { code: "mariscos", label: "Mariscos", group: "Alimentos" },
  { code: "picadura-abeja", label: "Picadura de abeja / avispa", group: "Picaduras" },
];

// ----- Inputs -----

export const allergyByPatientInput = z.object({
  patientId: z.string().uuid(),
});

export const allergyCreateInput = z.object({
  patientId: z.string().uuid(),
  substanceText: z.string().trim().min(1).max(200),
  substanceConceptId: z.string().uuid().optional(),
  reaction: z.string().trim().max(400).optional(),
  severity: allergySeverityEnum,
  onsetDate: z.coerce.date().optional(),
  /** Campos extra US-4.7 — se persisten en `reaction` con sentinel [META] hasta Sprint 2. */
  clinicalManifestation: allergyManifestationEnum.optional(),
  lastReactionDate: z.coerce.date().optional(),
  status: allergyStatusEnum.default("ACTIVE"),
  confidence: allergyConfidenceEnum.default("CONFIRMED"),
  verified: z.boolean().default(false),
});
export type AllergyCreateInput = z.infer<typeof allergyCreateInput>;

export const allergyUpdateInput = allergyCreateInput
  .partial()
  .extend({ id: z.string().uuid() })
  .omit({ patientId: true });
export type AllergyUpdateInput = z.infer<typeof allergyUpdateInput>;

export const allergyResolveInput = z.object({
  id: z.string().uuid(),
  /** Razón opcional para la resolución (TODO Sprint 2: persistir en columna). */
  reason: z.string().trim().max(400).optional(),
});

// ----- Helpers de serialización (sentinel META en columna `reaction`) -----

const META_SENTINEL = "[META]";

export interface AllergyMeta {
  clinicalManifestation?: AllergyManifestation;
  lastReactionDate?: string; // ISO
  status?: AllergyStatus;
  confidence?: AllergyConfidence;
}

/** Empaqueta meta extras en el campo `reaction` para persistencia MVP. */
export function packAllergyReaction(reaction: string | undefined, meta: AllergyMeta): string {
  const base = (reaction ?? "").replace(/\s*\[META\].*$/s, "").trim();
  const json = JSON.stringify(meta);
  return base.length > 0 ? `${base} ${META_SENTINEL}${json}` : `${META_SENTINEL}${json}`;
}

/** Desempaca meta extras del campo `reaction`. */
export function unpackAllergyReaction(stored: string | null | undefined): {
  reaction: string;
  meta: AllergyMeta;
} {
  if (!stored) return { reaction: "", meta: {} };
  const idx = stored.indexOf(META_SENTINEL);
  if (idx < 0) return { reaction: stored, meta: {} };
  const reaction = stored.slice(0, idx).trim();
  const jsonRaw = stored.slice(idx + META_SENTINEL.length).trim();
  try {
    return { reaction, meta: JSON.parse(jsonRaw) as AllergyMeta };
  } catch {
    return { reaction: stored, meta: {} };
  }
}
