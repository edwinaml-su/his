/**
 * US-5.5 — Alta + epicrisis.
 *
 * Equipo Lima · Sprint 3.
 *
 * Contrato del router dedicado `encounter-discharge.router.ts`. El
 * `dischargeSchema` legacy (en `encounter.ts`) mantiene el mutation
 * minimalista que usa hoy `encounter.discharge`. Este nuevo contrato
 * añade la epicrisis estructurada exigida por la historia (resumen,
 * indicaciones, próxima cita) y resuelve el diagnóstico por código
 * CIE-10 en lugar de UUID directo.
 *
 * NO se registra en `schemas/index.ts` por restricción del Sprint 3.
 */
import { z } from "zod";
// Reusa la definición canónica del enum (encounter.ts) — el original duplicado
// causaba conflicto de re-export en el barrel `schemas/index.ts`.
import { dischargeTypeEnum } from "./encounter";

export { dischargeTypeEnum };

/** Input para `encounter-discharge.dischargeEncounter`. */
export const dischargeEncounterInput = z.object({
  encounterId: z.string().uuid(),
  dischargeType: dischargeTypeEnum,
  /** CIE-10 (o sistema configurado). El router resuelve a `ClinicalConcept.id`. */
  primaryDiagnosisCode: z.string().trim().min(1).max(60),
  primaryDiagnosisDesc: z.string().trim().min(1).max(400),
  summary: z.string().trim().max(4000).optional(),
  indicationsHome: z.string().trim().max(4000).optional(),
  followUpAppointment: z
    .object({
      at: z.coerce.date(),
      notes: z.string().trim().max(400).optional(),
    })
    .optional(),
});

/** Input para `encounter-discharge.epicrisis`. */
export const epicrisisInput = z.object({
  encounterId: z.string().uuid(),
});

/**
 * Estructura persistida en `Encounter.notes` o (TODO Sprint 4) en
 * `audit.AuditLog.afterJson` mientras no exista la tabla `Epicrisis`.
 * Mantenemos el shape aquí para que UI y router compartan tipo.
 */
export const epicrisisDocSchema = z.object({
  version: z.literal(1),
  primaryDiagnosis: z.object({
    code: z.string(),
    display: z.string(),
    conceptId: z.string().uuid().nullable(),
  }),
  summary: z.string().optional(),
  indicationsHome: z.string().optional(),
  followUpAppointment: z
    .object({
      at: z.string(), // ISO
      notes: z.string().optional(),
    })
    .optional(),
  generatedAt: z.string(), // ISO
  generatedBy: z.string().uuid(),
});

export type DischargeEncounterInput = z.infer<typeof dischargeEncounterInput>;
export type EpicrisisInput = z.infer<typeof epicrisisInput>;
export type EpicrisisDoc = z.infer<typeof epicrisisDocSchema>;
