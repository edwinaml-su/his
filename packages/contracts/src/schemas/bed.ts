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

export type BedListInput = z.infer<typeof bedListSchema>;
export type BedUpdateStatusInput = z.infer<typeof bedUpdateStatusSchema>;
