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

/**
 * Definición de una calculadora `nativo`: el cómputo lo hace código dedicado
 * identificado por `engine` (p. ej. "aha-prevent"), no una fórmula/score
 * data-driven. `evaluar` no la resuelve (retorna NaN); la UI la delega a su
 * panel específico. `interp` se conserva por compatibilidad estructural.
 */
export interface CalcDefNativo {
  engine: string;
  out: CalcOut;
  interp: Interp[];
  attribution?: string;
  disclaimer?: string;
}

export type CalcDef = CalcDefFormula | CalcDefScore | CalcDefNativo;

export interface Calc {
  tipo: "formula" | "dosis" | "score" | "nativo";
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
  // Defensa en profundidad (ver validateExpr): las fórmulas se validan al
  // guardar, pero las persistidas antes de este control no pasaron por ahí.
  if (validateExpr(def.expr).length > 0) return NaN;

  // Prototipo nulo: aunque el parser intentara escribir en `__proto__`, no hay
  // cadena de prototipos que contaminar (GHSA-8gw3-rxh4-v6jx).
  const scope: Record<string, number> = Object.create(null) as Record<string, number>;
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

  // Las calculadoras `nativo` (regresiones, multi-salida) no pasan por el motor
  // de fórmulas: la UI las delega a su panel dedicado. Aquí es no-op.
  if (calc.tipo === "nativo") {
    return { resultado: NaN, interp: null };
  }

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
 * Caracteres admitidos en una expresión de fórmula.
 *
 * OWASP A03/A05:2025 — `expr-eval` está sin mantenimiento y arrastra dos
 * advisories SIN fix upstream en ninguna versión publicada:
 *   - GHSA-8gw3-rxh4-v6jx — Prototype Pollution (CWE-1321)
 *   - GHSA-jc85-fpwf-qm7x — no restringe las funciones pasadas a `evaluate`
 *     (CWE-94, ejecución de código)
 *
 * La expresión NO es código del repo: es dato editable desde `/calculadoras`
 * y persistido en `ece.calculadora_version.definicion->>'expr'`. Un admin
 * comprometido podía inyectar `x.__proto__.foo = 1` o acceso indexado.
 *
 * Mitigación capa 1 (esta allowlist): sólo números, identificadores,
 * operadores aritméticos/comparación, ternario, paréntesis y comas. Se
 * excluyen corchetes (acceso indexado), comillas (strings) y las llaves de la
 * cadena de prototipos. Verificado contra las 176 versiones de fórmula en
 * producción (2026-08-17): ninguna usa caracteres fuera de este set.
 *
 * Mitigación capa 2: scope con prototipo nulo en `evalFormula`.
 */
const SAFE_EXPR_CHARS = /^[A-Za-z0-9_.+\-*/%^()<>=!?:,\s]*$/;
const PROTO_KEYS = /(^|[^A-Za-z0-9_])(__proto__|constructor|prototype)([^A-Za-z0-9_]|$)/;

/**
 * Valida que una expresión sea segura de parsear con expr-eval.
 * Retorna lista de mensajes de error (vacía = válida).
 */
export function validateExpr(expr: string): string[] {
  const errors: string[] = [];
  if (!SAFE_EXPR_CHARS.test(expr)) {
    errors.push(
      "La expresión contiene caracteres no permitidos. Sólo se admiten números, " +
        "identificadores, operadores (+ - * / % ^ < > = ! ? :), paréntesis y comas.",
    );
  }
  if (PROTO_KEYS.test(expr)) {
    errors.push(
      'La expresión no puede referenciar "__proto__", "constructor" ni "prototype".',
    );
  }
  return errors;
}

/**
 * Valida que los ids de input no colisionen con palabras reservadas o funciones de expr-eval,
 * y que la expresión pase la allowlist de seguridad.
 * Retorna lista de mensajes de error (vacía = válido).
 */
export function validateInputIds(def: CalcDefFormula): string[] {
  const errors: string[] = validateExpr(def.expr);
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
