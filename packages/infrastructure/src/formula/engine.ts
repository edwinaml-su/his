/**
 * Motor de fórmulas clínicas — framework-agnóstico.
 * Replica EXACTAMENTE el comportamiento del mockup (calculadoras-clinicas.html líneas 2326-2352).
 * NO usa eval() ni new Function(). Delegado a expr-eval.
 *
 * MOTOR-1: log = natural; log10(x) = log(x)/log(10). ^ = potencia.
 * MOTOR-2: ids reservados prohibidos: and, or, not, in.
 * MOTOR-3: ids que colisionan con funciones: min, max, log, exp, sqrt, abs, floor, round, log10.
 */
import { Parser } from "expr-eval";

// Una sola instancia — la construcción del Parser tiene overhead.
const parser = new Parser();

// ---------- Tipos públicos ----------

export interface CalcOpt {
  v: string;
  f?: number;
  [k: string]: number | string | undefined;
}

export interface CalcInput {
  id: string;
  label: string;
  u?: string;
  min?: number;
  max?: number;
  val?: number;
  type?: "select";
  opts?: CalcOpt[];
  sel?: number;
  srcLabel?: string;
}

export interface CalcItem {
  id: string;
  label: string;
  p: number;
}

export interface CalcOut {
  label: string;
  u: string;
  dec: number;
}

export interface Interp {
  min?: number;
  max?: number;
  n: "normal" | "alerta" | "critico";
  t: string;
}

export interface CalcDefFormula {
  inputs: CalcInput[];
  expr: string;
  out: CalcOut;
  interp: Interp[];
}

export interface CalcDefScore {
  items: CalcItem[];
  out: CalcOut;
  interp: Interp[];
}

export type CalcDef = CalcDefFormula | CalcDefScore;

export interface Calc {
  tipo: "formula" | "dosis" | "score";
  def: CalcDef;
}

export interface EvalResult {
  resultado: number;
  interp: Interp | null;
}

// ---------- Funciones públicas ----------

/**
 * Evalúa una fórmula numérica.
 * scope: inputs numéricos → scope[id]; selects → scope[id+"_"+k] por cada prop numérica k, más scope[id+"F"] si opt.f existe.
 * Devuelve NaN si la expresión falla.
 */
export function evalFormula(
  def: CalcDefFormula,
  values: Record<string, string | number>,
): number {
  const scope: Record<string, number> = {};
  for (const inp of def.inputs) {
    if (inp.type === "select") {
      const idx =
        typeof values[inp.id] === "number"
          ? (values[inp.id] as number)
          : parseInt(String(values[inp.id]), 10);
      const opt = inp.opts?.[idx];
      if (!opt) return NaN;
      if (opt.f !== undefined) {
        scope[inp.id + "F"] = opt.f as number;
      }
      for (const k of Object.keys(opt)) {
        if (typeof opt[k] === "number") {
          scope[inp.id + "_" + k] = opt[k] as number;
        }
      }
    } else {
      scope[inp.id] = parseFloat(String(values[inp.id]));
    }
  }
  try {
    return parser.parse(def.expr).evaluate(scope) as number;
  } catch {
    return NaN;
  }
}

/**
 * Evalúa un score sumando los puntos de los ítems marcados.
 */
export function evalScore(
  def: CalcDefScore,
  checked: Record<string, boolean>,
): number {
  return def.items.reduce((s, it) => s + (checked[it.id] ? it.p : 0), 0);
}

/**
 * Clasifica un valor numérico según el arreglo de interpretaciones.
 * Primera regla donde (sin min OR val>=min) AND (sin max OR val<=max).
 * Si ninguna aplica, retorna la última (regla abierta final).
 */
export function classify(interp: Interp[], val: number): Interp {
  for (const r of interp) {
    const okMin = r.min === undefined || val >= r.min;
    const okMax = r.max === undefined || val <= r.max;
    if (okMin && okMax) return r;
  }
  return interp[interp.length - 1]!;
}

/**
 * Despachador principal. Evalúa la calculadora y clasifica el resultado.
 * entradas: { [inputId]: string|number } para formula/dosis; { [itemId]: boolean } para score.
 */
export function evaluar(
  calc: Calc,
  entradas: Record<string, string | number | boolean>,
): EvalResult {
  let resultado: number;

  if (calc.tipo === "score") {
    const def = calc.def as CalcDefScore;
    resultado = evalScore(def, entradas as Record<string, boolean>);
  } else {
    const def = calc.def as CalcDefFormula;
    resultado = evalFormula(def, entradas as Record<string, string | number>);
  }

  if (!isFinite(resultado)) {
    return { resultado, interp: null };
  }

  const interp = classify(calc.def.interp, resultado);
  return { resultado, interp };
}

// ---------- Validación al guardar ----------

const RESERVED_IDS = new Set(["and", "or", "not", "in"]);
// Funciones built-in de expr-eval que colisionarían con ids de input
const FUNCTION_NAMES = new Set([
  "min",
  "max",
  "log",
  "exp",
  "sqrt",
  "abs",
  "floor",
  "round",
  "log10",
]);

/**
 * Valida que los ids de input no colisionen con palabras reservadas o funciones de expr-eval.
 * Retorna lista de mensajes de error (vacía = válido).
 */
export function validateInputIds(def: CalcDefFormula): string[] {
  const errors: string[] = [];
  for (const inp of def.inputs) {
    if (RESERVED_IDS.has(inp.id)) {
      errors.push(
        `id "${inp.id}" es una palabra reservada de expr-eval (and, or, not, in). Renombrar (ej. "${inp.id}" → "${inp.id}q").`,
      );
    }
    if (FUNCTION_NAMES.has(inp.id)) {
      errors.push(
        `id "${inp.id}" colisiona con una función del motor (${[...FUNCTION_NAMES].join(", ")}). Renombrar.`,
      );
    }
  }
  return errors;
}
