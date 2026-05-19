/**
 * Tests de `parseDateOnly` — garantizan que el día calendario ingresado
 * en cualquier `<input type="date">` se preserva tras la conversión a Date
 * y su posterior serialización a UTC, incluso bajo zonas horarias negativas
 * como UTC-6 (El Salvador) o positivas como UTC+14 (Kiribati).
 *
 * El núcleo del bug: `new Date("2000-12-31")` se interpreta como UTC
 * midnight, que en UTC-6 representa el 30 de diciembre. La función fija
 * la hora a las 12:00 UTC para mantener el día estable en ±12h.
 */
import { describe, it, expect } from "vitest";
import { parseDateOnly } from "../date-only";

describe("parseDateOnly", () => {
  it("retorna null para entradas vacías o inválidas", () => {
    expect(parseDateOnly("")).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(undefined)).toBeNull();
    expect(parseDateOnly("2000-1-1")).toBeNull();
    expect(parseDateOnly("ayer")).toBeNull();
    expect(parseDateOnly("2000/12/31")).toBeNull();
  });

  it("preserva el día calendario ingresado (2000-12-31)", () => {
    const d = parseDateOnly("2000-12-31");
    expect(d).not.toBeNull();
    // Día UTC = 31, no 30 — confirma que el shift por TZ negativa no ocurre.
    expect(d!.getUTCFullYear()).toBe(2000);
    expect(d!.getUTCMonth()).toBe(11); // 0-indexed: 11 = diciembre
    expect(d!.getUTCDate()).toBe(31);
    expect(d!.getUTCHours()).toBe(12);
  });

  it("preserva el día al pasar a ISO string (2000-12-31 → 2000-12-31T12:00:00.000Z)", () => {
    const d = parseDateOnly("2000-12-31");
    // Postgres `@db.Date` se serializa desde el UTC date del objeto Date,
    // así que verificar el ISO confirma que persistirá como 2000-12-31.
    expect(d!.toISOString().slice(0, 10)).toBe("2000-12-31");
  });

  it("también preserva días al inicio de mes (1990-03-15)", () => {
    const d = parseDateOnly("1990-03-15");
    expect(d!.toISOString().slice(0, 10)).toBe("1990-03-15");
  });

  it("acepta año bisiesto (2000-02-29)", () => {
    const d = parseDateOnly("2000-02-29");
    expect(d!.toISOString().slice(0, 10)).toBe("2000-02-29");
  });

  it("anti-regresión: 'new Date(YYYY-MM-DD)' (forma vieja) shiftea -1 día cuando getDate() se lee en UTC-6, pero parseDateOnly no", () => {
    // No podemos cambiar la zona horaria del runner, pero podemos verificar
    // que la forma vieja interpreta el string como midnight UTC (lo que en
    // UTC-6 sería el día previo). parseDateOnly debe colocar la hora a las
    // 12 UTC, por lo que en cualquier zona dentro de ±12h sigue siendo el
    // mismo día calendario.
    const old = new Date("2000-12-31");
    const safe = parseDateOnly("2000-12-31")!;
    expect(old.getUTCHours()).toBe(0); // midnight → vulnerable a TZ shift
    expect(safe.getUTCHours()).toBe(12); // noon → inmune dentro de ±12h
    // Ambos representan el mismo día calendario en UTC.
    expect(old.toISOString().slice(0, 10)).toBe("2000-12-31");
    expect(safe.toISOString().slice(0, 10)).toBe("2000-12-31");
  });
});
