import { z } from "zod";
import { validateIdentifier } from "../validators";

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

export const patientCreateSchema = z.object({
  mrn: z.string().min(1).max(40),
  firstName: z.string().min(1).max(120),
  middleName: z.string().max(120).nullable().optional(),
  lastName: z.string().min(1).max(120),
  secondLastName: z.string().max(120).nullable().optional(),
  preferredName: z.string().max(120).nullable().optional(),
  birthDate: z.coerce.date().nullable().optional(),
  birthDateEstimated: z.boolean().default(false),
  biologicalSexId: z.string().uuid(),
  genderId: z.string().uuid().nullable().optional(),
  maritalStatusId: z.string().uuid().nullable().optional(),
  educationLevelId: z.string().uuid().nullable().optional(),
  occupationId: z.string().uuid().nullable().optional(),
  bloodTypeAbo: z.enum(["A", "B", "AB", "O"]).nullable().optional(),
  bloodRh: z.enum(["+", "-"]).nullable().optional(),
  isUnknown: z.boolean().default(false),
});

export const patientUpdateSchema = patientCreateSchema.partial().extend({
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
