/**
 * Validación AHA PREVENT™ contra los casos oficiales de referencia del repo
 * origen (martingmayer/preventr — snapshot `estimate_risk.md`). Los 4 casos ×
 * 2 sexos = 8 pruebas deben reproducir los valores publicados a 1 decimal.
 */
import { describe, expect, it } from "vitest";
import { calcularPrevent } from "./prevent";

const BASE = {
  age: 50,
  totalCholesterol: 200,
  hdlCholesterol: 45,
  systolicBP: 160,
  eGFR: 90,
  bmi: 35,
  diabetes: true,
  smoking: false,
  onStatin: false,
  onBPMeds: true,
} as const;

const CASES = [
  {
    name: "base 10yr",
    input: { ...BASE, horizon: "10yr" as const },
    female: { total_cvd: 14.7, ascvd: 9.2, heart_failure: 8.1, chd: 4.4, stroke: 5.4 },
    male: { total_cvd: 16.3, ascvd: 10.2, heart_failure: 10.6, chd: 5.6, stroke: 5.2 },
  },
  {
    name: "base 30yr",
    input: { ...BASE, horizon: "30yr" as const },
    female: { total_cvd: 53.0, ascvd: 35.4, heart_failure: 39.0, chd: 19.8, stroke: 22.1 },
    male: { total_cvd: 51.4, ascvd: 34.9, heart_failure: 42.4, chd: 21.6, stroke: 19.7 },
  },
  {
    name: "uacr 10yr",
    input: { ...BASE, uacr: 40, horizon: "10yr" as const },
    female: { total_cvd: 16.0, ascvd: 9.9, heart_failure: 8.9, chd: 4.8, stroke: 5.9 },
    male: { total_cvd: 17.2, ascvd: 11.0, heart_failure: 11.0, chd: 5.9, stroke: 5.6 },
  },
  {
    name: "hba1c 10yr",
    input: { ...BASE, hba1c: 7.5, horizon: "10yr" as const },
    female: { total_cvd: 13.6, ascvd: 8.3, heart_failure: 8.1, chd: 4.1, stroke: 4.6 },
    male: { total_cvd: 15.5, ascvd: 9.4, heart_failure: 10.1, chd: 5.1, stroke: 4.7 },
  },
] as const;

describe("PREVENT — validación oficial (repo origen preventr)", () => {
  for (const c of CASES) {
    for (const sex of ["female", "male"] as const) {
      it(`${c.name} — ${sex}`, () => {
        const res = calcularPrevent({ ...c.input, sex });
        const expected = c[sex];
        for (const [outcome, val] of Object.entries(expected)) {
          expect(res.risks[outcome as keyof typeof res.risks]).toBeCloseTo(val, 1);
        }
      });
    }
  }
});

describe("PREVENT — selección de modelo y validación", () => {
  it("elige hba1c sobre uacr cuando ambos presentes", () => {
    const res = calcularPrevent({ ...BASE, sex: "female", hba1c: 7.5, uacr: 40, horizon: "10yr" });
    expect(res.model).toBe("hba1c");
  });

  it("elige base cuando no hay hba1c ni uacr", () => {
    const res = calcularPrevent({ ...BASE, sex: "male", horizon: "10yr" });
    expect(res.model).toBe("base");
  });

  it("rechaza edad fuera de rango 30–79", () => {
    expect(() => calcularPrevent({ ...BASE, sex: "male", age: 85, horizon: "10yr" })).toThrow();
  });

  it("rechaza HDL ≥ colesterol total", () => {
    expect(() =>
      calcularPrevent({ ...BASE, sex: "male", hdlCholesterol: 250, horizon: "10yr" }),
    ).toThrow();
  });
});
