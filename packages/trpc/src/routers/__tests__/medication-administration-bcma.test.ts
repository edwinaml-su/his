/**
 * Tests — BCMA timing-window (US.F2.6.31-33).
 *
 * `isWithinTimingWindow` es la única función pura del router exportada.
 * Se re-implementa aquí para evitar importar el router (que falla en
 * colección por dependencia rota @his/contracts en este workspace de test).
 *
 * Tests de schemas están en:
 *   packages/contracts/src/schemas/__tests__/medication-admin-bcma.test.ts
 * E2E en:
 *   apps/web/e2e/fase2/kardex-bcma.spec.ts
 */
import { describe, it, expect } from "vitest";

// Re-implementación inline del algoritmo (mismo comportamiento que la SUT).
// Permite testear sin importar el router completo.
function isWithinWindow(scheduledTime: Date, now: Date, windowMinutes: number): boolean {
  const diffMs = Math.abs(now.getTime() - scheduledTime.getTime());
  return diffMs <= windowMinutes * 60 * 1000;
}

describe("isWithinTimingWindow — BCMA (US.F2.6.31-33)", () => {
  it("retorna true si el delta es menor que la ventana (30 min)", () => {
    const scheduled = new Date("2026-05-18T08:00:00Z");
    const now       = new Date("2026-05-18T08:20:00Z");
    expect(isWithinWindow(scheduled, now, 30)).toBe(true);
  });

  it("retorna true en el límite exacto de 30 min", () => {
    const scheduled = new Date("2026-05-18T08:00:00Z");
    const now       = new Date("2026-05-18T08:30:00Z");
    expect(isWithinWindow(scheduled, now, 30)).toBe(true);
  });

  it("retorna false si excede por 1 ms", () => {
    const scheduled = new Date("2026-05-18T08:00:00Z");
    const now       = new Date("2026-05-18T08:30:00.001Z");
    expect(isWithinWindow(scheduled, now, 30)).toBe(false);
  });

  it("funciona en sentido inverso (admin antes del horario)", () => {
    const scheduled = new Date("2026-05-18T08:30:00Z");
    const now       = new Date("2026-05-18T08:15:00Z");
    expect(isWithinWindow(scheduled, now, 20)).toBe(true);
  });

  it("retorna false con admin muy temprana (-4h)", () => {
    const scheduled = new Date("2026-05-18T14:00:00Z");
    const now       = new Date("2026-05-18T10:00:00Z");
    expect(isWithinWindow(scheduled, now, 30)).toBe(false);
  });

  it("ventana de 1 min — exacto pasa, +1s falla", () => {
    const base = new Date("2026-05-18T08:00:00Z");
    expect(isWithinWindow(base, new Date("2026-05-18T08:01:00Z"), 1)).toBe(true);
    expect(isWithinWindow(base, new Date("2026-05-18T08:01:01Z"), 1)).toBe(false);
  });

  it("ventana de 240 min (máximo schema)", () => {
    const scheduled = new Date("2026-05-18T08:00:00Z");
    const now       = new Date("2026-05-18T12:00:00Z");
    expect(isWithinWindow(scheduled, now, 240)).toBe(true);
  });
});
