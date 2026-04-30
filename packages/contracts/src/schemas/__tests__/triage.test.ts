/**
 * Tests del schema de Triage Manchester.
 *
 * Nota: el dominio "tiempos máximos coherentes" (rojo=0, naranja=10,
 * amarillo=60, verde=120, azul=240 min) está modelado en el catálogo
 * `TriageLevel` (BD), no en el Zod schema. Los tests de tiempos viven
 * en `packages/trpc/.../triage.router.test.ts` con datos seed.
 */
import { describe, it, expect } from "vitest";
import {
  triageEvaluationCreateSchema,
  vitalSignSchema,
  triageColorEnum,
} from "../triage";

const u = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

describe("triageColorEnum", () => {
  it.each(["RED", "ORANGE", "YELLOW", "GREEN", "BLUE"])("acepta nivel %s", (c) => {
    expect(triageColorEnum.safeParse(c).success).toBe(true);
  });

  it("rechaza color desconocido", () => {
    expect(triageColorEnum.safeParse("PURPLE").success).toBe(false);
  });
});

describe("vitalSignSchema", () => {
  it("acepta signo numérico (HR=80)", () => {
    expect(
      vitalSignSchema.safeParse({ vitalCode: "HR", valueNumeric: 80, unit: "bpm" }).success,
    ).toBe(true);
  });

  it("acepta signo textual (PAIN='moderado')", () => {
    expect(
      vitalSignSchema.safeParse({ vitalCode: "PAIN", valueText: "moderado" }).success,
    ).toBe(true);
  });

  it("rechaza vitalCode vacío", () => {
    expect(vitalSignSchema.safeParse({ vitalCode: "" }).success).toBe(false);
  });
});

describe("triageEvaluationCreateSchema", () => {
  const base = {
    patientId: u(1),
    flowchartId: u(2),
    assignedLevelId: u(3),
  };

  it("acepta evaluación mínima sin signos ni discriminadores", () => {
    const r = triageEvaluationCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.vitalSigns).toEqual([]);
      expect(r.data.discriminatorHits).toEqual([]);
    }
  });

  it("acepta evaluación con signos y discriminadores", () => {
    const r = triageEvaluationCreateSchema.safeParse({
      ...base,
      vitalSigns: [{ vitalCode: "BP_SYS", valueNumeric: 90 }],
      discriminatorHits: [{ discriminatorId: u(4), positive: true }],
    });
    expect(r.success).toBe(true);
  });

  it("acepta override con justificación", () => {
    const r = triageEvaluationCreateSchema.safeParse({
      ...base,
      systemSuggestedLevelId: u(5),
      assignedLevelId: u(3),
      overrideJustification: "Triagista observa signos compensatorios.",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza override con justificación > 2000 chars", () => {
    const r = triageEvaluationCreateSchema.safeParse({
      ...base,
      overrideJustification: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it("rechaza UUIDs malformados", () => {
    expect(
      triageEvaluationCreateSchema.safeParse({ ...base, flowchartId: "x" }).success,
    ).toBe(false);
  });
});
