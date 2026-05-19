/**
 * Tests de `computeScheduledSlot` — el slot programado nominal usado por la
 * 5ª R (Right Time) de BCMA. Cubre las frecuencias canónicas más STAT/PRN
 * y casos límite (now antes de signedAt, frecuencia desconocida).
 */
import { describe, it, expect } from "vitest";
import { computeScheduledSlot } from "../medication-slot";

const SIGNED_AT = new Date("2026-05-19T08:00:00Z");

describe("computeScheduledSlot", () => {
  it("STAT → retorna signedAt (dosis única)", () => {
    const now = new Date("2026-05-19T09:30:00Z");
    expect(computeScheduledSlot(SIGNED_AT, "STAT", now)).toEqual(SIGNED_AT);
  });

  it("PRN → retorna el momento actual (sin grilla)", () => {
    const now = new Date("2026-05-19T15:42:00Z");
    expect(computeScheduledSlot(SIGNED_AT, "PRN", now)).toEqual(now);
  });

  it("QD (cada 24h) → el slot del siguiente día", () => {
    const now = new Date("2026-05-20T07:55:00Z"); // ~24h después
    const slot = computeScheduledSlot(SIGNED_AT, "QD", now);
    expect(slot.toISOString()).toBe("2026-05-20T08:00:00.000Z");
  });

  it("BID (cada 12h) → slot del próximo turno cuando son las 19:30 (más cerca de 20:00 que de 08:00)", () => {
    const now = new Date("2026-05-19T19:30:00Z");
    const slot = computeScheduledSlot(SIGNED_AT, "BID", now);
    expect(slot.toISOString()).toBe("2026-05-19T20:00:00.000Z");
  });

  it("TID (cada 8h) → slot a las 16:00 cuando son ~16:00", () => {
    const now = new Date("2026-05-19T16:00:00Z");
    const slot = computeScheduledSlot(SIGNED_AT, "TID", now);
    expect(slot.toISOString()).toBe("2026-05-19T16:00:00.000Z");
  });

  it("QID (cada 6h) → slot a las 14:00 cuando son las 14:10", () => {
    const now = new Date("2026-05-19T14:10:00Z");
    const slot = computeScheduledSlot(SIGNED_AT, "QID", now);
    expect(slot.toISOString()).toBe("2026-05-19T14:00:00.000Z");
  });

  it("Q4H → slot a las 12:00 cuando son las 11:55 (redondeo al más cercano)", () => {
    const now = new Date("2026-05-19T11:55:00Z");
    const slot = computeScheduledSlot(SIGNED_AT, "Q4H", now);
    expect(slot.toISOString()).toBe("2026-05-19T12:00:00.000Z");
  });

  it("Q4H — slot exactamente a las 16:00 a los 8h después", () => {
    const now = new Date("2026-05-19T16:00:00Z");
    const slot = computeScheduledSlot(SIGNED_AT, "Q4H", now);
    expect(slot.toISOString()).toBe("2026-05-19T16:00:00.000Z");
  });

  it("Q12H → slot a las 20:00 cuando son las 19:00", () => {
    const now = new Date("2026-05-19T19:00:00Z");
    const slot = computeScheduledSlot(SIGNED_AT, "Q12H", now);
    expect(slot.toISOString()).toBe("2026-05-19T20:00:00.000Z");
  });

  it("frase 'cada 6 horas' → trata como Q6H", () => {
    const now = new Date("2026-05-19T14:00:00Z");
    const slot = computeScheduledSlot(SIGNED_AT, "cada 6 horas", now);
    expect(slot.toISOString()).toBe("2026-05-19T14:00:00.000Z");
  });

  it("frecuencia desconocida → fallback a signedAt", () => {
    const now = new Date("2026-05-19T10:00:00Z");
    expect(computeScheduledSlot(SIGNED_AT, "WHENEVER", now)).toEqual(SIGNED_AT);
  });

  it("now anterior a signedAt → retorna signedAt (no calcula slots negativos)", () => {
    const now = new Date("2026-05-19T07:00:00Z"); // 1h antes del signedAt
    expect(computeScheduledSlot(SIGNED_AT, "Q4H", now)).toEqual(SIGNED_AT);
  });

  it("regresión: anti-`new Date()` — el slot DIFIERE de now (lo que rompía la 5R Right Time)", () => {
    // Si la 5R Right Time se evalúa como |administeredAt - scheduledTime| con
    // window por defecto de 30 min, el patrón viejo `scheduledTime = new
    // Date()` siempre daba diff ≈ 0 → guard inocuo. computeScheduledSlot
    // produce un valor distinto al `now`, salvo coincidencias exactas con
    // la grilla.
    const now = new Date("2026-05-19T12:17:00Z"); // 17 min off del slot Q4H
    const slot = computeScheduledSlot(SIGNED_AT, "Q4H", now);
    expect(slot.toISOString()).toBe("2026-05-19T12:00:00.000Z");
    expect(slot.getTime()).not.toBe(now.getTime());
    // Diff ≈ 17 min — dentro del default window de 30 min, así que el guard
    // pasa, pero por la razón correcta (administración a tiempo) en lugar
    // de por el bug.
    expect(Math.abs(slot.getTime() - now.getTime())).toBe(17 * 60 * 1000);
  });
});
