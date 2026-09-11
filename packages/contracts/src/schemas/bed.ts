import { z } from "zod";

export const bedStatusEnum = z.enum([
  "FREE",
  "OCCUPIED",
  "DIRTY",
  "BLOCKED",
  "MAINTENANCE",
  "RESERVED",
]);

/** Espejo hospital.bed (Odoo ACS HMS) — sql/231_room_bed_odoo_mirror.sql. */
export const bedTypeEnum = z.enum([
  "GATCH",
  "ELECTRICA",
  "CAMILLA",
  "BAJA",
  "BAJA_PERDIDA_AIRE",
  "CIRCO_ELECTRICA",
  "CLINITRON",
]);

/** Espejo del custom camas.config de Odoo — sql/231_room_bed_odoo_mirror.sql. */
export const bedBillingClassEnum = z.enum(["GENERAL", "ISBM"]);

const glnCodigoSchema = z
  .string()
  .length(13)
  .regex(/^\d{13}$/, "GLN-13: 13 dígitos numéricos");

/** Admin CRUD (parametrización 2026-09-11) — alta de cama. */
export const bedCreateSchema = z.object({
  establishmentId: z.string().uuid(),
  serviceUnitId: z.string().uuid(),
  roomId: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(40),
  isolation: z.string().trim().max(40).optional(),
  bedType: bedTypeEnum.optional(),
  billingClass: bedBillingClassEnum.optional(),
  glnCodigo: glnCodigoSchema.optional(),
});

/** Admin CRUD — edición de cama. `code` no se expone editable (identidad). */
export const bedUpdateSchema = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(1).max(40).optional(),
  serviceUnitId: z.string().uuid().optional(),
  roomId: z.string().uuid().nullable().optional(),
  isolation: z.string().trim().max(40).nullable().optional(),
  bedType: bedTypeEnum.nullable().optional(),
  billingClass: bedBillingClassEnum.nullable().optional(),
  glnCodigo: glnCodigoSchema.nullable().optional(),
});

export const bedSetActiveSchema = z.object({ id: z.string().uuid(), active: z.boolean() });

export const bedListSchema = z.object({
  serviceUnitId: z.string().uuid().optional(),
  status: bedStatusEnum.optional(),
});

export const bedUpdateStatusSchema = z.object({
  bedId: z.string().uuid(),
  status: bedStatusEnum,
  reason: z.string().max(200).optional(),
});

/** US-5.2 — buscar camas disponibles, opcionalmente filtradas por servicio. */
export const bedFindAvailableSchema = z.object({
  serviceUnitId: z.string().uuid().optional(),
});

/** US-5.2 — asignación manual de cama a un encounter abierto. */
export const bedAssignToEncounterSchema = z.object({
  bedId: z.string().uuid(),
  encounterId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

/** US-5.2 — liberación de cama (egreso, traslado, alta, fallecimiento). */
export const bedReleaseSchema = z.object({
  bedId: z.string().uuid(),
  reason: z.string().min(2).max(200),
});

export type BedListInput = z.infer<typeof bedListSchema>;
export type BedUpdateStatusInput = z.infer<typeof bedUpdateStatusSchema>;
export type BedFindAvailableInput = z.infer<typeof bedFindAvailableSchema>;
export type BedAssignToEncounterInput = z.infer<typeof bedAssignToEncounterSchema>;
export type BedReleaseInput = z.infer<typeof bedReleaseSchema>;
export type BedCreateInput = z.infer<typeof bedCreateSchema>;
export type BedUpdateInput = z.infer<typeof bedUpdateSchema>;
export type BedSetActiveInput = z.infer<typeof bedSetActiveSchema>;
