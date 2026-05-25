import { z } from "zod";

export const FALL_LUGAR = ["cama", "baño", "pasillo", "silla", "otro"] as const;
export const FALL_TESTIGO_TIPO = [
  "familiar",
  "enfermera",
  "personal_apoyo",
  "otro_paciente",
  "sin_testigo",
] as const;
export const FALL_LESION = ["ninguna", "leve", "moderada", "grave", "muy_grave"] as const;

// Base object schema (sin .superRefine) para permitir .omit/.extend en UI forms.
export const fallEventBaseObjectSchema = z.object({
  pacienteId:              z.string().uuid(),
  episodioId:              z.string().uuid(),
  fechaHora:               z.string().datetime().optional(),
  lugar:                   z.enum(FALL_LUGAR),
  lugarOtro:               z.string().min(1).max(200).optional(),
  testigoPresente:         z.boolean(),
  testigoTipo:             z.enum(FALL_TESTIGO_TIPO).optional(),
  circunstancia:           z.string().min(1).max(2000),
  lesionResultante:        z.enum(FALL_LESION),
  requirioAtencionMedica:  z.boolean(),
  intervencionAplicada:    z.string().max(2000).optional(),
  // PIN claro — se verifica con argon2id y se almacena el hash
  firmaPin:                z.string().min(4),
});

const lugarOtroRefine = (val: z.infer<typeof fallEventBaseObjectSchema>, ctx: z.RefinementCtx) => {
  if (val.lugar === "otro" && !val.lugarOtro) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lugarOtro"],
      message: "lugarOtro es obligatorio cuando lugar es 'otro'.",
    });
  }
};

export const fallEventInputSchema = fallEventBaseObjectSchema.superRefine(lugarOtroRefine);

export const fallEventListInputSchema = z.object({
  episodioId: z.string().uuid().optional(),
  cursor:     z.string().uuid().optional(),
  limit:      z.number().int().min(1).max(100).default(20),
});

export type FallEventInput = z.infer<typeof fallEventInputSchema>;
export type FallEventListInput = z.infer<typeof fallEventListInputSchema>;
