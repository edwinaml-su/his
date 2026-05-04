/**
 * US-5.6 — Defunción y certificado médico digital.
 *
 * Este contrato describe los inputs del router `deathCertificate`. El modelo
 * persistido es `DeathCertificate` (TDR §8.7) con causas codificadas en CIE-10
 * (basic obligatoria + intermediate / direct opcionales + contributingCauses
 * texto libre).
 *
 * Decisiones de diseño:
 *   - `basicCauseCode` y `basicCauseDesc` son obligatorios. El Código Único
 *     de Causa Básica es la pieza mínima para emitir el certificado y
 *     reportar a Registro Civil / MINSAL (TDR §5.5 regla 7).
 *   - El código CIE-10 se valida sólo de forma sintáctica aquí (longitud
 *     y patrón). La existencia en `ClinicalConcept` (codeSystemCode='ICD-10')
 *     se valida en UI vía autocomplete; el router NO falla si el código no
 *     existe en el catálogo (puede ser un código vigente que aún no se ha
 *     ingestado), pero sí queda registrado tal cual en el certificado.
 *   - `manner` (modo) sigue valores OMS estándar.
 *   - El paciente NO se soft-deletea (Patient.deletedAt sigue null). La HCE
 *     persiste para auditoría e investigación; el cierre del encounter como
 *     `dischargeType=DEATH` y la existencia del DeathCertificate son la
 *     verdad operacional. (TDR §5.5 regla 7: HCE persiste tras defunción.)
 */
import { z } from "zod";

/**
 * Modo o circunstancia de la muerte. Sigue la nomenclatura OMS adoptada por
 * el Registro Civil de El Salvador. `undetermined` cubre el caso de
 * autopsia pendiente.
 */
export const deathMannerEnum = z.enum([
  "natural",
  "accident",
  "suicide",
  "homicide",
  "undetermined",
]);

export type DeathManner = z.infer<typeof deathMannerEnum>;

/**
 * Patrón laxo para CIE-10: una letra A-Z seguida de 2-3 dígitos y opcional
 * sub-clasificación con `.` y 1-2 caracteres. No bloqueamos códigos no
 * estándar; sólo evitamos basura evidente.
 */
const icd10CodePattern = /^[A-Z][0-9]{1,3}(\.[A-Z0-9]{1,2})?$/;

const icd10Code = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(icd10CodePattern, {
    message: "Código CIE-10 inválido (esperado p.ej. I46.9, A09).",
  });

const icd10Description = z.string().trim().min(2).max(300);

export const deathCertificateCreateSchema = z.object({
  encounterId: z.string().uuid(),
  occurredAt: z.coerce.date(),
  /** Causa básica (la enfermedad/condición que inicio la cadena). Obligatoria. */
  basicCauseCode: icd10Code,
  basicCauseDesc: icd10Description,
  /** Causa intermedia (consecuencia de la básica). Opcional. */
  intermediateCauseCode: icd10Code.optional(),
  intermediateCauseDesc: icd10Description.optional(),
  /** Causa directa (la inmediata al fallecimiento). Opcional. */
  directCauseCode: icd10Code.optional(),
  directCauseDesc: icd10Description.optional(),
  /** Texto libre con causas contribuyentes (comorbilidades). */
  contributingCauses: z.string().trim().max(2000).optional(),
  manner: deathMannerEnum.optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const deathCertificateByPatientSchema = z.object({
  patientId: z.string().uuid(),
});

export const deathCertificateListSchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  manner: deathMannerEnum.optional(),
  organizationId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const deathCertificateNotifyCivilRegistrySchema = z.object({
  certificateId: z.string().uuid(),
});

export const deathCertificateGetSchema = z.object({
  id: z.string().uuid(),
});

export type DeathCertificateCreateInput = z.infer<
  typeof deathCertificateCreateSchema
>;
export type DeathCertificateByPatientInput = z.infer<
  typeof deathCertificateByPatientSchema
>;
export type DeathCertificateListInput = z.infer<
  typeof deathCertificateListSchema
>;
export type DeathCertificateNotifyCivilRegistryInput = z.infer<
  typeof deathCertificateNotifyCivilRegistrySchema
>;
export type DeathCertificateGetInput = z.infer<
  typeof deathCertificateGetSchema
>;
