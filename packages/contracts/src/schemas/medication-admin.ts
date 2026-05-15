/**
 * §16 eMAR (Electronic Medication Administration Record) — schemas de input.
 *
 * Beta.8 hardening layer 1:
 *   - MedAdminStatus: SCHEDULED -> {ADMINISTERED, REFUSED, MISSED, HELD}
 *   - BCMA: patientBarcodeScanned + drugBarcodeScanned + providerBadgeScanned
 *   - secondVerifierId para alto riesgo
 *   - scheduledTime + timingWindowMinutes para timing-window enforcement
 *   - overrideReason para bypasses auditados
 */
import { z } from 'zod';

const MED_ADMIN_STATUS = [
  'SCHEDULED',
  'ADMINISTERED',
  'GIVEN',
  'HELD',
  'REFUSED',
  'MISSED',
  'DOCUMENTED_LATE',
] as const;

const ADMIN_ROUTE = [
  'ORAL',
  'IV',
  'IM',
  'SC',
  'TOPICAL',
  'INHALED',
  'RECTAL',
  'SUBLINGUAL',
  'OPHTHALMIC',
  'OTIC',
  'NASAL',
] as const;

/** Transiciones validas del state machine eMAR. */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ['ADMINISTERED', 'REFUSED', 'MISSED', 'HELD'],
  GIVEN: [],
  ADMINISTERED: [],
  REFUSED: [],
  MISSED: [],
  HELD: ['SCHEDULED'],
  DOCUMENTED_LATE: [],
};

export const medAdminStatusEnum = z.enum(MED_ADMIN_STATUS);
export const medAdminRouteEnum = z.enum(ADMIN_ROUTE);

export type MedAdminStatusType = z.infer<typeof medAdminStatusEnum>;

export const medicationAdministrationRecordInput = z.object({
  prescriptionItemId: z.string().uuid(),
  status: medAdminStatusEnum.default('SCHEDULED'),
  doseAmount: z.number().positive().optional(),
  doseUnit: z.string().trim().max(20).optional(),
  route: medAdminRouteEnum.optional(),
  site: z.string().trim().max(80).optional(),
  /** BCMA scan flags -- los 3 deben ser true para status=ADMINISTERED. */
  patientBarcodeScanned: z.boolean().default(false),
  drugBarcodeScanned: z.boolean().default(false),
  providerBadgeScanned: z.boolean().default(false),
  scannedAt: z.coerce.date().optional(),
  /** Legacy campos -- mantenidos para compatibilidad. */
  barcodeScannedAt: z.coerce.date().optional(),
  patientWristbandScanned: z.boolean().default(false),
  /** Doble-check requerido para alto riesgo. Debe ser distinto de administeredById. */
  secondVerifierId: z.string().uuid().optional(),
  doubleCheckById: z.string().uuid().optional(),
  /** Momento programado de administracion (usado por timing-window). */
  scheduledTime: z.coerce.date().optional(),
  timingWindowMinutes: z.number().int().min(1).max(240).default(30),
  overrideReason: z.string().trim().min(10).max(500).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const medicationAdministrationListInput = z.object({
  prescriptionItemId: z.string().uuid().optional(),
  administeredById: z.string().uuid().optional(),
  status: medAdminStatusEnum.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const medicationAdministrationGetInput = z.object({
  id: z.string().uuid(),
});

export type MedicationAdministrationRecordInput = z.infer<typeof medicationAdministrationRecordInput>;
export type MedicationAdministrationListInput = z.infer<typeof medicationAdministrationListInput>;

// ---------------------------------------------------------------------------
// Beta.15 (US.B15.4.3b) — Detector puro de allergy.mismatch para eMAR.
// ---------------------------------------------------------------------------

/**
 * Input shape de una alergia activa del paciente. El caller (router) debe
 * resolver `allergenAtcCode` desde `PatientAllergy.substanceConcept` cuando la
 * relación está disponible (codeSystem.code === "ATC"); de lo contrario null
 * y el match cae al path por texto.
 */
export interface AllergyMismatchAllergyInput {
  id: string;
  /** Texto libre de la sustancia (campo `PatientAllergy.substanceText`). */
  substanceText: string;
  /** Code ATC resuelto si el concept del allergy referencia codeSystem ATC. */
  allergenAtcCode: string | null;
  /** mild / moderate / severe / life-threatening (campo PatientAllergy.severity). */
  severity: string;
}

/** Input shape del drug que se intenta administrar. */
export interface AllergyMismatchDrugInput {
  id: string;
  atcCode: string | null;
  genericName: string;
  brandName: string | null;
}

/** Resultado del detector: una entrada por alergia que matchea con el drug. */
export interface AllergyMismatchHit {
  allergyId: string;
  severity: string;
  /** Mecanismo por el que se detectó el match — útil para auditoría/payload. */
  matchedBy: "atc" | "name";
}

/**
 * Detector puro determinístico — sin I/O. Retorna ≥ 1 entry por alergia que
 * matchea contra el drug. Reglas de match (cualquiera dispara):
 *
 *  1. ATC: `allergy.allergenAtcCode` y `drug.atcCode` ambos presentes y
 *     comparables case-insensitive (igualdad exacta o prefijo ATC — un allergy
 *     a "J01CA" matchea drug "J01CA04" porque la jerarquía ATC implica que
 *     la familia completa es alérgica). El detector usa **igualdad exacta**
 *     para evitar falsos positivos hasta que tengamos jerarquía ATC en BD.
 *  2. Nombre: `allergy.substanceText` aparece como substring (case-insensitive,
 *     normalizado) en `drug.genericName` o `drug.brandName`, o viceversa. Sólo
 *     se considera match cuando el texto del allergy tiene >= 3 chars para
 *     evitar matches espurios.
 *
 * Sin allergies o sin atc + nombre vacío → retorna `[]` (no emit).
 */
export function detectAllergyMismatch(
  allergies: ReadonlyArray<AllergyMismatchAllergyInput>,
  drug: AllergyMismatchDrugInput,
): AllergyMismatchHit[] {
  if (!allergies || allergies.length === 0) return [];

  const drugAtc = (drug.atcCode ?? "").trim().toUpperCase();
  const drugGeneric = (drug.genericName ?? "").trim().toLowerCase();
  const drugBrand = (drug.brandName ?? "").trim().toLowerCase();

  const hits: AllergyMismatchHit[] = [];
  for (const a of allergies) {
    // -- Path 1: ATC (mejor señal — concept clínico explícito).
    const allergyAtc = (a.allergenAtcCode ?? "").trim().toUpperCase();
    if (drugAtc.length > 0 && allergyAtc.length > 0 && drugAtc === allergyAtc) {
      hits.push({ allergyId: a.id, severity: a.severity, matchedBy: "atc" });
      continue;
    }

    // -- Path 2: Nombre — substring bidireccional case-insensitive.
    const text = (a.substanceText ?? "").trim().toLowerCase();
    if (text.length < 3) continue;

    const nameMatch =
      (drugGeneric.length > 0 &&
        (drugGeneric.includes(text) || text.includes(drugGeneric))) ||
      (drugBrand.length > 0 &&
        (drugBrand.includes(text) || text.includes(drugBrand)));
    if (nameMatch) {
      hits.push({ allergyId: a.id, severity: a.severity, matchedBy: "name" });
    }
  }
  return hits;
}
