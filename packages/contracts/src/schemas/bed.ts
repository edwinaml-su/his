import { z } from "zod";

export const bedStatusEnum = z.enum([
  "FREE",
  "OCCUPIED",
  "DIRTY",
  "BLOCKED",
  "MAINTENANCE",
  "RESERVED",
]);

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
