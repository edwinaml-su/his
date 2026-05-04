import { z } from "zod";

/**
 * US-4.6 — Vínculo recién-nacido ↔ madre.
 *
 * Schemas de I/O para `newborn.router`. Reutiliza el campo `Patient.motherPatientId`
 * que ya existe en schema.prisma (no requiere migración).
 *
 * Reglas de negocio (DoR):
 *  - Edad del paciente RN: < 28 días al momento del vínculo (definición OMS de neonato).
 *  - Madre con `biologicalSexId` cuyo `code` esté en {F}.
 *  - No auto-vínculo (newbornId !== motherId).
 *  - Máximo 5 hijos vinculados como neonatos simultáneamente
 *    (cap MVP; multi-births reales se modelarán en Sprint 4).
 */

/** Cap de hijos neonatos por madre — protege contra binding accidental. */
export const NEWBORN_MAX_CHILDREN_PER_MOTHER = 5;

/** Edad máxima en días para considerarse neonato (OMS). */
export const NEWBORN_MAX_AGE_DAYS = 28;

export const linkNewbornMotherInput = z.object({
  newbornId: z.string().uuid(),
  motherId: z.string().uuid(),
});

export const unlinkNewbornMotherInput = z.object({
  newbornId: z.string().uuid(),
});

/**
 * Crear paciente RN + setear motherPatientId atómicamente.
 * El MRN se genera dentro del router a partir de la organización.
 */
export const createNewbornInput = z.object({
  motherId: z.string().uuid(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  secondLastName: z.string().max(120).nullable().optional(),
  birthDate: z.coerce.date(),
  biologicalSexId: z.string().uuid(),
  // Datos perinatales básicos — se persisten como snapshot en audit (no hay
  // tabla NewbornPerinatalRecord en MVP; TODO Sprint 4).
  weightGrams: z.number().int().min(200).max(8000).nullable().optional(),
  lengthCm: z.number().min(20).max(70).nullable().optional(),
  apgar1: z.number().int().min(0).max(10).nullable().optional(),
  apgar5: z.number().int().min(0).max(10).nullable().optional(),
});

export type LinkNewbornMotherInput = z.infer<typeof linkNewbornMotherInput>;
export type UnlinkNewbornMotherInput = z.infer<typeof unlinkNewbornMotherInput>;
export type CreateNewbornInput = z.infer<typeof createNewbornInput>;
