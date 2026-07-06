import { z } from "zod";

// ---------- Input ----------

const calcOptSchema = z
  .object({
    v: z.string(), // etiqueta visible — no se inyecta en scope
  })
  // props numéricas adicionales (f, k, a, mult, base, pts, g, …) vía passthrough
  .catchall(z.union([z.string(), z.number()]));

export const calcInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  u: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  val: z.number().optional(),
  type: z.literal("select").optional(),
  opts: z.array(calcOptSchema).optional(),
  sel: z.number().int().optional(),
  srcLabel: z.string().optional(),
});

export type CalcInput = z.infer<typeof calcInputSchema>;

// ---------- Item (score) ----------

export const calcItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  p: z.number(),
});

export type CalcItem = z.infer<typeof calcItemSchema>;

// ---------- Out ----------

export const calcOutSchema = z.object({
  label: z.string(),
  u: z.string(),
  dec: z.number().int().min(0),
});

export type CalcOut = z.infer<typeof calcOutSchema>;

// ---------- Interpretación ----------

export const calcInterpSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  n: z.enum(["normal", "alerta", "critico"]),
  t: z.string(),
});

export type CalcInterp = z.infer<typeof calcInterpSchema>;

// ---------- Definición discriminada por tipo ----------

const calcDefFormulaSchema = z.object({
  inputs: z.array(calcInputSchema),
  expr: z.string(),
  out: calcOutSchema,
  interp: z.array(calcInterpSchema),
});

const calcDefScoreSchema = z.object({
  items: z.array(calcItemSchema),
  out: calcOutSchema,
  interp: z.array(calcInterpSchema),
});

/**
 * Calculadora `nativo`: el cómputo NO es una fórmula/score data-driven sino
 * código dedicado identificado por `engine` (p. ej. "aha-prevent"), evaluado
 * por el motor correspondiente en `@his/infrastructure/formula`. `interp` se
 * mantiene por compatibilidad estructural (normalmente vacío: el panel nativo
 * renderiza su propia interpretación multi-salida).
 */
const calcDefNativoSchema = z.object({
  engine: z.string().min(1),
  out: calcOutSchema,
  interp: z.array(calcInterpSchema),
  attribution: z.string().optional(),
  disclaimer: z.string().optional(),
});

/**
 * Acepta las tres formas; en runtime valida según el tipo que acompañe.
 * Disjuntas por llave discriminante (`inputs`+`expr` / `items` / `engine`).
 * La discriminación real ocurre en la cabecera `calculadoraSchema`.
 */
export const calcDefinicionSchema = z.union([
  calcDefFormulaSchema,
  calcDefScoreSchema,
  calcDefNativoSchema,
]);

export type CalcDefinicion = z.infer<typeof calcDefinicionSchema>;

// ---------- Cabecera de calculadora ----------

export const calculadoraSchema = z.object({
  codigo: z.string(), // CALC-{AREA}-NNN
  nombre: z.string(),
  tipo: z.enum(["formula", "score", "dosis", "nativo"]),
  cat: z.string(),
  ver: z.number().int().min(1),
  hr: z.boolean(), // alto riesgo
  paises: z
    .object({ SV: z.boolean(), GT: z.boolean(), HN: z.boolean() })
    .partial(),
  paginas: z.union([z.literal("*"), z.array(z.string())]),
  sub: z.string().optional(),
  ref: z.string().optional(),
  estado: z.enum(["borrador", "publicada", "retirada"]),
  def: calcDefinicionSchema,
});

export type Calculadora = z.infer<typeof calculadoraSchema>;
export type CalculadoraDef = z.infer<typeof calcDefinicionSchema>;
