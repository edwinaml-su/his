import { describe, it, expect } from "vitest";
import { calcularEdad } from "../edad";

/**
 * CC-0008 §8 — pruebas de la edad derivada (referencia: hoy = 2026-06-26).
 *
 * Se construyen las fechas con el constructor local `new Date(y, mIdx, d)` (mes
 * 0-indexado) para que las aserciones sean estables en cualquier zona horaria:
 * `calcularEdad` usa métodos locales de `Date`, así que mezclar parsing UTC
 * ("YYYY-MM-DD") con métodos locales daría resultados dependientes del offset.
 */
describe("calcularEdad — §8", () => {
  const hoy = new Date(2026, 5, 26); // 2026-06-26 local

  it("cumpleaños aún no alcanzado → años completos", () => {
    expect(calcularEdad(new Date(1990, 6, 14), hoy).label).toBe("35 años");
  });

  it("cumpleaños ya pasado en el año → años completos", () => {
    expect(calcularEdad(new Date(1990, 5, 1), hoy).label).toBe("36 años");
  });

  it("lactante (< 1 año, ≥ 1 mes) → meses", () => {
    expect(calcularEdad(new Date(2026, 4, 1), hoy).label).toBe("1 mes");
  });

  it("recién nacido (< 1 mes) → días", () => {
    expect(calcularEdad(new Date(2026, 5, 20), hoy).label).toBe("6 días");
  });

  it("singular: 1 año", () => {
    expect(calcularEdad(new Date(2025, 5, 26), hoy).label).toBe("1 año");
  });

  it("singular: 1 día", () => {
    expect(calcularEdad(new Date(2026, 5, 25), hoy).label).toBe("1 día");
  });

  it("mismo día → 0 días", () => {
    const r = calcularEdad(new Date(2026, 5, 26), hoy);
    expect(r).toEqual({ anios: 0, meses: 0, dias: 0, label: "0 días" });
  });

  it("expone componentes anios/meses/dias", () => {
    const r = calcularEdad(new Date(1990, 6, 14), hoy);
    expect(r.anios).toBe(35);
    expect(r.meses).toBe(11);
    expect(r.dias).toBe(12);
  });
});
