import { z } from "zod";
import { validateIdentifier, validateDUI } from "../validators";

export const patientIdentifierKindEnum = z.enum([
  "DUI",
  "NIT",
  "NIE",
  "PASSPORT",
  "BIRTH_CERT",
  "MINOR_ID",
  "RESIDENT_ID",
  "NUP",
  "OTHER",
]);

export const patientIdentifierSchema = z
  .object({
    identifierTypeId: z.string().uuid(),
    kind: patientIdentifierKindEnum,
    value: z.string().min(1).max(80),
    countryOfIssue: z.string().uuid().optional(),
    issuedAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    isPrimary: z.boolean().default(false),
  })
  .refine((d) => validateIdentifier(d.kind, d.value), {
    message: "Identificador inválido para el tipo seleccionado (DUI/NIT/NIE).",
    path: ["value"],
  });

// =============================================================================
// CC-0002 §3/§5/§10 — Documento de registro + deduplicación + responsable.
// =============================================================================

// CC-0005: CARNET_RESIDENCIA agregado para resolver pacientes por documento en OI.
// DNI conservado — otros módulos lo usan (no remover).
export const documentTypeEnum = z.enum(["DUI", "DNI", "PASAPORTE", "DUI_RESP", "CARNET_RESIDENCIA"]);

export const responsableSchema = z
  .object({
    nombre: z.string().min(1).max(200),
    parentesco: z.string().min(1).max(50),
    dui: z.string().min(1).max(40),
  })
  .refine((r) => validateDUI(r.dui), {
    message: "DUI de responsable inválido.",
    path: ["dui"],
  });

/** Calcula la edad en años completos a la fecha actual (UTC). */
const calcEdad = (bd: Date): number => {
  const h = new Date();
  let a = h.getUTCFullYear() - bd.getUTCFullYear();
  const m = h.getUTCMonth() - bd.getUTCMonth();
  if (m < 0 || (m === 0 && h.getUTCDate() < bd.getUTCDate())) a--;
  return a;
};

export const patientAllergySchema = z.object({
  substanceConceptId: z.string().uuid().nullable().optional(),
  substanceText: z.string().min(1).max(200),
  reaction: z.string().max(400).nullable().optional(),
  severity: z.enum(["mild", "moderate", "severe", "life-threatening"]),
  onsetDate: z.coerce.date().nullable().optional(),
  verified: z.boolean().default(false),
});

export const patientAddressSchema = z.object({
  geoDivisionId: z.string().uuid().nullable().optional(),
  line1: z.string().min(1).max(300),
  line2: z.string().max(300).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  isPrimary: z.boolean().default(false),
});

// Objeto base sin superRefine: permite .partial() en update sin perder tipado.
// El superRefine cross-field solo aplica en create (donde todos los campos están presentes).
// Ref: Zod no propaga superRefine tras .partial() de forma segura en v3 — Plan B aplicado.
const patientBaseObject = z.object({
  // CC-0008 §6: mrn ya no se captura en pre-registro; se autogenera server-side (= expediente).
  // Permanece opcional para tolerar update y compatibilidad con módulos que aún lo envían.
  mrn: z.string().max(40).optional(),
  firstName: z.string().min(1).max(120),
  middleName: z.string().max(120).nullable().optional(),
  thirdName: z.string().max(120).nullable().optional(), // CC-0008 §6: tercer nombre.
  lastName: z.string().min(1).max(120),
  secondLastName: z.string().max(120).nullable().optional(),
  marriedLastName: z.string().max(120).nullable().optional(), // CC-0008 §6: apellido de casada.
  preferredName: z.string().max(120).nullable().optional(),
  // CC-0008 §6: switch "el paciente trae documento de identidad" (default ON).
  traeDocumento: z.boolean().default(true),
  birthDate: z.coerce.date(), // CC-0002: requerida para generar expediente.
  birthDateEstimated: z.boolean().default(false),
  biologicalSexId: z.string().uuid(),
  genderId: z.string().uuid().nullable().optional(),
  maritalStatusId: z.string().uuid().nullable().optional(),
  educationLevelId: z.string().uuid().nullable().optional(),
  occupationId: z.string().uuid().nullable().optional(),
  bloodTypeAbo: z.enum(["A", "B", "AB", "O"]).nullable().optional(),
  bloodRh: z.enum(["+", "-"]).nullable().optional(),
  isUnknown: z.boolean().default(false),
  // CC-0002 §3/§5: documento de registro (opcional, tolera pacientes existentes sin doc).
  documentType: documentTypeEnum.optional(),
  documentNumber: z.string().min(1).max(40).optional(),
  responsable: responsableSchema.optional(),
});

export const patientCreateSchema = patientBaseObject.superRefine((val, ctx) => {
  const { documentType, documentNumber, responsable, birthDate } = val;

  if (
    documentType &&
    ["DUI", "DNI", "PASAPORTE", "CARNET_RESIDENCIA"].includes(documentType) &&
    !documentNumber
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Número de documento requerido para documento propio.",
      path: ["documentNumber"],
    });
  }

  if (documentType === "DUI" && documentNumber && !validateDUI(documentNumber)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "DUI inválido (dígito verificador).",
      path: ["documentNumber"],
    });
  }

  if (documentType === "DUI_RESP") {
    if (!responsable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Datos del responsable requeridos para DUI_RESP.",
        path: ["responsable"],
      });
    }
    if (birthDate && calcEdad(birthDate) >= 18) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DUI_RESP solo aplica a menores de 18 años.",
        path: ["documentType"],
      });
    }
  }
});

export const patientUpdateSchema = patientBaseObject.partial().extend({
  id: z.string().uuid(),
});

export const patientSearchSchema = z.object({
  query: z.string().trim().min(1).max(80),
  limit: z.number().int().min(1).max(50).default(20),
});

export type PatientCreateInput = z.infer<typeof patientCreateSchema>;
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;
export type PatientIdentifierInput = z.infer<typeof patientIdentifierSchema>;
export type PatientAllergyInput = z.infer<typeof patientAllergySchema>;
export type PatientAddressInput = z.infer<typeof patientAddressSchema>;
export type PatientSearchInput = z.infer<typeof patientSearchSchema>;

// =============================================================================
// US-4.3 / US-4.4 — Dedupe MPI + Merge con auditoría.
// =============================================================================

/** Campos que el usuario puede elegir individualmente al hacer merge. */
export const mergeFieldKeys = [
  "firstName",
  "middleName",
  "lastName",
  "secondLastName",
  "preferredName",
  "birthDate",
  "biologicalSexId",
  "genderId",
  "maritalStatusId",
  "bloodTypeAbo",
  "bloodRh",
  "mrn",
] as const;

export type PatientMergeFieldKey = (typeof mergeFieldKeys)[number];

/** Cada field se decide tomándolo del paciente "from" o "to". */
export const mergeFieldChoiceSchema = z.enum(["from", "to"]);

export const findDuplicatesInput = z.object({
  patientId: z.string().uuid(),
  threshold: z.number().min(0).max(1).default(0.65),
  limit: z.number().int().min(1).max(50).default(20),
});

export const mergePatientsInput = z
  .object({
    fromPatientId: z.string().uuid(),
    toPatientId: z.string().uuid(),
    justification: z
      .string()
      .trim()
      .min(20, "La justificación debe tener al menos 20 caracteres.")
      .max(500),
    /** Por field: 'from' | 'to'. Si el field se omite, queda como está en `to`. */
    fieldsToTake: z
      .record(z.enum(mergeFieldKeys), mergeFieldChoiceSchema)
      .default({}),
  })
  .refine((d) => d.fromPatientId !== d.toPatientId, {
    message: "No se puede fusionar un paciente consigo mismo.",
    path: ["fromPatientId"],
  });

export const unmergeInput = z.object({
  mergeId: z.string().uuid(),
});

export type FindDuplicatesInput = z.infer<typeof findDuplicatesInput>;
export type MergePatientsInput = z.infer<typeof mergePatientsInput>;
export type UnmergeInput = z.infer<typeof unmergeInput>;
