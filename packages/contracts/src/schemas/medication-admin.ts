/**
 * §16 eMAR (Electronic Medication Administration Record) — schemas de input.
 * Skeleton mínimo. Validaciones de BCMA, anti-bypass de scan y reglas de
 * doble-check para medicamentos de alto riesgo (HMR) viven en el router.
 */
import { z } from "zod";

const MED_ADMIN_STATUS = [
  "GIVEN",
  "HELD",
  "REFUSED",
  "MISSED",
  "DOCUMENTED_LATE",
] as const;

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

export const medAdminStatusEnum = z.enum(MED_ADMIN_STATUS);
export const medAdminRouteEnum = z.enum(ADMIN_ROUTE);

export type MedAdminStatusType = z.infer<typeof medAdminStatusEnum>;

export const medicationAdministrationRecordInput = z.object({
  prescriptionItemId: z.string().uuid(),
  status: medAdminStatusEnum.default("GIVEN"),
  doseAmount: z.number().positive().optional(),
  doseUnit: z.string().trim().max(20).optional(),
  route: medAdminRouteEnum.optional(),
  site: z.string().trim().max(80).optional(),
  barcodeScannedAt: z.coerce.date().optional(),
  patientWristbandScanned: z.boolean().default(false),
  doubleCheckById: z.string().uuid().optional(),
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
