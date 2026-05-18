/**
 * §15 Pharmacy + §16 eMAR — contratos Zod del bounded context `pharmacy` +
 * `prescribing` + `medication-admin`.
 *
 * Implementa ADR-0003 (state machine `Prescription` con three-actor coordination,
 * optimistic locking + pessimistic locks en Dispense/Administer). Cubre las stories
 * US-12.1 ... US-12.6 del backlog Charlie Wave 1 (Team Charlie @PO 2026-05-12).
 *
 * Scope Wave 1 aprobado por @Orq:
 *   - CPOE + validación farmacéutica + dispensación unidosis + eMAR/5R.
 * Excluido (TODO[Wave 2]):
 *   - Mezclas IV, Pyxis/Omnicell, bombas DERS, farmacovigilancia automatizada.
 *   - Lexicomp/Vademecum como fuente de interacciones — Wave 1 usa dataset estático
 *     embebido en `packages/database/seed/drug-interactions.json` (~50 pares ATC).
 *
 * Decisiones de diseño:
 *   - `Prescription` es el agregado raíz. Estados: Drafted, Prescribed, Validated,
 *     Dispensed, Administered (cíclico por dosis), Rejected, Discontinued.
 *   - Las administraciones individuales viven en `AdministrationEvent` con UNIQUE
 *     `(prescriptionLineId, scheduledTime)` para idempotencia (doble-tap seguro).
 *   - 5R: la verificación se hace en el cliente (scan wristband + barcode) y se
 *     valida en el servidor contra el agregado antes de aceptar la transición.
 *   - Doble verificación (two-actor): obligatoria para `HIGH_RISK_ATC_PREFIXES`.
 *   - DNM (controlados): para Wave 1, prescripción forzada a modo papel; el
 *     `controlled_substance_ledger` registra la trazabilidad digital.
 *     TODO[Wave 2 PKI/HSM]: firma reforzada electrónica directa para controlados.
 *   - Hash-chain audit: reusamos la primitiva D-03 de Bravo (`fn_anchor_ehr_audit`
 *     se extiende a `fn_anchor_pharmacy_audit` que escribe en `audit.AuditLog`
 *     con el mismo encadenamiento Merkle).
 */
import { z } from "zod";

// =============================================================================
// Enums del dominio (Wave 1)
// =============================================================================

/** ADR-0003 — estado del agregado `Prescription`. */
export const prescriptionStatusEnum = z.enum([
  "Drafted",
  "Prescribed",
  "Validated",
  "Dispensed",
  "Administered",
  "Rejected",
  "Discontinued",
]);
export type PrescriptionStatus = z.infer<typeof prescriptionStatusEnum>;

/** TDR §15.7 — clase regulatoria de controlado (Drogas No Manipulables / DNM). */
export const controlledClassEnum = z.enum([
  "NONE",
  "II",
  "III",
  "IV",
  "V",
]);
export type ControlledClass = z.infer<typeof controlledClassEnum>;

/** Vía de administración (subset común — extender en Wave 2). */
export const routeEnum = z.enum([
  "VO", // vía oral
  "IV", // intravenoso
  "IM", // intramuscular
  "SC", // subcutáneo
  "SL", // sublingual
  "TOP", // tópico
  "INH", // inhalado
  "REC", // rectal
  "OFT", // oftálmico
  "OTI", // ótico
]);
export type Route = z.infer<typeof routeEnum>;

/** Frecuencia (texto libre validado; el parser de schedule vive en eMAR). */
export const frequencyEnum = z.enum([
  "QD", // cada 24h
  "BID", // c/12h
  "TID", // c/8h
  "QID", // c/6h
  "Q4H", // c/4h
  "Q12H", // c/12h
  "STAT", // dosis única inmediata
  "PRN", // por necesidad
]);
export type Frequency = z.infer<typeof frequencyEnum>;

/** Severidad de interacción (dataset estático). */
export const interactionSeverityEnum = z.enum([
  "minor",
  "moderate",
  "major",
  "contraindicated",
]);
export type InteractionSeverity = z.infer<typeof interactionSeverityEnum>;

/** Motivos de rechazo farmacéutico (US-12.2). */
export const rejectionReasonEnum = z.enum([
  "ALLERGY",
  "INTERACTION",
  "DOSE_OUT_OF_RANGE",
  "ROUTE_INCORRECT",
  "DUPLICATE_THERAPY",
  "OTHER",
]);
export type RejectionReason = z.infer<typeof rejectionReasonEnum>;

/** Razón de discontinuación (US-12.x). */
export const discontinueReasonEnum = z.enum([
  "CLINICAL_RESPONSE_ACHIEVED",
  "ADVERSE_REACTION",
  "PATIENT_REQUEST",
  "ERROR_CORRECTION",
  "OTHER",
]);
export type DiscontinueReason = z.infer<typeof discontinueReasonEnum>;

// =============================================================================
// Catálogo estático de alto riesgo (ISMP — Wave 1 dataset embebido)
// TODO[Wave 2]: trasladar a tabla `high_risk_medication` con vigencia por país.
// =============================================================================

/**
 * Prefijos ATC clasificados como alto riesgo por ISMP (subset Wave 1).
 *   - A10A — Insulinas
 *   - B01A — Anticoagulantes (heparinas, warfarina, DOACs)
 *   - N02A — Opioides
 *   - L01  — Antineoplásicos (quimioterapia)
 *   - C01CA — Vasoactivos adrenérgicos (epinefrina, norepinefrina)
 */
export const HIGH_RISK_ATC_PREFIXES: ReadonlyArray<string> = [
  "A10A",
  "B01A",
  "N02A",
  "L01",
  "C01CA",
];

/** Devuelve true si el código ATC pertenece a la lista de alto riesgo ISMP. */
export function isHighRiskAtc(atcCode: string | null | undefined): boolean {
  if (!atcCode) return false;
  const upper = atcCode.toUpperCase();
  return HIGH_RISK_ATC_PREFIXES.some((p) => upper.startsWith(p));
}

// =============================================================================
// Drug catalog (subset — extender vía catalog router en Wave 2)
// =============================================================================

export const drugSchema = z.object({
  id: z.string().uuid(),
  atcCode: z.string().trim().min(1).max(10), // J01CA04, A10AB05, ...
  name: z.string().trim().min(1).max(200),
  strength: z.string().trim().min(1).max(60), // "500 mg", "10 UI/mL"
  form: z.string().trim().min(1).max(60), // tableta, ampolla, jarabe
  route: routeEnum,
  controlledClass: controlledClassEnum.default("NONE"),
  isHighRisk: z.boolean().default(false),
  /** Familias para chequeo cruzado con alergias (penicilínicos, cefalosporinas, sulfas...). */
  allergyFamilies: z.array(z.string().trim().toLowerCase()).default([]),
  active: z.boolean().default(true),
});
export type Drug = z.infer<typeof drugSchema>;

// =============================================================================
// Prescription inputs / outputs
// =============================================================================

export const prescriptionLineInputSchema = z.object({
  drugId: z.string().uuid(),
  /** Dosis numérica + unidad. Ej. 500 mg → dose=500, doseUnit="mg". */
  dose: z.number().positive().max(10_000),
  doseUnit: z.string().trim().min(1).max(20),
  route: routeEnum,
  frequency: frequencyEnum,
  /** Duración en horas — null = open-ended (TID hasta discontinue). */
  durationHours: z.number().int().positive().max(24 * 90).nullable().default(null),
  /** Instrucciones libres ("tomar con alimentos"). */
  instructions: z.string().trim().max(400).default(""),
});
export type PrescriptionLineInput = z.infer<typeof prescriptionLineInputSchema>;

export const draftPrescriptionInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  lines: z.array(prescriptionLineInputSchema).min(1).max(20),
  /** Notas del prescriptor (justificación clínica). */
  notes: z.string().trim().max(2000).default(""),
});
export type DraftPrescriptionInput = z.infer<typeof draftPrescriptionInput>;

export const signPrescriptionInput = z.object({
  prescriptionId: z.string().uuid(),
  /** Forzar fallback TSA (testing). */
  forceFallbackTsa: z.boolean().optional(),
});
export type SignPrescriptionInput = z.infer<typeof signPrescriptionInput>;

export const validatePrescriptionInput = z.object({
  prescriptionId: z.string().uuid(),
  /** Optimistic locking — debe coincidir con version actual en DB. */
  expectedVersion: z.number().int().min(1),
  /** Checks que el farmacéutico confirma manualmente (interacción, dosis, vía). */
  checks: z.object({
    allergyChecked: z.boolean(),
    interactionChecked: z.boolean(),
    doseChecked: z.boolean(),
    routeChecked: z.boolean(),
    duplicateChecked: z.boolean(),
  }),
  /** Si hay alerta de alergia/interacción, override + motivo justificado. */
  overrideJustification: z.string().trim().max(500).optional(),
});
export type ValidatePrescriptionInput = z.infer<typeof validatePrescriptionInput>;

export const rejectPrescriptionInput = z.object({
  prescriptionId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  reason: rejectionReasonEnum,
  detail: z.string().trim().min(3).max(500),
});
export type RejectPrescriptionInput = z.infer<typeof rejectPrescriptionInput>;

export const dispensationInputSchema = z.object({
  prescriptionId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  lines: z
    .array(
      z.object({
        prescriptionLineId: z.string().uuid(),
        units: z.number().int().positive().max(1000),
        lotNumber: z.string().trim().min(1).max(60),
        /** Vencimiento — primer día del mes (YYYY-MM-01). */
        expiryDate: z.coerce.date(),
      }),
    )
    .min(1),
});
export type DispensationInput = z.infer<typeof dispensationInputSchema>;

/** 5R verificado en bedside (US-12.4). */
export const fiveRightsSchema = z.object({
  /** Escaneo wristband — debe igualar Prescription.patientId (server-side). */
  scannedPatientCode: z.string().trim().min(1),
  /** Barcode del medicamento dispensado — debe coincidir con dispensation. */
  scannedMedicationBarcode: z.string().trim().min(1),
  /** Confirmaciones manuales del enfermero. */
  doseConfirmed: z.boolean(),
  routeConfirmed: z.boolean(),
  /** Hora de administración real (ISO). Debe estar dentro de ±30 min de scheduledTime. */
  administeredAt: z.coerce.date(),
});
export type FiveRights = z.infer<typeof fiveRightsSchema>;

export const administerInputSchema = z.object({
  prescriptionLineId: z.string().uuid(),
  /** Hora programada (slot eMAR). UNIQUE por prescriptionLineId. */
  scheduledTime: z.coerce.date(),
  fiveRights: fiveRightsSchema,
  /** Doble verificación: id del segundo enfermero — requerido si drug.isHighRisk. */
  secondNurseId: z.string().uuid().optional(),
  /** Notas opcionales (efectos adversos observados, etc.). */
  notes: z.string().trim().max(500).optional(),
});
export type AdministerInput = z.infer<typeof administerInputSchema>;

export const discontinueInput = z.object({
  prescriptionId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  reason: discontinueReasonEnum,
  detail: z.string().trim().min(3).max(500),
});
export type DiscontinueInput = z.infer<typeof discontinueInput>;

// ----- DNM ledger (US-12.6) ------------------------------------------------

export const ledgerEntryKindEnum = z.enum([
  "ENTRY_PURCHASE", // ingreso por compra
  "ENTRY_RETURN", // devolución a stock
  "EXIT_PRESCRIPTION", // salida por receta retenida
  "EXIT_LOSS", // merma / vencimiento
  "ADJUSTMENT", // ajuste de inventario
]);
export type LedgerEntryKind = z.infer<typeof ledgerEntryKindEnum>;

export const ledgerEntryInput = z.object({
  drugId: z.string().uuid(),
  kind: ledgerEntryKindEnum,
  units: z.number().int(),
  lotNumber: z.string().trim().min(1).max(60),
  /** Documento soporte (OC, foto de receta retenida, etc.). */
  documentRef: z.string().trim().min(1).max(200),
  /** Si es EXIT_PRESCRIPTION, FK opcional al paciente. */
  patientId: z.string().uuid().optional(),
  /** Notas libres. */
  notes: z.string().trim().max(500).optional(),
});
export type LedgerEntryInput = z.infer<typeof ledgerEntryInput>;

// ----- Outputs / DTOs ------------------------------------------------------

export const prescriptionLineDtoSchema = z.object({
  id: z.string().uuid(),
  drugId: z.string().uuid(),
  drugName: z.string(),
  atcCode: z.string(),
  dose: z.number(),
  doseUnit: z.string(),
  route: routeEnum,
  frequency: frequencyEnum,
  durationHours: z.number().int().nullable(),
  instructions: z.string(),
  isHighRisk: z.boolean(),
  controlledClass: controlledClassEnum,
});
export type PrescriptionLineDto = z.infer<typeof prescriptionLineDtoSchema>;

export const dispensationDtoSchema = z.object({
  id: z.string().uuid(),
  prescriptionLineId: z.string().uuid(),
  units: z.number().int(),
  lotNumber: z.string(),
  expiryDate: z.coerce.date(),
  itemBarcode: z.string(),
  dispensedAt: z.coerce.date(),
  dispensedById: z.string().uuid(),
});
export type DispensationDto = z.infer<typeof dispensationDtoSchema>;

export const administrationDtoSchema = z.object({
  id: z.string().uuid(),
  prescriptionLineId: z.string().uuid(),
  scheduledTime: z.coerce.date(),
  administeredAt: z.coerce.date(),
  administeredById: z.string().uuid(),
  secondNurseId: z.string().uuid().nullable(),
  doubleVerified: z.boolean(),
  fiveRightsOk: z.boolean(),
  notes: z.string().nullable(),
});
export type AdministrationDto = z.infer<typeof administrationDtoSchema>;

export const prescriptionDtoSchema = z.object({
  id: z.string().uuid(),
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  prescriberId: z.string().uuid(),
  prescriberName: z.string().nullable(),
  status: prescriptionStatusEnum,
  version: z.number().int().min(1),
  notes: z.string(),
  signedAt: z.coerce.date().nullable(),
  signatureRef: z.string().nullable(),
  signatureProvider: z.string().nullable(),
  validatedAt: z.coerce.date().nullable(),
  validatedById: z.string().uuid().nullable(),
  rejectedAt: z.coerce.date().nullable(),
  rejectionReason: rejectionReasonEnum.nullable(),
  rejectionDetail: z.string().nullable(),
  discontinuedAt: z.coerce.date().nullable(),
  auditEntryId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  lines: z.array(prescriptionLineDtoSchema).default([]),
  dispensations: z.array(dispensationDtoSchema).default([]),
  administrations: z.array(administrationDtoSchema).default([]),
});
export type PrescriptionDto = z.infer<typeof prescriptionDtoSchema>;

// =============================================================================
// State machine — transiciones y guards (ADR-0003)
// =============================================================================

/**
 * Mapa de transiciones permitidas. La fuente de verdad: ADR-0003.
 * Estados terminales: Rejected, Discontinued.
 */
export const PRESCRIPTION_TRANSITIONS: Record<
  PrescriptionStatus,
  ReadonlyArray<PrescriptionStatus>
> = {
  Drafted: ["Prescribed"],
  Prescribed: ["Validated", "Rejected", "Discontinued"],
  Validated: ["Dispensed", "Discontinued"],
  Dispensed: ["Administered", "Discontinued"],
  Administered: ["Administered", "Discontinued"], // cíclico por dosis
  Rejected: [],
  Discontinued: [],
};

/** Verifica si una transición es legal en la state machine. */
export function canTransition(
  from: PrescriptionStatus,
  to: PrescriptionStatus,
): boolean {
  return PRESCRIPTION_TRANSITIONS[from].includes(to);
}

/** Error tipado emitido por los guards. */
export class PharmacyGuardError extends Error {
  public readonly guard: string;
  public readonly detail: string;
  constructor(guard: string, detail: string) {
    super(`[${guard}] ${detail}`);
    this.guard = guard;
    this.detail = detail;
    this.name = "PharmacyGuardError";
  }
}

// ----- Guard: DNM / controlados (US-12.1) ----------------------------------

/**
 * Bloquea la firma electrónica de prescripciones de psicotrópicos clase II/III/IV.
 * Wave 1: la prescripción de controlados se hace en modo papel + entrada en
 * `controlled_substance_ledger`. TODO[Wave 2 PKI/HSM]: firma reforzada electrónica.
 */
export function guardControlledSubstanceRequiresPaper(
  drugs: ReadonlyArray<Pick<Drug, "atcCode" | "controlledClass" | "name">>,
): { ok: true } | { ok: false; reason: string; drugName: string } {
  const controlled = drugs.find(
    (d) => d.controlledClass !== "NONE" && d.controlledClass !== "V",
  );
  if (controlled) {
    return {
      ok: false,
      reason:
        "Prescripción de controlados (clase II/III/IV) requiere recetario verde/retenido — registre en modo papel.",
      drugName: controlled.name,
    };
  }
  return { ok: true };
}

// ----- Guard: alergia + interacción (US-12.2) ------------------------------

export interface AllergyAlert {
  patientAllergyId: string;
  substanceText: string;
  family: string | null;
  severity: string;
  drugId: string;
  drugName: string;
}

export interface InteractionAlert {
  drugIdA: string;
  drugIdB: string;
  severity: InteractionSeverity;
  description: string;
}

/**
 * Cruza líneas de la prescripción contra alergias activas del paciente.
 * Se considera match si:
 *   - `drug.name` o `drug.atcCode` aparece en `substanceText` (case-insensitive), o
 *   - alguna `drug.allergyFamilies` aparece en `substanceText`.
 */
export function detectAllergyAlerts(
  drugs: ReadonlyArray<Pick<Drug, "id" | "name" | "atcCode" | "allergyFamilies">>,
  allergies: ReadonlyArray<{
    id: string;
    substanceText: string;
    severity: string;
    active: boolean;
  }>,
): AllergyAlert[] {
  const active = allergies.filter((a) => a.active);
  const alerts: AllergyAlert[] = [];
  for (const drug of drugs) {
    const drugTokens = [
      drug.name.toLowerCase(),
      drug.atcCode.toLowerCase(),
      ...drug.allergyFamilies.map((f) => f.toLowerCase()),
    ];
    for (const a of active) {
      const sub = a.substanceText.toLowerCase();
      const matchToken = drugTokens.find(
        (t) => sub.includes(t) || t.includes(sub),
      );
      if (matchToken) {
        alerts.push({
          patientAllergyId: a.id,
          substanceText: a.substanceText,
          family: matchToken,
          severity: a.severity,
          drugId: drug.id,
          drugName: drug.name,
        });
      }
    }
  }
  return alerts;
}

/**
 * Cruza pares de fármacos contra el dataset estático de interacciones.
 * Devuelve `major` y `contraindicated` como bloqueantes (a menos que haya override).
 */
export function detectInteractionAlerts(
  drugs: ReadonlyArray<Pick<Drug, "id" | "atcCode">>,
  dataset: ReadonlyArray<{
    atcA: string;
    atcB: string;
    severity: InteractionSeverity;
    description: string;
  }>,
): InteractionAlert[] {
  const alerts: InteractionAlert[] = [];
  for (let i = 0; i < drugs.length; i++) {
    for (let j = i + 1; j < drugs.length; j++) {
      const a = drugs[i];
      const b = drugs[j];
      const hit = dataset.find(
        (row) =>
          (a.atcCode.startsWith(row.atcA) && b.atcCode.startsWith(row.atcB)) ||
          (a.atcCode.startsWith(row.atcB) && b.atcCode.startsWith(row.atcA)),
      );
      if (hit) {
        alerts.push({
          drugIdA: a.id,
          drugIdB: b.id,
          severity: hit.severity,
          description: hit.description,
        });
      }
    }
  }
  return alerts;
}

/**
 * Combina alertas de alergia e interacción. Bloquea Validated si hay alergia
 * activa o interacción mayor/contraindicada SIN override.
 */
export function guardInteractionAndAllergyClear(params: {
  allergyAlerts: ReadonlyArray<AllergyAlert>;
  interactionAlerts: ReadonlyArray<InteractionAlert>;
  overrideJustification?: string;
}): { ok: true } | { ok: false; reason: string } {
  const blocking =
    params.allergyAlerts.length > 0 ||
    params.interactionAlerts.some(
      (i) => i.severity === "major" || i.severity === "contraindicated",
    );

  if (!blocking) return { ok: true };

  if (!params.overrideJustification || params.overrideJustification.length < 5) {
    const parts: string[] = [];
    if (params.allergyAlerts.length > 0) {
      parts.push(
        `Alergia activa: ${params.allergyAlerts
          .map((a) => `${a.drugName} ↔ ${a.substanceText}`)
          .join(", ")}`,
      );
    }
    const major = params.interactionAlerts.filter(
      (i) => i.severity === "major" || i.severity === "contraindicated",
    );
    if (major.length > 0) {
      parts.push(
        `Interacciones: ${major
          .map((i) => `${i.severity} — ${i.description}`)
          .join(", ")}`,
      );
    }
    return {
      ok: false,
      reason: parts.join(" | "),
    };
  }
  return { ok: true };
}

// ----- Guard: 5R (US-12.4) -------------------------------------------------

export interface FiveRightsContext {
  patientCode: string; // pulsera oficial del paciente (E5)
  medicationBarcode: string; // barcode de dispensación
  scheduledTime: Date;
  expectedRoute: Route;
  expectedDose: number;
}

/**
 * Valida los 5 derechos (Right Patient, Drug, Dose, Route, Time).
 * - Paciente: scanned == expected (constante).
 * - Medicamento: scanned == expected (constante).
 * - Dosis: enfermero confirma manualmente (UI ya pre-cargó dose).
 * - Vía: enfermero confirma manualmente (UI ya pre-cargó route).
 * - Hora: administeredAt dentro de ±30 min de scheduledTime (TDR §16.3).
 */
export function guardFiveRights(
  input: FiveRights,
  ctx: FiveRightsContext,
): { ok: true } | { ok: false; reason: string; failedRight: string } {
  if (input.scannedPatientCode.trim() !== ctx.patientCode.trim()) {
    return {
      ok: false,
      failedRight: "patient",
      reason: "ERROR 5R: paciente incorrecto (mismatch wristband).",
    };
  }
  if (
    input.scannedMedicationBarcode.trim() !== ctx.medicationBarcode.trim()
  ) {
    return {
      ok: false,
      failedRight: "medication",
      reason: "ERROR 5R: medicamento incorrecto (mismatch barcode).",
    };
  }
  if (!input.doseConfirmed) {
    return {
      ok: false,
      failedRight: "dose",
      reason: "ERROR 5R: dosis no confirmada.",
    };
  }
  if (!input.routeConfirmed) {
    return {
      ok: false,
      failedRight: "route",
      reason: "ERROR 5R: vía no confirmada.",
    };
  }
  const deltaMin =
    Math.abs(input.administeredAt.getTime() - ctx.scheduledTime.getTime()) /
    60_000;
  if (deltaMin > 30) {
    return {
      ok: false,
      failedRight: "time",
      reason: `ERROR 5R: fuera de ventana (Δ=${deltaMin.toFixed(0)} min, máx 30).`,
    };
  }
  return { ok: true };
}

// ----- Guard: doble verificación (US-12.5) ---------------------------------

/**
 * Si el fármaco es alto riesgo, exige un segundo enfermero distinto del primero.
 * El segundo debe estar autenticado (se valida en el router contra ctx.user).
 */
export function guardDoubleVerification(params: {
  isHighRisk: boolean;
  firstNurseId: string;
  secondNurseId?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!params.isHighRisk) return { ok: true };
  if (!params.secondNurseId) {
    return {
      ok: false,
      reason:
        "Medicamento de alto riesgo (ISMP): se requiere segunda verificación por otro enfermero.",
    };
  }
  if (params.secondNurseId === params.firstNurseId) {
    return {
      ok: false,
      reason:
        "El verificador debe ser un profesional distinto al primer enfermero.",
    };
  }
  return { ok: true };
}

// ----- Helpers de barcode / canonicalización -------------------------------

/**
 * Genera un barcode determinístico para un item dispensado.
 * Formato: `M-{ATC}-{LOT}-{seq}` (longitud ≤ 60). Wave 2: GS1 DataMatrix.
 * TODO[Wave 2]: GS1-128 con AI (01 GTIN, 17 expiry, 10 lot, 21 serial).
 */
export function buildItemBarcode(
  atcCode: string,
  lotNumber: string,
  sequence: number,
): string {
  const atc = atcCode.replace(/[^A-Z0-9]/gi, "").slice(0, 10).toUpperCase();
  const lot = lotNumber.replace(/[^A-Z0-9-]/gi, "").slice(0, 20).toUpperCase();
  return `M-${atc}-${lot}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Hash payload determinístico de Prescription para anclar al hash-chain.
 * Mantiene el mismo formato que `canonicalizeSoapPayload` (JSON estable).
 */
export function canonicalizePrescriptionPayload(params: {
  prescriptionId: string;
  status: PrescriptionStatus;
  version: number;
  lines: ReadonlyArray<{
    drugId: string;
    dose: number;
    doseUnit: string;
    route: Route;
    frequency: Frequency;
  }>;
}): string {
  const sortedLines = [...params.lines]
    .map((l) => ({
      drugId: l.drugId,
      dose: l.dose,
      doseUnit: l.doseUnit.trim(),
      route: l.route,
      frequency: l.frequency,
    }))
    .sort((a, b) => a.drugId.localeCompare(b.drugId));
  return JSON.stringify({
    prescriptionId: params.prescriptionId,
    status: params.status,
    version: params.version,
    lines: sortedLines,
  });
}

// ----- Inputs de queries ---------------------------------------------------

export const listPrescriptionsInput = z.object({
  status: prescriptionStatusEnum.optional(),
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type ListPrescriptionsInput = z.infer<typeof listPrescriptionsInput>;

export const getPrescriptionInput = z.object({
  prescriptionId: z.string().uuid(),
});

export const validationQueueInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const emarQueueInput = z.object({
  /** Próximas N horas a mostrar (default 8). */
  windowHours: z.number().int().min(1).max(24).default(8),
  /** Filtrar por unidad asistencial. */
  serviceUnitId: z.string().uuid().optional(),
});

// =============================================================================
// Dataset estático de interacciones (TIPADO — los datos viven en seed JSON)
// =============================================================================

export const drugInteractionDatasetEntry = z.object({
  atcA: z.string().trim().min(2).max(10),
  atcB: z.string().trim().min(2).max(10),
  severity: interactionSeverityEnum,
  description: z.string().trim().min(3).max(400),
  /** Origen del dato (siempre "stub-wave1" en Wave 1). */
  source: z.literal("stub-wave1"),
});
export type DrugInteractionDatasetEntry = z.infer<
  typeof drugInteractionDatasetEntry
>;

// =============================================================================
// US.F2.6.10 — Cross-check alergias paciente vs GTIN (principio activo + excipiente)
// =============================================================================

/** Input del chequeo: paciente + drug identificado por id (GTIN resuelto por caller). */
export const checkAllergiesInput = z.object({
  patientId: z.string().uuid(),
  /** UUID del Drug en catálogo (resuelto desde el GTIN escaneado por el caller). */
  drugId: z.string().uuid(),
  /**
   * GTIN escaneado en bedside — almacenado en audit_log para trazabilidad.
   * Formato GS1-14 (14 dígitos numéricos). Opcional hasta que MedicationGtin
   * sea implementado completamente (Stream 01).
   */
  gtin: z.string().regex(/^\d{14}$/, "GTIN debe ser 14 dígitos numéricos").optional(),
});
export type CheckAllergiesInput = z.infer<typeof checkAllergiesInput>;

/** Severidad del resultado del cross-check. */
export const allergyCheckStatusEnum = z.enum(["ok", "warning", "hardStop"]);
export type AllergyCheckStatus = z.infer<typeof allergyCheckStatusEnum>;

/** Una coincidencia individual de alergia vs componente del medicamento. */
export const allergyCheckMatchSchema = z.object({
  /** Texto del componente que coincidió (principio activo o excipiente). */
  component: z.string(),
  /** Tipo de componente. */
  type: z.enum(["activeIngredient", "excipient"]),
  /** Texto del perfil de alergia del paciente que generó el match. */
  patientAllergyText: z.string(),
  /** ID de la entrada PatientAllergy o AllergyIntolerance. */
  allergyId: z.string().uuid(),
  severity: z.string(), // mild | moderate | severe | life-threatening
});
export type AllergyCheckMatch = z.infer<typeof allergyCheckMatchSchema>;

/** Resultado del cross-check. */
export const allergyCheckResultSchema = z.object({
  status: allergyCheckStatusEnum,
  /** Matches que motivaron el status (vacío si ok). */
  matches: z.array(allergyCheckMatchSchema),
  drugId: z.string().uuid(),
  drugName: z.string(),
});
export type AllergyCheckResult = z.infer<typeof allergyCheckResultSchema>;

/**
 * Ejecuta el cross-check principio activo + excipiente.
 *
 * - activeIngredients: `drug.allergyFamilies` (tokens ATC/familia — "penicilina", etc.)
 * - excipients: `drug.allergyExcipients` (tartrazina, lactosa, gluten, etc.)
 * - Allergies: concatenación de PatientAllergy.substanceText (v1) +
 *   AllergyIntolerance.substanceDisplay (v2).
 *
 * Hard stop: cualquier match en activeIngredients.
 * Warning: cualquier match en excipients (sin match previo en activos).
 */
export function evaluateAllergyCheck(
  drug: {
    id: string;
    name: string;
    allergyFamilies: string[];
    allergyExcipients: string[];
  },
  allergies: ReadonlyArray<{ id: string; substanceText: string; severity: string; active: boolean }>,
  allergyIntolerances: ReadonlyArray<{ id: string; substanceDisplay: string; criticality: string; clinicalStatus: string }>,
): AllergyCheckResult {
  // Construye lista plana de alergias activas con texto normalizado.
  const activeAllergies: Array<{ id: string; text: string; severity: string }> = [
    ...allergies
      .filter((a) => a.active)
      .map((a) => ({ id: a.id, text: a.substanceText.toLowerCase(), severity: a.severity })),
    ...allergyIntolerances
      .filter((ai) => ai.clinicalStatus === "active")
      .map((ai) => ({ id: ai.id, text: ai.substanceDisplay.toLowerCase(), severity: ai.criticality })),
  ];

  const matches: AllergyCheckMatch[] = [];

  // 1) Chequeo de principios activos (allergyFamilies → Hard Stop).
  for (const family of drug.allergyFamilies) {
    const token = family.toLowerCase();
    for (const allergy of activeAllergies) {
      if (allergy.text.includes(token) || token.includes(allergy.text)) {
        matches.push({
          component: family,
          type: "activeIngredient",
          patientAllergyText: allergy.text,
          allergyId: allergy.id,
          severity: allergy.severity,
        });
      }
    }
  }

  if (matches.length > 0) {
    return { status: "hardStop", matches, drugId: drug.id, drugName: drug.name };
  }

  // 2) Chequeo de excipientes (allergyExcipients → Warning).
  for (const excipient of drug.allergyExcipients) {
    const token = excipient.toLowerCase();
    for (const allergy of activeAllergies) {
      if (allergy.text.includes(token) || token.includes(allergy.text)) {
        matches.push({
          component: excipient,
          type: "excipient",
          patientAllergyText: allergy.text,
          allergyId: allergy.id,
          severity: allergy.severity,
        });
      }
    }
  }

  if (matches.length > 0) {
    return { status: "warning", matches, drugId: drug.id, drugName: drug.name };
  }

  return { status: "ok", matches: [], drugId: drug.id, drugName: drug.name };
}
