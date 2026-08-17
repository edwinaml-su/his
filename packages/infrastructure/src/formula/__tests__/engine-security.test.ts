/**
 * Seguridad del motor de fórmulas clínicas — OWASP A03/A05:2025.
 *
 * `expr-eval` no tiene fix upstream para GHSA-8gw3-rxh4-v6jx (prototype
 * pollution) ni GHSA-jc85-fpwf-qm7x (funciones sin restringir). Como la
 * expresión es DATO editable desde `/calculadoras`, el motor la valida contra
 * una allowlist y evalúa con scope de prototipo nulo.
 *
 * Estos tests fijan las dos capas + verifican que las fórmulas legítimas
 * (mismo charset que las 176 versiones en producción) siguen evaluando igual.
 */
import { describe, it, expect } from "vitest";
import { evalFormula, validateExpr, validateInputIds } from "../engine";
import type { CalcDefFormula } from "../engine";

function def(expr: string, ids: string[] = ["a", "b"]): CalcDefFormula {
  return {
    inputs: ids.map((id) => ({ id, label: id })),
    expr,
    out: { label: "r", u: "", dec: 2 },
    interp: [],
  };
}

describe("validateExpr — allowlist", () => {
  it("acepta las formas usadas por las calculadoras reales", () => {
    const reales = [
      "a / (b * b)",
      "703 * a / (b ^ 2)",
      "a > 18 ? 1 : 0",
      "min(a, b) + max(a, b)",
      "log10(a) * 2.5",
      "a_1 + b_2 - 1.5",
      "a >= 40 ? a * 0.85 : a",
    ];
    for (const expr of reales) {
      expect(validateExpr(expr), expr).toEqual([]);
    }
  });

  it("rechaza acceso indexado y strings", () => {
    expect(validateExpr("a['__proto__']").length).toBeGreaterThan(0);
    expect(validateExpr('a + "x"').length).toBeGreaterThan(0);
    expect(validateExpr("a; b").length).toBeGreaterThan(0);
  });

  it("rechaza las llaves de la cadena de prototipos", () => {
    expect(validateExpr("a.__proto__.polluted").length).toBeGreaterThan(0);
    expect(validateExpr("a.constructor").length).toBeGreaterThan(0);
    expect(validateExpr("a.prototype").length).toBeGreaterThan(0);
  });

  it("no confunde identificadores que contienen la subcadena", () => {
    // `constructorScore` es un id válido; no debe bloquearse por contener "constructor".
    expect(validateExpr("constructorScore + 1")).toEqual([]);
  });

  it("validateInputIds propaga los errores de expresión", () => {
    const errs = validateInputIds(def("a['__proto__']"));
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe("evalFormula — evaluación", () => {
  it("evalúa fórmulas válidas", () => {
    expect(evalFormula(def("a / (b * b)"), { a: 70, b: 1.75 })).toBeCloseTo(22.857, 3);
    expect(evalFormula(def("a > 18 ? 1 : 0"), { a: 20, b: 0 })).toBe(1);
  });

  it("devuelve NaN ante una expresión no permitida (defensa en profundidad)", () => {
    expect(evalFormula(def("a['x']"), { a: 1, b: 2 })).toBeNaN();
  });

  it("no contamina Object.prototype al evaluar", () => {
    // Aunque la expresión pasara la allowlist, el scope tiene prototipo nulo.
    evalFormula(def("a + b"), { a: 1, b: 2 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
