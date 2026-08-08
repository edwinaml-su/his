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

// -----------------------------------------------------------------------------
// CC-0017 F2 — ABAC persistente (tabla `AbacRule`).
//
// Reemplaza la evaluación puramente informativa de arriba: las reglas viven
// en BD (`packages/database/sql/195_cc0017_f2_abac.sql`), se evalúan
// server-side en `packages/trpc/src/abac/motor.ts` y se editan desde /abac
// (antes solo-lectura). Los tipos `AbacRule`/`abacRuleSchema` de arriba se
// mantienen para no romper la vista informativa legacy y los helpers sync de
// `apps/web/src/lib/auth/abac.ts` (ver doc REQ-SEC-ABAC-002 para el detalle
// de qué se migró y qué quedó como fallback documentado).
// -----------------------------------------------------------------------------

/** Recurso protegido por una AbacRule persistida. Deriva de las 5 funciones canX. */
export const abacRecursoSchema = z.enum([
  "patient",
  "prescription",
  "dispensation",
  "service",
  "signature",
]);
export type AbacRecurso = z.infer<typeof abacRecursoSchema>;

/** Acción sobre el recurso. */
export const abacAccionSchema = z.enum(["access", "prescribe", "dispense", "sign"]);
export type AbacAccion = z.infer<typeof abacAccionSchema>;

/** Efecto de la regla. DENY siempre gana sobre ALLOW en el motor. */
export const abacEffectSchema = z.enum(["ALLOW", "DENY"]);
export type AbacEffect = z.infer<typeof abacEffectSchema>;

/** Atributos soportados en las condiciones de una AbacRule. */
export const abacAtributoSchema = z.enum([
  "rol",
  "establecimiento",
  "servicio",
  "horario",
  "pacienteConTriaje",
  "usuarioActivo",
  "esPropioPaciente",
]);
export type AbacAtributoNombre = z.infer<typeof abacAtributoSchema>;

/** Operadores evaluables. `ENTRE_HORAS` solo aplica al atributo `horario`. */
export const abacOperadorSchema = z.enum([
  "IGUAL",
  "DIFERENTE",
  "EN",
  "NO_EN",
  "ENTRE_HORAS",
  "ES_VERDADERO",
  "ES_FALSO",
]);
export type AbacOperador = z.infer<typeof abacOperadorSchema>;

/** Rango horario HH:MM (24h). Soporta wrap de medianoche (desde > hasta). */
export const abacHorarioValorSchema = z.object({
  desde: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM (24h)."),
  hasta: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM (24h)."),
});
export type AbacHorarioValor = z.infer<typeof abacHorarioValorSchema>;

/** Un predicado de condición: `atributo operador valor`. La lista completa de una regla es AND. */
export const abacCondicionSchema = z.object({
  atributo: abacAtributoSchema,
  operador: abacOperadorSchema,
  valor: z.union([
    z.string(),
    z.array(z.string()),
    z.boolean(),
    abacHorarioValorSchema,
  ]),
});
export type AbacCondicion = z.infer<typeof abacCondicionSchema>;

/** Fila persistida de AbacRule (shape de respuesta del router). */
export const abacRuleRecordSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  recurso: abacRecursoSchema,
  accion: abacAccionSchema,
  effect: abacEffectSchema,
  prioridad: z.number().int(),
  descripcion: z.string().nullable(),
  condiciones: z.array(abacCondicionSchema),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type AbacRuleRecord = z.infer<typeof abacRuleRecordSchema>;

// -----------------------------------------------------------------------------
// CRUD inputs — abac.router.ts
// -----------------------------------------------------------------------------

export const abacRuleListInput = z
  .object({
    recurso: abacRecursoSchema.optional(),
    accion: abacAccionSchema.optional(),
    activeOnly: z.boolean().optional(),
  })
  .default({});
export type AbacRuleListInput = z.infer<typeof abacRuleListInput>;

export const abacRuleGetInput = z.object({ id: z.string().uuid() });

export const abacRuleCreateInput = z.object({
  recurso: abacRecursoSchema,
  accion: abacAccionSchema,
  effect: abacEffectSchema.default("ALLOW"),
  prioridad: z.number().int().min(0).max(10_000).default(100),
  descripcion: z.string().trim().max(500).optional(),
  condiciones: z.array(abacCondicionSchema).default([]),
});
export type AbacRuleCreateInput = z.infer<typeof abacRuleCreateInput>;

export const abacRuleUpdateInput = z.object({
  id: z.string().uuid(),
  recurso: abacRecursoSchema.optional(),
  accion: abacAccionSchema.optional(),
  effect: abacEffectSchema.optional(),
  prioridad: z.number().int().min(0).max(10_000).optional(),
  descripcion: z.string().trim().max(500).nullable().optional(),
  condiciones: z.array(abacCondicionSchema).optional(),
});
export type AbacRuleUpdateInput = z.infer<typeof abacRuleUpdateInput>;

export const abacRuleSetActiveInput = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

export const abacRuleDeleteInput = z.object({ id: z.string().uuid() });
