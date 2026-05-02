/**
 * US-2.9 — Schemas Zod para consentimiento informado de tratamiento de datos.
 *
 * MVP:
 *  - Plantillas hardcoded por país (ISO alpha-3) y propósito en consent.router.ts.
 *  - CRUD: list (paginado + filtros), get, create, revoke.
 *  - Firma digital (DTE) → Sprint 5.
 *
 * TODO(Sprint 2): tabla ConsentTemplate (versionado en BD, no constants).
 * TODO(Sprint 5): firma digital con timbre DTE / firma electrónica avanzada.
 */
import { z } from "zod";

/**
 * Propósitos de consentimiento soportados.
 * Coincide con los valores almacenados en `PatientConsent.purpose`.
 */
export const consentPurposeEnum = z.enum([
  "data-processing",
  "mpi-cross-org",
  "transfusion",
  "research",
  "telemedicine",
]);
export type ConsentPurpose = z.infer<typeof consentPurposeEnum>;

/**
 * Estados derivados del registro (no persistidos: derivados de `revokedAt`/`validTo`).
 */
export const consentStatusEnum = z.enum(["active", "revoked", "expired"]);
export type ConsentStatus = z.infer<typeof consentStatusEnum>;

// ----- Inputs -----

export const consentListInput = z.object({
  patientId: z.string().uuid().optional(),
  purpose: consentPurposeEnum.optional(),
  status: consentStatusEnum.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const consentGetInput = z.object({
  id: z.string().uuid(),
});

export const consentByPatientInput = z.object({
  patientId: z.string().uuid(),
});

export const consentCreateInput = z.object({
  patientId: z.string().uuid(),
  purpose: consentPurposeEnum,
  /** Versión del template aceptada (debe existir en CONSENT_TEMPLATES para el país del tenant). */
  version: z.coerce.number().int().min(1),
  granted: z.boolean().default(true),
  /** Usuario que registra la firma (paciente o representante). */
  signedByUserId: z.string().uuid().optional(),
  /** Detalles parametrizables (organizaciones autorizadas, finalidades, etc.). */
  scope: z.record(z.string(), z.unknown()).optional(),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().optional(),
  /** IP y UA desde el frontend para evidencia (TDR §6.3). */
  ipAddress: z.string().max(80).optional(),
});

export const consentRevokeInput = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(400).optional(),
});

export const consentTemplateListInput = z.object({
  /** Si se omite, se usa el país del tenant. ISO alpha-3 (SLV, GTM, etc.). */
  countryIso: z.string().trim().length(3).optional(),
});

export type ConsentListInput = z.infer<typeof consentListInput>;
export type ConsentCreateInput = z.infer<typeof consentCreateInput>;
export type ConsentRevokeInput = z.infer<typeof consentRevokeInput>;
export type ConsentTemplateListInput = z.infer<typeof consentTemplateListInput>;
