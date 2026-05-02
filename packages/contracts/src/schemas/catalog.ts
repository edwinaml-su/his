/**
 * US-3.2 — Schemas Zod para CRUD genérico de catálogos parametrizables (TDR §7).
 *
 * Cada catálogo comparte el "tronco" { code, name, active } pero algunos
 * agregan campos propios (ordinal en EducationLevel, minDays/maxDays en AgeBand,
 * isoCode/ciuoCode en Language/Occupation, validatorFn en IdentifierType, etc.).
 *
 * Para mantener el router genérico (`(prisma as any)[model]`), se define una
 * unión discriminada por `catalog` y un schema `data` específico por catálogo.
 *
 * NOTA: La unicidad por código se valida en BD vía @@unique. El schema sólo
 * garantiza forma + longitudes mínimas/máximas según schema.prisma.
 */
import { z } from "zod";

// ----- Catalog keys (deben coincidir con catalogRouter.modelMap) -----
export const catalogKeyEnum = z.enum([
  "biologicalSex",
  "gender",
  "maritalStatus",
  "educationLevel",
  "occupation",
  "religion",
  "language",
  "ethnicity",
  "patientType",
  "patientCategory",
  "ageBand",
  "medicalSpecialty",
  "identifierType",
  "serviceUnit",
]);
export type CatalogKey = z.infer<typeof catalogKeyEnum>;

// ----- Reglas comunes -----
const code20 = z.string().trim().min(1, "Código requerido").max(20);
const code40 = z.string().trim().min(1, "Código requerido").max(40);
const name80 = z.string().trim().min(1, "Nombre requerido").max(80);
const name120 = z.string().trim().min(1, "Nombre requerido").max(120);
const name200 = z.string().trim().min(1, "Nombre requerido").max(200);
const optUuid = z.string().uuid().optional().nullable();
const activeFlag = z.boolean().default(true);

// ----- Data schemas por catálogo -----
export const biologicalSexDataSchema = z.object({
  code: code20,
  name: name80,
  active: activeFlag,
});

export const genderDataSchema = z.object({
  code: code20,
  name: name80,
  active: activeFlag,
});

export const maritalStatusDataSchema = z.object({
  code: code20,
  name: name80,
  active: activeFlag,
});

export const educationLevelDataSchema = z.object({
  code: code40,
  name: name120,
  ordinal: z.coerce.number().int().min(0),
  active: activeFlag,
});

export const occupationDataSchema = z.object({
  ciuoCode: code20,
  name: name200,
  active: activeFlag,
});

export const religionDataSchema = z.object({
  code: code40,
  name: name120,
  active: activeFlag,
});

export const languageDataSchema = z.object({
  isoCode: z.string().trim().min(2).max(10),
  name: name80,
  active: activeFlag,
});

export const ethnicityDataSchema = z.object({
  countryId: optUuid,
  code: code40,
  name: name120,
  active: activeFlag,
});

export const patientTypeDataSchema = z.object({
  code: code40,
  name: name120,
  active: activeFlag,
});

export const patientCategoryDataSchema = z.object({
  code: code40,
  name: name120,
  active: activeFlag,
});

export const ageBandDataSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: name80,
  minDays: z.coerce.number().int().min(0),
  maxDays: z.coerce.number().int().min(0).optional().nullable(),
  active: activeFlag,
});

export const medicalSpecialtyDataSchema = z.object({
  parentId: optUuid,
  code: code40,
  name: name120,
  active: activeFlag,
});

export const identifierTypeDataSchema = z.object({
  countryId: z.string().uuid("countryId requerido"),
  code: code20,
  name: name80,
  validatorFn: z.string().trim().max(80).optional().nullable(),
  active: activeFlag,
});

/**
 * US-3.4 — ServiceUnit (TDR §7.3.4).
 * `organizationId` NO se valida aquí: lo inyecta el router desde ctx.tenant.
 * `specialtyId` opcional (referencia a MedicalSpecialty).
 * Nota: schema.prisma no expone `category` ni `capacity` (fuera de Sprint 1).
 */
export const serviceUnitDataSchema = z.object({
  establishmentId: z.string().uuid("establishmentId requerido"),
  specialtyId: optUuid,
  code: code40,
  name: name120,
  active: activeFlag,
});

// ----- Mapa centralizado catalog → data schema -----
export const catalogDataSchemas = {
  biologicalSex: biologicalSexDataSchema,
  gender: genderDataSchema,
  maritalStatus: maritalStatusDataSchema,
  educationLevel: educationLevelDataSchema,
  occupation: occupationDataSchema,
  religion: religionDataSchema,
  language: languageDataSchema,
  ethnicity: ethnicityDataSchema,
  patientType: patientTypeDataSchema,
  patientCategory: patientCategoryDataSchema,
  ageBand: ageBandDataSchema,
  medicalSpecialty: medicalSpecialtyDataSchema,
  identifierType: identifierTypeDataSchema,
  serviceUnit: serviceUnitDataSchema,
} as const satisfies Record<CatalogKey, z.ZodTypeAny>;

/** Devuelve el schema por catálogo o lanza si la key es desconocida. */
export function getCatalogDataSchema(key: CatalogKey): z.ZodTypeAny {
  return catalogDataSchemas[key];
}

// ----- Inputs de procedures tRPC -----
export const catalogListInput = z.object({
  catalog: catalogKeyEnum,
  activeOnly: z.boolean().default(false),
  search: z.string().trim().max(120).optional(),
});

export const catalogGetInput = z.object({
  catalog: catalogKeyEnum,
  id: z.string().uuid(),
});

export const catalogCreateInput = z.object({
  catalog: catalogKeyEnum,
  data: z.record(z.string(), z.unknown()),
});

export const catalogUpdateInput = z.object({
  catalog: catalogKeyEnum,
  id: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
});

export const catalogToggleInput = z.object({
  catalog: catalogKeyEnum,
  id: z.string().uuid(),
});

export type CatalogListInput = z.infer<typeof catalogListInput>;
export type CatalogCreateInput = z.infer<typeof catalogCreateInput>;
export type CatalogUpdateInput = z.infer<typeof catalogUpdateInput>;
