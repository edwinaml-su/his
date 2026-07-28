/**
 * Tests Zod — ECE Signos Vitales (CC-0001 RF-04 + CC-0012 módulo transversal).
 *
 * Cubre: pacienteId opcional (la toma se ancla al episodio y/o a la cuenta),
 * rangos plausibles (mockup avante7), observaciones, ancla obligatoria
 * (episodioId o cuentaId), campos CC-0012 (G·P·P·A·V, pesoLb, tallaFt,
 * fppActivo), y el schema de actualización (solo campos clínicos).
 */
import { describe, it, expect } from "vitest";
import {
  eceSignosVitalesCreateSchema,
  eceSignosVitalesUpdateSchema,
} from "../ece-signos-vitales";

const EPISODIO_ID = "00000000-0000-0000-0000-000000000001";
const CUENTA_ID = "00000000-0000-0000-0000-000000000002";

describe("eceSignosVitalesCreateSchema", () => {
  it("acepta una toma anclada solo al episodio (sin pacienteId) — RF-04", () => {
    const r = eceSignosVitalesCreateSchema.safeParse({
      episodioId: EPISODIO_ID,
      presionSistolica: 120,
      presionDiastolica: 80,
    });
    expect(r.success).toBe(true);
  });

  it("acepta una toma anclada solo a la cuenta (sin episodioId) — CC-0012", () => {
    const r = eceSignosVitalesCreateSchema.safeParse({
      cuentaId: CUENTA_ID,
      presionSistolica: 120,
    });
    expect(r.success).toBe(true);
  });

  it("rechaza toma totalmente vacía — CC-0012 exige al menos un ancla", () => {
    const r = eceSignosVitalesCreateSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.episodioId).toBeDefined();
    }
  });

  it("persiste observaciones (RF-04)", () => {
    const r = eceSignosVitalesCreateSchema.safeParse({
      episodioId: EPISODIO_ID,
      observaciones: "Paciente refiere mareo leve.",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza observaciones > 2000 caracteres", () => {
    expect(
      eceSignosVitalesCreateSchema.safeParse({ observaciones: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it.each([
    ["saturacionO2", 50, true],
    ["saturacionO2", 100, true],
    ["saturacionO2", 49, false],
    ["saturacionO2", 101, false],
    ["presionSistolica", 60, true],
    ["presionSistolica", 261, false],
    ["temperatura", 30, true],
    ["temperatura", 43.1, false],
    ["escalaDolor", 0, true],
    ["escalaDolor", 11, false],
    // CC-0012 — rangos ampliados al mockup avante7
    ["glucometriaMgdl", 10, true],
    ["glucometriaMgdl", 900, true],
    ["glucometriaMgdl", 9, false],
    ["glucometriaMgdl", 901, false],
    ["pesoKg", 0.5, true],
    ["pesoKg", 400, true],
    ["pesoKg", 400.1, false],
    ["pesoLb", 1, true],
    ["pesoLb", 880, true],
    ["pesoLb", 880.1, false],
    ["tallaFt", 1, true],
    ["tallaFt", 8.2, true],
    ["tallaFt", 8.3, false],
    ["fio2", 21, true],
    ["fio2", 100, true],
    ["fio2", 20, false],
    ["perimetroCintura", 30, true],
    ["perimetroCintura", 250, true],
    ["balanceHidrico", -20000, true],
    ["balanceHidrico", 20000, true],
    ["balanceHidrico", -20001, false],
    ["diuresis", 0, true],
    ["diuresis", 2000, true],
    ["diuresis", 2001, false],
    ["goGestas", 0, true],
    ["goGestas", 30, true],
    ["goGestas", 31, false],
  ])("%s = %s → %s", (campo, valor, esperado) => {
    expect(
      eceSignosVitalesCreateSchema.safeParse({ episodioId: EPISODIO_ID, [campo]: valor }).success,
    ).toBe(esperado);
  });

  it("rechaza episodioId no-uuid", () => {
    expect(
      eceSignosVitalesCreateSchema.safeParse({ episodioId: "no-uuid", cuentaId: CUENTA_ID })
        .success,
    ).toBe(false);
  });

  it("acepta fórmula obstétrica G·P·P·A·V + fppActivo (CC-0012)", () => {
    const r = eceSignosVitalesCreateSchema.safeParse({
      episodioId: EPISODIO_ID,
      goGestas: 2,
      goPartosTermino: 1,
      goPartosPretermino: 0,
      goAbortos: 1,
      goVivos: 1,
      fppActivo: true,
      fur: "2026-01-01",
    });
    expect(r.success).toBe(true);
  });
});

describe("eceSignosVitalesUpdateSchema", () => {
  it("acepta actualización parcial de un solo campo clínico", () => {
    expect(eceSignosVitalesUpdateSchema.safeParse({ temperatura: 37.2 }).success).toBe(true);
  });

  it("acepta objeto vacío (partial)", () => {
    expect(eceSignosVitalesUpdateSchema.safeParse({}).success).toBe(true);
  });
});
