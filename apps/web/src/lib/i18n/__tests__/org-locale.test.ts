/**
 * org-locale.test.ts — R2.2. `formatDate`/`formatDateTime` deben producir
 * EXACTAMENTE el mismo output que los hardcodes que reemplazan
 * (`toLocaleDateString("es-SV")` / `Intl.DateTimeFormat("es-SV", {...})`)
 * cuando se llaman sin overrides — regla de oro: cero cambio para SV.
 */
import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime } from "../org-locale";

describe("formatDate", () => {
  it("es idéntico al hardcode que reemplaza (toLocaleDateString es-SV)", () => {
    const d = new Date("2026-03-15T12:00:00Z");
    expect(formatDate(d)).toBe(
      d.toLocaleDateString("es-SV", { timeZone: "America/El_Salvador" }),
    );
  });

  it("acepta string/number además de Date", () => {
    expect(formatDate("2026-03-15T12:00:00Z")).toBe(formatDate(new Date("2026-03-15T12:00:00Z")));
  });

  it("devuelve '' con una fecha inválida (tolerante, no lanza)", () => {
    expect(formatDate("no-es-una-fecha")).toBe("");
  });

  it("respeta options/locale explícitos (para tranches futuras con TZ de org)", () => {
    const d = new Date("2026-03-15T12:00:00Z");
    const result = formatDate(d, { day: "2-digit", month: "2-digit", year: "numeric" }, "es-GT");
    expect(result).toBe(
      d.toLocaleDateString("es-GT", {
        timeZone: "America/El_Salvador",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
    );
  });
});

describe("formatDateTime", () => {
  it("es idéntico al hardcode que reemplaza (toLocaleString es-SV dateStyle/timeStyle short)", () => {
    const d = new Date("2026-03-15T12:34:00Z");
    const options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };
    expect(formatDateTime(d, options)).toBe(
      new Intl.DateTimeFormat("es-SV", { timeZone: "America/El_Salvador", ...options }).format(d),
    );
  });

  it("devuelve '' con una fecha inválida (tolerante, no lanza)", () => {
    expect(formatDateTime("no-es-una-fecha")).toBe("");
  });
});
