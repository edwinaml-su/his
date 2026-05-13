/**
 * §25 Insurer Agreements — schemas de input (Wave 8 / Beta.14 hardening layer 1).
 *
 * Cambios b14:
 *   - PENDING añadido al estado canónico de la state machine.
 *   - coveredProcedures JSONB — schema de validación + helper de parsing.
 *   - checkCoverageInput / checkCoverageOutput — contrato para isProcedureCovered.
 *   - getExpiringAuthorizationsInput — contrato para expiry alerts.
 */
import { z } from "zod";

const INSURER_KIND = ["PUBLIC", "PRIVATE", "SELF_INSURED"] as const;

// b14: PENDING = canonical start state; REQUESTED kept for backward compat.
const AUTHORIZATION_STATUS = [
  "PENDING",
  "REQUESTED",
  "APPROVED",
  "PARTIAL",
  "DENIED",
  "EXPIRED",
  "CANCELLED",
] as const;

export const insurerKindEnum = z.enum(INSURER_KIND);
export const authorizationStatusEnum = z.enum(AUTHORIZATION_STATUS);

export type InsurerKindType = z.infer<typeof insurerKindEnum>;
export type AuthorizationStatusType = z.infer<typeof authorizationStatusEnum>;

// ---------------------------------------------------------------------------
// coveredProcedures JSONB entry
// ---------------------------------------------------------------------------

/** Un procedimiento cubierto dentro del JSONB de InsurancePlan. */
export const coveredProcedureEntry = z.object({
  code: z.string().trim().min(1).max(40),
  maxCoverage: z.number().min(0).optional(), // null = sin límite monetario explícito.
  description: z.string().trim().max(200).optional(),
});

export type CoveredProcedureEntry = z.infer<typeof coveredProcedureEntry>;

// ---------------------------------------------------------------------------
// Insurer (catálogo)
// ---------------------------------------------------------------------------

export const insurerCreateInput = z.object({
  /** null = catálogo global; sólo service_role debería poder enviarlo. */
  organizationId: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  taxId: z.string().trim().max(40).optional(),
  kind: insurerKindEnum.default("PRIVATE"),
  contactPhone: z.string().trim().max(40).optional(),
  contactEmail: z.string().trim().email().max(200).optional(),
});

export const insurerListInput = z.object({
  activeOnly: z.boolean().default(true),
  kind: insurerKindEnum.optional(),
  search: z.string().trim().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// InsurancePlan
// ---------------------------------------------------------------------------

export const insurancePlanCreateInput = z.object({
  insurerId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(400).optional(),
  copayPct: z.number().min(0).max(100).optional(),
  coveredProcedures: z.array(coveredProcedureEntry).optional(),
});

export const insurancePlanListInput = z.object({
  insurerId: z.string().uuid().optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// PatientCoverage
// ---------------------------------------------------------------------------

export const patientCoverageCreateInput = z
  .object({
    patientId: z.string().uuid(),
    planId: z.string().uuid(),
    policyNumber: z.string().trim().min(1).max(80),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date().optional(),
  })
  .refine((d) => !d.validTo || d.validTo > d.validFrom, {
    message: "validTo debe ser posterior a validFrom",
    path: ["validTo"],
  });

export const patientCoverageListInput = z.object({
  patientId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const patientCoverageDeactivateInput = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// AuthorizationRequest
// ---------------------------------------------------------------------------

export const authorizationRequestCreateInput = z.object({
  coverageId: z.string().uuid(),
  encounterId: z.string().uuid().optional(),
  serviceCode: z.string().trim().min(1).max(40),
  serviceDesc: z.string().trim().min(1).max(400),
});

export const authorizationRequestListInput = z.object({
  coverageId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
  status: authorizationStatusEnum.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const authorizationApproveInput = z
  .object({
    id: z.string().uuid(),
    externalRef: z.string().trim().min(1).max(80),
    approvedAmount: z.number().min(0).optional(),
    partial: z.boolean().default(false),
    validFrom: z.coerce.date().optional(),
    /** b14 validUntil — maps to validTo on the DB model. */
    validUntil: z.coerce.date().optional(),
    /** @deprecated use validUntil. Kept for backward compat with callers using validTo. */
    validTo: z.coerce.date().optional(),
  })
  .refine(
    (d) => {
      const end = d.validUntil ?? d.validTo;
      return !d.validFrom || !end || end > d.validFrom;
    },
    {
      message: "validUntil debe ser posterior a validFrom",
      path: ["validUntil"],
    },
  );

export const authorizationDenyInput = z.object({
  id: z.string().uuid(),
  /** b14: required — state machine enforces reason on DENIED. */
  denialReason: z.string().trim().min(1).max(400),
});

// ---------------------------------------------------------------------------
// b14 — checkCoverage (plan-procedure coverage check)
// ---------------------------------------------------------------------------

export const checkCoverageInput = z.object({
  planId: z.string().uuid(),
  procedureCode: z.string().trim().min(1).max(40),
});

export const checkCoverageOutput = z.object({
  covered: z.boolean(),
  maxCoverage: z.number().nullable(),
  procedureCode: z.string(),
  planId: z.string(),
});

export type CheckCoverageOutput = z.infer<typeof checkCoverageOutput>;

// ---------------------------------------------------------------------------
// b14 — getExpiringAuthorizations
// ---------------------------------------------------------------------------

export const getExpiringAuthorizationsInput = z.object({
  /** Number of days ahead to look for expirations. Default 7. */
  daysAhead: z.number().int().min(1).max(90).default(7),
  limit: z.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type InsurerCreateInput = z.infer<typeof insurerCreateInput>;
export type InsurancePlanCreateInput = z.infer<typeof insurancePlanCreateInput>;
export type PatientCoverageCreateInput = z.infer<typeof patientCoverageCreateInput>;
export type AuthorizationRequestCreateInput = z.infer<typeof authorizationRequestCreateInput>;
export type AuthorizationApproveInput = z.infer<typeof authorizationApproveInput>;
export type AuthorizationDenyInput = z.infer<typeof authorizationDenyInput>;
export type CheckCoverageInput = z.infer<typeof checkCoverageInput>;
export type GetExpiringAuthorizationsInput = z.infer<typeof getExpiringAuthorizationsInput>;
