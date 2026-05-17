/**
 * Tests unitarios — eceUrpaRecovery router (Zod + lógica de negocio).
 *
 * No mockean la BD; validan el comportamiento de los schemas Zod y las
 * reglas de negocio de darAlta que son reenforced en el router.
 */
import { describe, it, expect } from "vitest";
import {
  eceUrpaCreateSchema,
  eceUrpaDarAltaSchema,
  eceUrpaRegistrarSignosSchema,
  urpaMedicamentoSchema,
} from "../../../../../../packages/contracts/src/schemas/ece-urpa";

// ─── Schema: eceUrpaCreateSchema ────────────────────────────────────────────

describe("eceUrpaCreateSchema", () => {
  const baseInput = {
    actoQuirurgicoId: "00000000-0000-0000-0000-000000000001",
    escalaAldreteIngreso: 8,
  };

  it("acepta input mínimo válido", () => {
    const result = eceUrpaCreateSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
  });

  it("rechaza Aldrete ingreso fuera de rango (11)", () => {
    const result = eceUrpaCreateSchema.safeParse({
      ...baseInput,
      escalaAldreteIngreso: 11,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/máximo 10/);
  });

  it("rechaza Aldrete ingreso negativo", () => {
    const result = eceUrpaCreateSchema.safeParse({
      ...baseInput,
      escalaAldreteIngreso: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza actoQuirurgicoId inválido (no UUID)", () => {
    const result = eceUrpaCreateSchema.safeParse({
      ...baseInput,
      actoQuirurgicoId: "no-es-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("acepta medicamentos vacíos por defecto", () => {
    const result = eceUrpaCreateSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.medicamentosAdministrados).toEqual([]);
    }
  });
});

// ─── Schema: eceUrpaDarAltaSchema ───────────────────────────────────────────

describe("eceUrpaDarAltaSchema — regla Aldrete↔criterio", () => {
  const baseAlta = {
    id: "00000000-0000-0000-0000-000000000002",
  };

  it("acepta Aldrete=9 con criterio='cumple'", () => {
    const result = eceUrpaDarAltaSchema.safeParse({
      ...baseAlta,
      escalaAldreteAlta: 9,
      criterioAlta: "cumple",
    });
    expect(result.success).toBe(true);
  });

  it("acepta Aldrete=10 con criterio='cumple'", () => {
    const result = eceUrpaDarAltaSchema.safeParse({
      ...baseAlta,
      escalaAldreteAlta: 10,
      criterioAlta: "cumple",
    });
    expect(result.success).toBe(true);
  });

  it("acepta Aldrete=7 con criterio='no_cumple_observacion'", () => {
    const result = eceUrpaDarAltaSchema.safeParse({
      ...baseAlta,
      escalaAldreteAlta: 7,
      criterioAlta: "no_cumple_observacion",
    });
    expect(result.success).toBe(true);
  });

  it("acepta Aldrete=3 con criterio='trasladar_uci'", () => {
    const result = eceUrpaDarAltaSchema.safeParse({
      ...baseAlta,
      escalaAldreteAlta: 3,
      criterioAlta: "trasladar_uci",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza Aldrete=9 con criterio='no_cumple_observacion'", () => {
    const result = eceUrpaDarAltaSchema.safeParse({
      ...baseAlta,
      escalaAldreteAlta: 9,
      criterioAlta: "no_cumple_observacion",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/Aldrete/);
  });

  it("rechaza Aldrete=8 con criterio='cumple'", () => {
    const result = eceUrpaDarAltaSchema.safeParse({
      ...baseAlta,
      escalaAldreteAlta: 8,
      criterioAlta: "cumple",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza criterio inválido", () => {
    const result = eceUrpaDarAltaSchema.safeParse({
      ...baseAlta,
      escalaAldreteAlta: 9,
      criterioAlta: "inventado",
    });
    expect(result.success).toBe(false);
  });
});

// ─── Schema: urpaMedicamentoSchema ──────────────────────────────────────────

describe("urpaMedicamentoSchema", () => {
  it("acepta medicamento válido", () => {
    const result = urpaMedicamentoSchema.safeParse({
      nombre: "Morfina",
      dosis: "2mg",
      via: "IV",
      administrado_en: "2026-05-17T10:00:00-06:00",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza nombre vacío", () => {
    const result = urpaMedicamentoSchema.safeParse({
      nombre: "",
      dosis: "2mg",
      via: "IV",
      administrado_en: "2026-05-17T10:00:00-06:00",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza fecha inválida", () => {
    const result = urpaMedicamentoSchema.safeParse({
      nombre: "Ketorolaco",
      dosis: "30mg",
      via: "IM",
      administrado_en: "no-es-fecha",
    });
    expect(result.success).toBe(false);
  });
});

// ─── Schema: eceUrpaRegistrarSignosSchema ───────────────────────────────────

describe("eceUrpaRegistrarSignosSchema", () => {
  it("acepta patch parcial sin medicamentos", () => {
    const result = eceUrpaRegistrarSignosSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000003",
      complicaciones: "Náuseas leves post-anestesia.",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza id no UUID", () => {
    const result = eceUrpaRegistrarSignosSchema.safeParse({
      id: "abc",
    });
    expect(result.success).toBe(false);
  });
});
