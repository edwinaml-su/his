/**
 * Schemas Zod para ECE URPA — Unidad de Recuperación Post-Anestésica.
 *
 * Escala Aldrete (0-10): suma de 5 ítems (0-2 c/u).
 *   ≥9  → alta estándar (criterio "cumple").
 *   5-8 → observación prolongada ("no_cumple_observacion").
 *   ≤4  → traslado UCI ("trasladar_uci").
 */
import { z } from "zod";

// ─── Sub-schema: medicamento administrado ───────────────────────────────────

export const urpaMedicamentoSchema = z.object({
  nombre: z.string().min(1).max(200),
  dosis: z.string().min(1).max(100),
  via: z.string().min(1).max(50),
  administrado_en: z.string().datetime({ offset: true }),
});

export type UrpaMedicamento = z.infer<typeof urpaMedicamentoSchema>;

// ─── Escala Aldrete ──────────────────────────────────────────────────────────

const aldreteSchema = z
  .number({ required_error: "Escala Aldrete es requerida." })
  .int("Aldrete debe ser entero.")
  .min(0, "Aldrete mínimo 0.")
  .max(10, "Aldrete máximo 10.");

// ─── Criterio de alta ────────────────────────────────────────────────────────

export const criteriAltaSchema = z.enum([
  "cumple",
  "no_cumple_observacion",
  "trasladar_uci",
]);

export type CriterioAlta = z.infer<typeof criteriAltaSchema>;

// ─── Create ─────────────────────────────────────────────────────────────────

export const eceUrpaCreateSchema = z.object({
  actoQuirurgicoId: z.string().uuid(),
  ingresoUrpaTs: z.string().datetime({ offset: true }).optional(),
  escalaAldreteIngreso: aldreteSchema,
  medicamentosAdministrados: z.array(urpaMedicamentoSchema).default([]),
  complicaciones: z.string().max(2000).optional(),
});

export type EceUrpaCreateInput = z.infer<typeof eceUrpaCreateSchema>;

// ─── Registrar signos (actualización parcial de campos clínicos) ─────────────

export const eceUrpaRegistrarSignosSchema = z.object({
  id: z.string().uuid(),
  medicamentosAdministrados: z.array(urpaMedicamentoSchema).optional(),
  complicaciones: z.string().max(2000).optional(),
});

export type EceUrpaRegistrarSignosInput = z.infer<typeof eceUrpaRegistrarSignosSchema>;

// ─── Dar alta ───────────────────────────────────────────────────────────────

export const eceUrpaDarAltaSchema = z
  .object({
    id: z.string().uuid(),
    escalaAldreteAlta: aldreteSchema,
    criterioAlta: criteriAltaSchema,
    altaUrpaTs: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (data) => {
      // Si Aldrete ≥9 el criterio debe ser "cumple".
      // Si Aldrete <9 el criterio NO puede ser "cumple".
      if (data.escalaAldreteAlta >= 9 && data.criterioAlta !== "cumple") return false;
      if (data.escalaAldreteAlta < 9 && data.criterioAlta === "cumple") return false;
      return true;
    },
    {
      message:
        "Aldrete ≥9 requiere criterio 'cumple'. Aldrete <9 requiere 'no_cumple_observacion' o 'trasladar_uci'.",
      path: ["criterioAlta"],
    },
  );

export type EceUrpaDarAltaInput = z.infer<typeof eceUrpaDarAltaSchema>;
