/**
 * GS1 EPCIS — evento de movimiento de paciente (ADR 0019, ece.gs1_epcis_patient_event).
 *
 * Enforcement runtime del dictamen @AE
 * (docs/audit/2026-08-18_dictamen_ae_epcis_trazabilidad_paciente.md, §4 restricción 4):
 * el payload what/where_data/why/who debe limitarse ESTRICTAMENTE a identificadores
 * opacos (GSRN, GLN/bedId/serviceUnitId, userId) — cero texto libre, cero diagnóstico,
 * cero nombre/documento. Hasta ahora el enforcement era solo TypeScript
 * (packages/trpc/src/lib/epcis-builder.ts) + tests de cumplimiento
 * (epcis-builder.test.ts) — sin validación runtime. `.strict()` en cada nivel: un
 * campo no declarado (ej. alguien agrega "reason" o "diagnostico" al builder) hace
 * fallar el parse en vez de colarse silenciosamente al INSERT.
 *
 * Shapes espejados 1:1 de `buildPatientMovementEvent` (epcis-builder.ts) y de los
 * tests de cumplimiento en epcis-builder.test.ts ("solo exponen las claves
 * documentadas en ADR 0019 D5").
 */
import { z } from "zod";

// URN EPC pure-identity de GSRN — urn:epc:id:gsrn:<companyPrefix>.<serviceReference>
// (buildGsrnUrn en epcis-builder.ts descarta el check digit; companyPrefix es 7-9
// dígitos, el resto del body de 17 dígitos queda en serviceReference).
const gsrnUrnSchema = z
  .string()
  .regex(/^urn:epc:id:gsrn:\d{7,9}\.\d{8,10}$/, "URN GSRN inválida");

// GSRN-18 completo (con check digit), sin URN — para lectura/verificación.
const gsrn18Schema = z.string().regex(/^\d{18}$/, "GSRN debe ser 18 dígitos numéricos");

// URN SGLN — urn:epc:id:sgln:<GLN-13> (glnUrn() en epcis-builder.ts). Null cuando
// el GLN de la ubicación no está resuelto (ADR 0019 D8).
const sglnUrnSchema = z
  .string()
  .regex(/^urn:epc:id:sgln:\d{13}$/, "URN SGLN inválida")
  .nullable();

// ---------------------------------------------------------------------------
// WHAT
// ---------------------------------------------------------------------------
export const epcisPatientWhatSchema = z
  .object({
    epcList: z.array(gsrnUrnSchema).min(1),
    gsrn: gsrn18Schema,
  })
  .strict();

export type EpcisPatientWhat = z.infer<typeof epcisPatientWhatSchema>;

// ---------------------------------------------------------------------------
// WHERE
// ---------------------------------------------------------------------------
const internalRefSchema = z
  .object({
    bedId: z.string().uuid().nullable(),
    serviceUnitId: z.string().uuid().nullable(),
    establishmentId: z.string().uuid(),
  })
  .strict();

export const epcisPatientWhereSchema = z
  .object({
    readPoint: sglnUrnSchema,
    bizLocation: sglnUrnSchema,
    internalRef: internalRefSchema,
  })
  .strict();

export type EpcisPatientWhere = z.infer<typeof epcisPatientWhereSchema>;

// ---------------------------------------------------------------------------
// WHY
// ---------------------------------------------------------------------------
const bizTransactionSchema = z
  .object({
    type: z.enum(["encounter", "transfer"]),
    id: z.string().uuid(),
  })
  .strict();

export const epcisPatientWhySchema = z
  .object({
    // CBV businessStep/disposition en forma corta (sin prefijo urn:epcglobal:cbv:),
    // igual a PATIENT_MOVEMENT_STEP en epcis-builder.ts. Enum cerrado, no texto libre.
    businessStep: z.enum(["arriving", "departing"]),
    disposition: z.enum(["active", "in_transit", "inactive"]),
    bizTransactionList: z.array(bizTransactionSchema),
  })
  .strict();

export type EpcisPatientWhy = z.infer<typeof epcisPatientWhySchema>;

// ---------------------------------------------------------------------------
// WHO
// ---------------------------------------------------------------------------
const sourceListEntrySchema = z
  .object({
    type: z.literal("urn:epcglobal:cbv:sdt:possessing_party"),
    gsrn: gsrn18Schema,
  })
  .strict();

export const epcisPatientWhoSchema = z
  .object({
    sourceList: z.array(sourceListEntrySchema),
    recordedById: z.string().uuid(),
  })
  .strict();

export type EpcisPatientWho = z.infer<typeof epcisPatientWhoSchema>;
