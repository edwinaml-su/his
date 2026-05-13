/**
 * §15 Pharmacy — schemas de input + helpers de business rules.
 *
 * Beta.2 hardening (2026-05-13):
 * - State machine validada (DRAFT → SIGNED → DISPENSED|PARTIALLY_DISPENSED).
 * - Helpers puros: detectInteractionAlerts, sortLotsByFEFO, validateLotExpiry,
 *   isControlledDispensingClass, isHighRiskDrug.
 * - Tipos para interaction dataset y alert severity (prefijo Pharmacy para
 *   no colisionar con LIS/Inpatient).
 */
import { z } from "zod";

const PHARM_FORM = [
  "TABLET",
  "CAPSULE",
  "SYRUP",
  "INJECTION",
  "CREAM",
  "OINTMENT",
  "DROPS",
  "INHALER",
  "SUPPOSITORY",
  "PATCH",
  "OTHER",
] as const;

const DISPENSING_CLASS = ["OTC", "RX", "RX_CONTROLLED"] as const;

const ADMIN_ROUTE = [
  "ORAL",
  "IV",
  "IM",
  "SC",
  "TOPICAL",
  "INHALED",
  "RECTAL",
  "SUBLINGUAL",
  "OPHTHALMIC",
  "OTIC",
  "NASAL",
] as const;

export const pharmaceuticalFormEnum = z.enum(PHARM_FORM);
export const dispensingClassEnum = z.enum(DISPENSING_CLASS);
export const adminRouteEnum = z.enum(ADMIN_ROUTE);

export const drugListInput = z.object({
  search: z.string().trim().max(120).optional(),
  dispensingClass: dispensingClassEnum.optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const drugCreateInput = z.object({
  organizationId: z.string().uuid().nullable().default(null),
  genericName: z.string().trim().min(1).max(200),
  brandName: z.string().trim().max(200).optional(),
  atcCode: z.string().trim().max(20).optional(),
  pharmaceuticalForm: pharmaceuticalFormEnum,
  strengthValue: z.number().positive(),
  strengthUnit: z.string().trim().min(1).max(20),
  dispensingClass: dispensingClassEnum.default("RX"),
  requiresControlledLog: z.boolean().default(false),
});

export const prescriptionItemInput = z.object({
  drugId: z.string().uuid(),
  dosage: z.string().trim().min(1).max(120),
  route: adminRouteEnum,
  frequency: z.string().trim().min(1).max(80),
  durationDays: z.number().int().min(1).max(365).optional(),
  prnAsNeeded: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional(),
});

export const prescriptionCreateInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  notes: z.string().trim().max(4000).optional(),
  items: z.array(prescriptionItemInput).min(1).max(50),
});

export const prescriptionSignInput = z.object({
  id: z.string().uuid(),
});

export const prescriptionListInput = z.object({
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  prescriberId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const dispenseCreateInput = z.object({
  prescriptionItemId: z.string().uuid(),
  quantity: z.number().positive(),
  batchNumber: z.string().trim().max(80).optional(),
  expiryDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type DrugListInput = z.infer<typeof drugListInput>;
export type DrugCreateInput = z.infer<typeof drugCreateInput>;
export type PrescriptionCreateInput = z.infer<typeof prescriptionCreateInput>;
export type PrescriptionSignInput = z.infer<typeof prescriptionSignInput>;
export type PrescriptionListInput = z.infer<typeof prescriptionListInput>;
export type DispenseCreateInput = z.infer<typeof dispenseCreateInput>;

// ---------------------------------------------------------------------------
// Beta.2 hardening — types
// ---------------------------------------------------------------------------

export type PharmacyAlertSeverity = "minor" | "moderate" | "major" | "contraindicated";

export interface DrugInteractionEntry {
  atcA: string;
  atcB: string;
  severity: PharmacyAlertSeverity;
  description: string;
}

export interface PharmacyInteractionAlert {
  atcA: string;
  atcB: string;
  drugAName?: string | null;
  drugBName?: string | null;
  severity: PharmacyAlertSeverity;
  description: string;
}

export interface PharmacyLotInfo {
  lotNumber: string;
  expiryDate: Date;
  stockQuantity: number;
}

// ---------------------------------------------------------------------------
// Beta.2 helpers — interacciones medicamentosas
// ---------------------------------------------------------------------------

/**
 * Detecta interacciones entre los fármacos de una prescripción cruzando contra
 * el dataset (Wave 1: JSON estático). Cubre tanto pares (atcA,atcB) como
 * (atcB,atcA) — orden indiferente.
 */
export function detectInteractionAlerts(
  drugsInPrescription: Array<{ atcCode: string | null | undefined; name?: string | null }>,
  dataset: DrugInteractionEntry[],
): PharmacyInteractionAlert[] {
  const alerts: PharmacyInteractionAlert[] = [];
  const drugs = drugsInPrescription
    .map((d) => ({
      atcCode: (d.atcCode ?? "").trim().toUpperCase(),
      name: d.name ?? null,
    }))
    .filter((d) => d.atcCode.length > 0);

  if (drugs.length < 2) return alerts;

  for (let i = 0; i < drugs.length; i++) {
    for (let j = i + 1; j < drugs.length; j++) {
      const a = drugs[i]!;
      const b = drugs[j]!;
      for (const entry of dataset) {
        const aa = entry.atcA.trim().toUpperCase();
        const bb = entry.atcB.trim().toUpperCase();
        if (
          (a.atcCode === aa && b.atcCode === bb) ||
          (a.atcCode === bb && b.atcCode === aa)
        ) {
          alerts.push({
            atcA: a.atcCode,
            atcB: b.atcCode,
            drugAName: a.name,
            drugBName: b.name,
            severity: entry.severity,
            description: entry.description,
          });
        }
      }
    }
  }
  return alerts;
}

/** Helper — true si el alert dataset contiene un major o contraindicated entre la lista. */
export function hasBlockingInteraction(alerts: PharmacyInteractionAlert[]): boolean {
  return alerts.some((a) => a.severity === "major" || a.severity === "contraindicated");
}

// ---------------------------------------------------------------------------
// Beta.2 helpers — stock / FEFO / lot
// ---------------------------------------------------------------------------

/**
 * Ordena lotes por FEFO (First Expire, First Out). Lotes sin expiryDate van
 * al final. Lotes expirados se filtran si filterExpired=true.
 */
export function sortLotsByFEFO<T extends { expiryDate: Date | null | undefined; stockQuantity: number }>(
  lots: T[],
  options: { now?: Date; filterExpired?: boolean } = {},
): T[] {
  const now = options.now ?? new Date();
  const filtered = options.filterExpired
    ? lots.filter((l) => l.expiryDate && l.expiryDate > now)
    : lots;
  return [...filtered].sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return 0;
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate.getTime() - b.expiryDate.getTime();
  });
}

/**
 * Valida si un lote puede dispensarse: no expirado y con stock suficiente.
 * Retorna objeto con `ok` y `reason` legible.
 */
export function validateLotForDispense(
  lot: { expiryDate: Date | null | undefined; stockQuantity: number; lotNumber: string },
  quantityRequested: number,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (!lot.expiryDate) {
    return { ok: false, reason: `Lote ${lot.lotNumber} sin fecha de expiración. No se permite dispensar.` };
  }
  if (lot.expiryDate <= now) {
    return {
      ok: false,
      reason: `Lote ${lot.lotNumber} expirado (${lot.expiryDate.toISOString().slice(0, 10)}). No se permite dispensar.`,
    };
  }
  if (quantityRequested <= 0) {
    return { ok: false, reason: `Cantidad debe ser positiva (recibida ${quantityRequested}).` };
  }
  if (lot.stockQuantity < quantityRequested) {
    return {
      ok: false,
      reason: `Stock insuficiente en lote ${lot.lotNumber}: disponible ${lot.stockQuantity}, solicitado ${quantityRequested}.`,
    };
  }
  return { ok: true };
}

/**
 * Plan de dispensación FEFO: asigna cantidades a múltiples lotes en orden de
 * vencimiento. Útil cuando un solo lote no cubre la cantidad solicitada.
 */
export interface DispensePlanEntry<T> {
  lot: T;
  takeQuantity: number;
}

export function planFefoDispense<T extends { expiryDate: Date | null | undefined; stockQuantity: number; lotNumber: string }>(
  lots: T[],
  quantityRequested: number,
  now: Date = new Date(),
):
  | { ok: true; plan: DispensePlanEntry<T>[]; totalAvailable: number }
  | { ok: false; reason: string; totalAvailable: number } {
  const sorted = sortLotsByFEFO(lots, { now, filterExpired: true });
  const totalAvailable = sorted.reduce((s, l) => s + l.stockQuantity, 0);
  if (quantityRequested <= 0) {
    return { ok: false, reason: `Cantidad debe ser positiva.`, totalAvailable };
  }
  if (totalAvailable < quantityRequested) {
    return {
      ok: false,
      reason: `Stock total insuficiente: disponible ${totalAvailable}, solicitado ${quantityRequested}.`,
      totalAvailable,
    };
  }
  const plan: DispensePlanEntry<T>[] = [];
  let remaining = quantityRequested;
  for (const lot of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(lot.stockQuantity, remaining);
    plan.push({ lot, takeQuantity: take });
    remaining -= take;
  }
  return { ok: true, plan, totalAvailable };
}

// ---------------------------------------------------------------------------
// Beta.2 helpers — clase regulatoria
// ---------------------------------------------------------------------------

/** True si el dispensingClass requiere libro de control (RX_CONTROLLED). */
export function isControlledDispensingClass(cls: string): boolean {
  return cls === "RX_CONTROLLED";
}

/**
 * Lista ISMP High Risk Medications (simplificada Wave 1, prefijos ATC).
 * Wave 2 reemplazará con lista oficial completa por país.
 */
const ISMP_HIGH_RISK_ATC_PREFIXES = [
  "A10A", // Insulinas
  "B01AA", // Antagonistas de Vit K (Warfarina)
  "B01AB", // Heparinas
  "B01AC", // Antiagregantes plaquetarios
  "C01BA", // Antiarrítmicos clase IA
  "C01BC", // Antiarrítmicos clase IC
  "C01BD", // Antiarrítmicos clase III (Amiodarona)
  "N01AB", // Anestésicos halogenados
  "N02A", // Opioides
  "N05CD", // Hipnóticos benzodiazepínicos
  "L01", // Quimioterapia
] as const;

export function isHighRiskAtc(atcCode: string | null | undefined): boolean {
  if (!atcCode) return false;
  const upper = atcCode.toUpperCase();
  return ISMP_HIGH_RISK_ATC_PREFIXES.some((p) => upper.startsWith(p));
}

// ---------------------------------------------------------------------------
// Beta.2 helpers — state machine
// ---------------------------------------------------------------------------

const PRESCRIPTION_STATE_TRANSITIONS = {
  DRAFT: ["SIGNED", "CANCELLED"] as const,
  SIGNED: ["DISPENSED", "PARTIALLY_DISPENSED", "CANCELLED", "EXPIRED"] as const,
  PARTIALLY_DISPENSED: ["DISPENSED", "CANCELLED", "EXPIRED"] as const,
  DISPENSED: [] as const,
  CANCELLED: [] as const,
  EXPIRED: [] as const,
} as const;

export type PrescriptionStatusType = keyof typeof PRESCRIPTION_STATE_TRANSITIONS;

export function canTransitionPrescription(
  from: PrescriptionStatusType,
  to: PrescriptionStatusType,
): boolean {
  return (PRESCRIPTION_STATE_TRANSITIONS[from] as readonly PrescriptionStatusType[]).includes(to);
}

export function isTerminalPrescriptionStatus(
  status: PrescriptionStatusType,
): boolean {
  return PRESCRIPTION_STATE_TRANSITIONS[status].length === 0;
}
