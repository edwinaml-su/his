import { z } from "zod";

export const eceEvolucionCreateSchema = z.object({
  episodioId: z.string().uuid(),
  fecha: z.coerce.date(),
  // D-3: S/O opcionales — gating en UI (borrador permite vacíos; firmar exige S+O+A+P)
  soapSubjetivo: z.string().trim().max(8000).default(""),
  soapObjetivo: z.string().trim().max(8000).default(""),
  soapAnalisis: z.string().trim().max(8000).default(""),
  soapPlan: z.string().trim().max(8000).default(""),
  // D-1: signosVitalesId en data JSONB (cero SQL)
  data: z
    .object({ signosVitalesId: z.string().uuid().optional() })
    .optional(),
});

export type EceEvolucionCreateInput = z.infer<typeof eceEvolucionCreateSchema>;

export const eceEvolucionUpdateSchema = z.object({
  id: z.string().uuid(),
  soapSubjetivo: z.string().trim().min(1).max(8000).optional(),
  soapObjetivo: z.string().trim().min(1).max(8000).optional(),
  soapAnalisis: z.string().trim().min(1).max(8000).optional(),
  soapPlan: z.string().trim().min(1).max(8000).optional(),
});

export const eceEvolucionListSchema = z.object({
  episodioId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  autorId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});
