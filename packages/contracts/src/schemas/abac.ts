/**
 * @his/contracts/schemas/abac — schemas Zod para la US-2.4
 * (control de acceso basado en atributos / ABAC).
 *
 * MVP Sprint 1:
 *  - Las reglas son DECLARATIVAS y viven hardcoded en
 *    `apps/web/src/lib/auth/abac.ts`. NO hay tabla AbacRule todavía.
 *  - Estos schemas son la frontera tipada que la UI consume para listar las
 *    reglas vigentes (vista informativa) y que el router devuelve al frontend.
 *  - TODO Sprint 2: persistir AbacRule en BD + middleware tRPC que invoque los
 *    helpers `canX` antes de cada procedure sensible.
 *
 * NOTA: la barrel `schemas/index.ts` está congelada; este archivo se importa
 * por ruta relativa desde router/UI/lib.
 */
import { z } from "zod";

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

/** Acción ABAC abstracta (ortogonal a AuditAction). */
export const abacActionSchema = z.enum([
  "READ",      // visualizar datos del recurso
  "WRITE",     // crear/actualizar/borrar
  "PRESCRIBE", // prescribir medicamentos (solo médico)
  "DISPENSE",  // dispensar fármacos (solo farmacéutico)
  "SIGN",      // firmar electrónicamente (HCE, recetas)
]);
export type AbacAction = z.infer<typeof abacActionSchema>;

/** Tipos de recurso protegidos. */
export const abacResourceKindSchema = z.enum([
  "Patient",
  "Encounter",
  "ServiceUnit",
  "Prescription",
  "Dispensation",
  "AuditLog",
]);
export type AbacResourceKind = z.infer<typeof abacResourceKindSchema>;

// -----------------------------------------------------------------------------
// Atributos / contexto
// -----------------------------------------------------------------------------

/** Atributos del sujeto (usuario que solicita acceso). */
export const abacSubjectAttributesSchema = z.object({
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
  roleCodes: z.array(z.string()),
  /** Sede actual (si aplica). */
  establishmentId: z.string().uuid().optional(),
});
export type AbacSubjectAttributes = z.infer<typeof abacSubjectAttributesSchema>;

/** Atributos del recurso (objeto de la decisión). */
export const abacResourceAttributesSchema = z.object({
  kind: abacResourceKindSchema,
  resourceId: z.string(),
  /** Org dueña del recurso (multi-tenant boundary). */
  organizationId: z.string().uuid().optional(),
  /** Sede / unidad de servicio del recurso (cuando aplica). */
  establishmentId: z.string().uuid().optional(),
  serviceUnitId: z.string().uuid().optional(),
});
export type AbacResourceAttributes = z.infer<typeof abacResourceAttributesSchema>;

// -----------------------------------------------------------------------------
// Regla ABAC (presentación / TODO Sprint 2 persistencia)
// -----------------------------------------------------------------------------

/**
 * Regla ABAC en formato legible para la vista informativa.
 *
 * - `action`: la acción que se autoriza/deniega.
 * - `resourceKind`: tipo de recurso al que aplica.
 * - `allowedRoles`: códigos de rol cuya presencia satisface la regla.
 * - `condition`: descripción humana de la condición adicional (org match,
 *   asignación a service unit, etc.). En MVP se documenta en texto; en
 *   Sprint 2 esta condición pasará a ser una expresión evaluable.
 */
export const abacRuleSchema = z.object({
  id: z.string(), // slug estable para la UI; no es UUID en MVP.
  action: abacActionSchema,
  resourceKind: abacResourceKindSchema,
  allowedRoles: z.array(z.string()),
  condition: z.string(),
  description: z.string(),
});
export type AbacRule = z.infer<typeof abacRuleSchema>;

// -----------------------------------------------------------------------------
// Decisión
// -----------------------------------------------------------------------------

export const abacDecisionSchema = z.object({
  allowed: z.boolean(),
  /** Regla que produjo la decisión (id) o "default-deny". */
  matchedRuleId: z.string(),
  reason: z.string(),
});
export type AbacDecision = z.infer<typeof abacDecisionSchema>;
