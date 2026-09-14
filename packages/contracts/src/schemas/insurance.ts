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
  /** CC-0028 — FK lógica a ServicePriceList (sin relación Prisma). */
  priceListId: z.string().uuid().optional(),
  sequence: z.number().int().min(0).default(0),
});

export const insurancePlanListInput = z.object({
  insurerId: z.string().uuid().optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// CC-0028 — config de cobertura por ámbito (InsurancePlanCoverage /
// PatientCoverageOverride comparten la misma forma — ver SQL 235).
// ---------------------------------------------------------------------------

export const ambitoEnum = z.enum(["CONSULTA", "FARMACIA", "GENERAL"]);
export const coverageTypeEnum = z.enum(["PORCENTAJE", "MONTO_FIJO", "PORCENTAJE_CON_TOPE"]);

export type AmbitoType = z.infer<typeof ambitoEnum>;
export type CoverageTypeType = z.infer<typeof coverageTypeEnum>;

/**
 * Espejo del CHECK `insurance_plan_coverage_fields_check`/
 * `patient_coverage_override_fields_check` (SQL 235): el campo requerido
 * depende de `coverageType`.
 */
function refineAmbitoConfig<T extends { coverageType: CoverageTypeType; insuredPercentage?: number; copayAmount?: number; coverageLimit?: number }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  if (data.coverageType === "PORCENTAJE" && data.insuredPercentage === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "insuredPercentage requerido para PORCENTAJE", path: ["insuredPercentage"] });
  }
  if (data.coverageType === "MONTO_FIJO" && data.copayAmount === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "copayAmount requerido para MONTO_FIJO", path: ["copayAmount"] });
  }
  if (data.coverageType === "PORCENTAJE_CON_TOPE" && (data.insuredPercentage === undefined || data.coverageLimit === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "insuredPercentage y coverageLimit requeridos para PORCENTAJE_CON_TOPE",
      path: ["coverageLimit"],
    });
  }
}

const ambitoConfigBase = {
  ambito: ambitoEnum,
  coverageType: coverageTypeEnum,
  insuredPercentage: z.number().min(0).max(100).optional(),
  copayAmount: z.number().min(0).optional(),
  coverageLimit: z.number().min(0).optional(),
};

export const insurancePlanCoverageUpsertInput = z
  .object({ planId: z.string().uuid(), ...ambitoConfigBase })
  .superRefine(refineAmbitoConfig);

export const patientCoverageOverrideUpsertInput = z
  .object({ coverageId: z.string().uuid(), ...ambitoConfigBase })
  .superRefine(refineAmbitoConfig);

// ---------------------------------------------------------------------------
// PatientCoverage
// ---------------------------------------------------------------------------

export const patientCoverageCreateInput = z
  .object({
    patientId: z.string().uuid(),
    planId: z.string().uuid(),
    policyNumber: z.string().trim().min(1).max(80),
    /** CC-0028 — número de carnet físico de la aseguradora. */
    carnet: z.string().trim().max(80).optional(),
    /** CC-0028 — contratante de la póliza (puede diferir del paciente). */
    contratante: z.string().trim().max(200).optional(),
    /** CC-0028 — override de InsurancePlan.priceListId para esta póliza. */
    priceListId: z.string().uuid().optional(),
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
  /** CC-0028c — filtro por aseguradora, resuelto vía plan.insurerId. */
  insurerId: z.string().uuid().optional(),
  /** CC-0028c — pólizas vigentes a una fecha: validFrom<=X y (validTo null o >=X). */
  vigentesA: z.coerce.date().optional(),
  /** CC-0028c — búsqueda libre: nombre/MRN del paciente o nº de póliza. */
  search: z.string().trim().min(1).max(80).optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
  /** CC-0028c — mismo patrón offset/limit que patientAccount.listarWorklist. */
  offset: z.number().int().min(0).default(0),
});

export const patientCoverageDeactivateInput = z.object({
  id: z.string().uuid(),
});

/**
 * CC-0028c — edición de una póliza existente. `patientId` deliberadamente NO
 * es editable: una póliza no se transfiere de paciente (se desactiva y se
 * crea una nueva) — ver docs/CC/0028_seguros_operativos.md. El router valida
 * tenancy de `id`/`planId`/`priceListId` y que `validTo` (si viene, o el ya
 * guardado) sea posterior a `validFrom` (si viene, o el ya guardado).
 */
export const patientCoverageUpdateInput = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid().optional(),
  policyNumber: z.string().trim().min(1).max(80).optional(),
  carnet: z.string().trim().max(80).optional(),
  contratante: z.string().trim().max(200).optional(),
  priceListId: z.string().uuid().optional(),
  validFrom: z.coerce.date().optional(),
  // nullable: `null` explícito = borrar la fecha fin (póliza sin vencimiento);
  // `undefined` = no tocar. Sin esto, vaciar el campo en la UI era un falso
  // éxito (Prisma ignora undefined) — hallazgo pre-pr-review CC-0028c.
  validTo: z.coerce.date().nullable().optional(),
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
// CC-0028 — CoverageRule ("Patient Share Rules", acs.insurance.policy.rule).
// ---------------------------------------------------------------------------

export const ruleOnEnum = z.enum(["CATEGORIA", "CODIGO"]);
export const ruleTypeEnum = z.enum(["PORCENTAJE", "MONTO"]);

export type RuleOnType = z.infer<typeof ruleOnEnum>;
export type RuleTypeType = z.infer<typeof ruleTypeEnum>;

export const coverageRuleCreateInput = z
  .object({
    /** Exactamente uno de planId/coverageId (XOR, CHECK en SQL 235). */
    planId: z.string().uuid().optional(),
    coverageId: z.string().uuid().optional(),
    ruleOn: ruleOnEnum,
    serviceCategoryId: z.string().uuid().optional(),
    code: z.string().trim().min(1).max(40).optional(),
    ruleType: ruleTypeEnum,
    percentage: z.number().min(0).max(100).optional(),
    amount: z.number().min(0).optional(),
    fullCover: z.boolean().default(false),
    sequence: z.number().int().min(0).default(0),
  })
  .superRefine((d, ctx) => {
    if ((d.planId == null) === (d.coverageId == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactamente uno de planId o coverageId es requerido",
        path: ["planId"],
      });
    }
    if (d.ruleOn === "CATEGORIA" && !d.serviceCategoryId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "serviceCategoryId requerido para ruleOn=CATEGORIA", path: ["serviceCategoryId"] });
    }
    if (d.ruleOn === "CODIGO" && !d.code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "code requerido para ruleOn=CODIGO", path: ["code"] });
    }
    if (!d.fullCover) {
      if (d.ruleType === "PORCENTAJE" && d.percentage === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "percentage requerido para ruleType=PORCENTAJE (o fullCover=true)", path: ["percentage"] });
      }
      if (d.ruleType === "MONTO" && d.amount === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amount requerido para ruleType=MONTO (o fullCover=true)", path: ["amount"] });
      }
    }
  });

export const coverageRuleListInput = z.object({
  planId: z.string().uuid().optional(),
  coverageId: z.string().uuid().optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const coverageRuleDeactivateInput = z.object({ id: z.string().uuid() });

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
export type PatientCoverageUpdateInput = z.infer<typeof patientCoverageUpdateInput>;
export type PatientCoverageListInput = z.infer<typeof patientCoverageListInput>;
export type AuthorizationRequestCreateInput = z.infer<typeof authorizationRequestCreateInput>;
export type AuthorizationApproveInput = z.infer<typeof authorizationApproveInput>;
export type AuthorizationDenyInput = z.infer<typeof authorizationDenyInput>;
export type CheckCoverageInput = z.infer<typeof checkCoverageInput>;
export type GetExpiringAuthorizationsInput = z.infer<typeof getExpiringAuthorizationsInput>;
export type InsurancePlanCoverageUpsertInput = z.infer<typeof insurancePlanCoverageUpsertInput>;
export type PatientCoverageOverrideUpsertInput = z.infer<typeof patientCoverageOverrideUpsertInput>;
export type CoverageRuleCreateInput = z.infer<typeof coverageRuleCreateInput>;
export type CoverageRuleListInput = z.infer<typeof coverageRuleListInput>;
