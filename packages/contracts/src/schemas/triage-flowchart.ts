/**
 * @his/contracts — Schemas Manchester flowcharts + discriminadores
 *
 * US-6.3 (Flujogramas Manchester 52) + US-6.4 (Discriminadores activos).
 * Equipo: Mike — Triage Manchester.
 *
 * NOTA: este archivo NO se exporta desde `schemas/index.ts` para no chocar
 * con el sprint paralelo. Importar directo:
 *   import { ... } from "@his/contracts/schemas/triage-flowchart";
 *   o:
 *   import { ... } from "@his/contracts";  ← cuando Sierra lo agregue al barrel.
 */
import { z } from "zod";

// ──────────────────────────── Categorías ────────────────────────────

export const flowchartCategoryEnum = z.enum([
  "TRAUMA",
  "MEDICAL",
  "PEDIATRIC",
  "PSYCHIATRIC",
]);
export type FlowchartCategory = z.infer<typeof flowchartCategoryEnum>;

/**
 * Mapping categoría → códigos canónicos de los 52 Manchester estándar.
 * Inferido por convención (`ped_` prefix → PEDIATRIC, etc.). El campo
 * `category` no existe en `TriageFlowchart` (schema.prisma) — se calcula
 * en el router a partir del `code` y/o `isPediatric`.
 */
export function categoryFromFlowchart(args: {
  code: string;
  isPediatric: boolean;
}): FlowchartCategory {
  if (args.isPediatric || args.code.startsWith("ped_")) return "PEDIATRIC";
  if (
    args.code === "behaving_strangely" ||
    args.code === "mental_illness" ||
    args.code === "self_harm"
  ) {
    return "PSYCHIATRIC";
  }
  if (
    args.code === "burns_and_scalds" ||
    args.code === "catastrophic_event" ||
    args.code === "falls" ||
    args.code === "head_injury" ||
    args.code === "limb_problems" ||
    args.code === "major_trauma" ||
    args.code === "torso_injury" ||
    args.code === "wounds" ||
    args.code === "back_pain" ||
    args.code === "neck_pain"
  ) {
    return "TRAUMA";
  }
  return "MEDICAL";
}

// ─────────────────────── List / get inputs ───────────────────────

export const listFlowchartsInputSchema = z
  .object({
    category: flowchartCategoryEnum.optional(),
    /** Búsqueda por nombre o code (ILIKE). */
    search: z.string().trim().max(80).optional(),
    /** Si se omite, devuelve sólo activos. */
    includeInactive: z.boolean().optional().default(false),
  })
  .optional();
export type ListFlowchartsInput = z.infer<typeof listFlowchartsInputSchema>;

export const getFlowchartInputSchema = z.object({
  id: z.string().uuid(),
});
export type GetFlowchartInput = z.infer<typeof getFlowchartInputSchema>;

export const listForTriageInputSchema = z.object({
  triageEvaluationId: z.string().uuid(),
});
export type ListForTriageInput = z.infer<typeof listForTriageInputSchema>;

// ─────────────────────── Mutations admin ───────────────────────

export const setFlowchartActiveInputSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});
export type SetFlowchartActiveInput = z.infer<typeof setFlowchartActiveInputSchema>;

// ─────────────────────── DTOs de salida ───────────────────────

export const triageColorOutEnum = z.enum([
  "RED",
  "ORANGE",
  "YELLOW",
  "GREEN",
  "BLUE",
]);
export type TriageColorOut = z.infer<typeof triageColorOutEnum>;

export const flowchartListItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  isPediatric: z.boolean(),
  active: z.boolean(),
  category: flowchartCategoryEnum,
  discriminatorCount: z.number().int(),
});
export type FlowchartListItem = z.infer<typeof flowchartListItemSchema>;

export const discriminatorOutSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  text: z.string(),
  ordinal: z.number().int(),
  active: z.boolean(),
  resultLevel: z.object({
    id: z.string().uuid(),
    color: triageColorOutEnum,
    name: z.string(),
    priority: z.number().int(),
    maxWaitMinutes: z.number().int(),
    uiColorHex: z.string().nullable(),
  }),
});
export type DiscriminatorOut = z.infer<typeof discriminatorOutSchema>;

export const flowchartDetailSchema = flowchartListItemSchema.extend({
  defaultLevelId: z.string().uuid().nullable(),
  discriminators: z.array(discriminatorOutSchema),
});
export type FlowchartDetail = z.infer<typeof flowchartDetailSchema>;
