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
