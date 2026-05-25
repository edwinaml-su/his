import { z } from "zod";

export const admissionTypeEnum = z.enum([
  "EMERGENCY",
  "SCHEDULED",
  "TRANSFER_IN",
  "BIRTH",
  "NEWBORN",
]);

export const dischargeTypeEnum = z.enum([
  "MEDICAL",
  "VOLUNTARY",
  "TRANSFER_OUT",
  "ABSCONDED",
  "DEATH",
  "AGAINST_MEDICAL_ADVICE",
]);

/**
 * US-5.1 — Admisión completa.
 *
 * `bedId` es opcional en general, pero el router exige presencia para
 * `SCHEDULED` (programadas siempre conocen la cama de antemano). Para
 * `EMERGENCY` la cama puede asignarse en triage. `BIRTH/NEWBORN` quedan
 * como TODO Sprint 4 (requieren vínculo madre/RN).
 *
 * Campos no persistidos en MVP (chiefComplaint, accompanyingPersonName,
 * valuables, isReferral, referralOrigin) viajan como metadata informativa
 * para el wizard y se reservan en el contrato; persistirán cuando el schema
 * agregue las columnas (Sprint 4 — referrals + custodia de valuables).
 */
export const admitSchema = z.object({
  patientId: z.string().uuid(),
  serviceUnitId: z.string().uuid().optional(),
  patientTypeId: z.string().uuid().optional(),
  patientCategoryId: z.string().uuid().optional(),
  admissionType: admissionTypeEnum,
  admittedAt: z.coerce.date().optional(),
  currencyId: z.string().uuid(),
  /** Cama opcional. Requerida para SCHEDULED. */
  bedId: z.string().uuid().optional(),
  /** Pendiente persistencia en schema (Sprint 4). */
  isReferral: z.boolean().optional(),
  referralOrigin: z.string().max(200).optional(),
  accompanyingPersonName: z.string().max(200).optional(),
  valuables: z.array(z.string().max(200)).max(20).optional(),
  chiefComplaint: z.string().max(500).optional(),
  /** Centro de costo productivo donde se imputa el encuentro. */
  costCenterId: z.string().uuid().optional(),
});

export const transferSchema = z.object({
  encounterId: z.string().uuid(),
  toServiceId: z.string().uuid(),
  fromServiceId: z.string().uuid().optional(),
  fromBedId: z.string().uuid().optional(),
  toBedId: z.string().uuid().optional(),
  reason: z.string().min(2).max(200),
});

export const dischargeSchema = z.object({
  encounterId: z.string().uuid(),
  dischargeType: dischargeTypeEnum,
  dischargedAt: z.coerce.date().optional(),
  primaryDiagnosisId: z.string().uuid().optional(),
});

export const encounterListSchema = z.object({
  patientId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
  status: z.enum(["OPEN", "CLOSED", "ALL"]).default("OPEN"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

/** US-5.1 — listado paginado de encounters abiertos para tablero ADT. */
export const encounterListOpenByOrgSchema = z.object({
  query: z.string().trim().max(120).optional(),
  admissionType: admissionTypeEnum.optional(),
  serviceUnitId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

/** US-5.1 — censo. `at` opcional para snapshots históricos. */
export const encounterCensusSchema = z
  .object({
    at: z.coerce.date().optional(),
    serviceUnitId: z.string().uuid().optional(),
  })
  .optional();

export type AdmitInput = z.infer<typeof admitSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type DischargeInput = z.infer<typeof dischargeSchema>;
export type EncounterListInput = z.infer<typeof encounterListSchema>;
export type EncounterListOpenByOrgInput = z.infer<typeof encounterListOpenByOrgSchema>;
export type EncounterCensusInput = z.infer<typeof encounterCensusSchema>;
