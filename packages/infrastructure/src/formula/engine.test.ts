import { describe, it, expect } from "vitest";
import {
  evalFormula,
  evalScore,
  classify,
  evaluar,
  validateInputIds,
  type CalcDefFormula,
  type CalcDefScore,
  type Interp,
} from "./engine";

// ---------- Cockcroft-Gault (CALC-NEFRO-001) ----------
const cgDef: CalcDefFormula = {
  inputs: [
    { id: "edad", label: "Edad", u: "años", val: 65 },
    { id: "peso", label: "Peso", u: "kg", val: 70 },
    { id: "crea", label: "Creatinina", u: "mg/dL", val: 1.2 },
    {
      id: "sexo",
      type: "select",
      label: "Sexo",
      opts: [{ v: "Masculino", f: 1 }, { v: "Femenino", f: 0.85 }],
      sel: 1,
    },
  ],
  expr: "((140 - edad) * peso / (72 * crea)) * sexoF",
  out: { label: "Depuración de creatinina", u: "mL/min", dec: 1 },
  interp: [
    { max: 30, n: "critico", t: "Deterioro grave" },
    { max: 60, n: "alerta", t: "Deterioro moderado" },
    { n: "normal", t: "Función renal adecuada" },
  ],
};

describe("evalFormula – Cockcroft-Gault", () => {
  it("masculino: ((140-65)*70/(72*1.2))*1 ≈ 60.76", () => {
    const result = evalFormula(cgDef, {
      edad: 65,
      peso: 70,
      crea: 1.2,
      sexo: 0, // masculino → f:1
    });
    expect(result).toBeCloseTo(60.76, 1);
  });

  it("femenino: multiplica por 0.85 ≈ 51.65", () => {
    const result = evalFormula(cgDef, {
      edad: 65,
      peso: 70,
      crea: 1.2,
      sexo: 1, // femenino → f:0.85
    });
    expect(result).toBeCloseTo(51.65, 1);
  });

  it("devuelve NaN con opt index inválido", () => {
    const result = evalFormula(cgDef, { edad: 65, peso: 70, crea: 1.2, sexo: 99 });
    expect(result).toBeNaN();
  });
});

// ---------- CKD-EPI 2021 (CALC-NEFRO-002) — select inyecta sexo_k, sexo_a, sexo_mult ----------
const ckdDef: CalcDefFormula = {
  inputs: [
    { id: "edad", label: "Edad", u: "años" },
    { id: "crea", label: "Creatinina", u: "mg/dL" },
    {
      id: "sexo",
      type: "select",
      label: "Sexo",
      opts: [
        { v: "Masculino", k: 0.9, a: -0.302, mult: 1 },
        { v: "Femenino", k: 0.7, a: -0.241, mult: 1.012 },
      ],
      sel: 0,
    },
  ],
  expr: "142 * min(crea/sexo_k,1)^(sexo_a) * max(crea/sexo_k,1)^(-1.2) * 0.9938^edad * sexo_mult",
  out: { label: "TFG estimada", u: "mL/min/1.73m²", dec: 0 },
  interp: [
    { max: 29, n: "critico", t: "TFG muy baja" },
    { max: 59, n: "alerta", t: "TFG reducida" },
    { max: 89, n: "normal", t: "Levemente reducida" },
    { n: "normal", t: "TFG normal" },
  ],
};

describe("evalFormula – CKD-EPI 2021 (select con múltiples props numéricas)", () => {
  it("masculino edad=45 crea=0.8 → resultado finito y >60", () => {
    const result = evalFormula(ckdDef, { edad: 45, crea: 0.8, sexo: 0 });
    expect(isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(60);
  });

  it("femenino edad=60 crea=1.5 → resultado finito", () => {
    const result = evalFormula(ckdDef, { edad: 60, crea: 1.5, sexo: 1 });
    expect(isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });
});

// ---------- CHA₂DS₂-VASc (CALC-CARD-001) — score ----------
const chasDef: CalcDefScore = {
  items: [
    { id: "icc", label: "Insuficiencia cardíaca", p: 1 },
    { id: "hta", label: "Hipertensión", p: 1 },
    { id: "edad75", label: "Edad ≥ 75", p: 2 },
    { id: "dm", label: "Diabetes mellitus", p: 1 },
    { id: "acv", label: "ACV previo", p: 2 },
    { id: "vasc", label: "Enfermedad vascular", p: 1 },
    { id: "edad65", label: "Edad 65-74", p: 1 },
    { id: "sexoF", label: "Sexo femenino", p: 1 },
  ],
  out: { label: "Puntaje", u: "puntos", dec: 0 },
  interp: [
    { max: 0, n: "normal", t: "Riesgo bajo" },
    { max: 1, n: "alerta", t: "Riesgo intermedio" },
    { n: "critico", t: "Riesgo alto" },
  ],
};

describe("evalScore – CHA₂DS₂-VASc", () => {
  it("sin checks → 0", () => {
    expect(evalScore(chasDef, {})).toBe(0);
  });

  it("icc + dm + vasc → 3", () => {
    expect(evalScore(chasDef, { icc: true, dm: true, vasc: true })).toBe(3);
  });

  it("edad75 + acv → 4 (ambos valen 2)", () => {
    expect(evalScore(chasDef, { edad75: true, acv: true })).toBe(4);
  });

  it("todo marcado → 10 (1+1+2+1+2+1+1+1)", () => {
    const all: Record<string, boolean> = {};
    for (const it of chasDef.items) all[it.id] = true;
    expect(evalScore(chasDef, all)).toBe(10);
  });
});

// ---------- classify ----------
describe("classify", () => {
  const interp: Interp[] = [
    { max: 30, n: "critico", t: "Grave" },
    { max: 60, n: "alerta", t: "Moderado" },
    { n: "normal", t: "Normal" }, // regla abierta sin max
  ];

  it("valor en primera banda (15) → critico", () => {
    expect(classify(interp, 15).n).toBe("critico");
  });

  it("borde exacto de primera banda (30) → critico", () => {
    expect(classify(interp, 30).n).toBe("critico");
  });

  it("valor en segunda banda (45) → alerta", () => {
    expect(classify(interp, 45).n).toBe("alerta");
  });

  it("valor sobre la última banda (90) → normal (regla abierta)", () => {
    expect(classify(interp, 90).n).toBe("normal");
  });

  it("retorna última regla si ninguna aplica (fallback)", () => {
    // Un interp con min que ningún valor satisface
    const strict: Interp[] = [{ min: 100, n: "critico", t: "Muy alto" }];
    expect(classify(strict, 50).n).toBe("critico"); // fallback = última
  });
});

// ---------- ternario/and/or en expr ----------
describe("evalFormula – ternario y operadores lógicos", () => {
  const gcsDef: CalcDefFormula = {
    inputs: [{ id: "gcs", label: "GCS", u: "puntos" }],
    // ternario con comparaciones
    expr: "gcs == 15 ? 1 : (gcs >= 13 ? 2 : 3)",
    out: { label: "Nivel", u: "", dec: 0 },
    interp: [{ n: "normal", t: "OK" }],
  };

  it("gcs=15 → 1", () => expect(evalFormula(gcsDef, { gcs: 15 })).toBe(1));
  it("gcs=13 → 2", () => expect(evalFormula(gcsDef, { gcs: 13 })).toBe(2));
  it("gcs=10 → 3", () => expect(evalFormula(gcsDef, { gcs: 10 })).toBe(3));
});

// ---------- evaluar (despachador) ----------
describe("evaluar", () => {
  it("formula: CG masculino retorna resultado + interp", () => {
    const calc = { tipo: "formula" as const, def: cgDef };
    const { resultado, interp } = evaluar(calc, { edad: 65, peso: 70, crea: 1.2, sexo: 0 });
    expect(isFinite(resultado)).toBe(true);
    expect(interp).not.toBeNull();
  });

  it("score: CHA2DS2-VASc sin checks → normal", () => {
    const calc = { tipo: "score" as const, def: chasDef };
    const { resultado, interp } = evaluar(calc, {});
    expect(resultado).toBe(0);
    expect(interp?.n).toBe("normal");
  });

  it("formula con inputs inválidos → interp null", () => {
    const calc = { tipo: "formula" as const, def: cgDef };
    const { resultado, interp } = evaluar(calc, { edad: NaN, peso: 70, crea: 1.2, sexo: 0 });
    // NaN scope → NaN resultado → interp null
    expect(isFinite(resultado)).toBe(false);
    expect(interp).toBeNull();
  });
});

// ---------- validateInputIds ----------
describe("validateInputIds", () => {
  const buildDef = (ids: string[]): CalcDefFormula => ({
    inputs: ids.map((id) => ({ id, label: id })),
    expr: "0",
    out: { label: "", u: "", dec: 0 },
    interp: [],
  });

  it("id 'or' → error reservado", () => {
    const errs = validateInputIds(buildDef(["or"]));
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain("or");
  });

  it("id 'max' → error colisión con función", () => {
    const errs = validateInputIds(buildDef(["max"]));
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain("max");
  });

  it("ids válidos → sin errores", () => {
    expect(validateInputIds(buildDef(["edad", "peso", "crea"]))).toHaveLength(0);
  });

  it("múltiples problemas → múltiples errores", () => {
    const errs = validateInputIds(buildDef(["and", "min", "peso"]));
    expect(errs.length).toBe(2);
  });
});
