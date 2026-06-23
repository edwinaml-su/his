/**
 * Tests Zod — ECE Signos Vitales (CC-0001 RF-04).
 *
 * Cubre: pacienteId opcional (la toma se ancla al episodio), rangos plausibles,
 * observaciones, y el schema de actualización (solo campos clínicos).
 */
import { describe, it, expect } from "vitest";
import {
  eceSignosVitalesCreateSchema,
  eceSignosVitalesUpdateSchema,
} from "../ece-signos-vitales";

const EPISODIO_ID = "00000000-0000-0000-0000-000000000001";

describe("eceSignosVitalesCreateSchema", () => {
  it("acepta una toma anclada solo al episodio (sin pacienteId) — RF-04", () => {
    const r = eceSignosVitalesCreateSchema.safeParse({
      episodioId: EPISODIO_ID,
      presionSistolica: 120,
      presionDiastolica: 80,
    });
    expect(r.success).toBe(true);
  });

  it("acepta toma totalmente vacía (todos los campos opcionales)", () => {
    expect(eceSignosVitalesCreateSchema.safeParse({}).success).toBe(true);
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
  ])("%s = %s → %s", (campo, valor, esperado) => {
    expect(eceSignosVitalesCreateSchema.safeParse({ [campo]: valor }).success).toBe(esperado);
  });

  it("rechaza episodioId no-uuid", () => {
    expect(eceSignosVitalesCreateSchema.safeParse({ episodioId: "no-uuid" }).success).toBe(false);
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
