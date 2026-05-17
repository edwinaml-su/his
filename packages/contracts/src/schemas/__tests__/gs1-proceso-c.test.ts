/**
 * Tests — GS1 Proceso C: schemas Zod + lógica de validación de unidosis.
 */
import { describe, it, expect } from "vitest";
import {
  prepararUnidosisInputSchema,
  verificarUnidosisInputSchema,
  listUnidosisInputSchema,
  unidosisRowSchema,
} from "../gs1-proceso-c";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_EXPIRY = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +24h

const validPreparar = {
  pacienteId: VALID_UUID,
  indicacionId: VALID_UUID,
  gtinOrigenId: VALID_UUID,
  loteOrigen: "LOT-2025-001",
  cantidadPreparada: 3,
  expiryUnidosis: VALID_EXPIRY,
  preparadoPor: VALID_UUID,
};

// ─── prepararUnidosisInputSchema ──────────────────────────────────────────────

describe("prepararUnidosisInputSchema", () => {
  it("acepta input válido completo", () => {
    expect(() => prepararUnidosisInputSchema.parse(validPreparar)).not.toThrow();
  });

  it("rechaza cantidadPreparada = 0", () => {
    const result = prepararUnidosisInputSchema.safeParse({
      ...validPreparar,
      cantidadPreparada: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza cantidadPreparada negativa", () => {
    const result = prepararUnidosisInputSchema.safeParse({
      ...validPreparar,
      cantidadPreparada: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza cantidadPreparada > 9999", () => {
    const result = prepararUnidosisInputSchema.safeParse({
      ...validPreparar,
      cantidadPreparada: 10000,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza loteOrigen vacío", () => {
    const result = prepararUnidosisInputSchema.safeParse({
      ...validPreparar,
      loteOrigen: "",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza pacienteId no-uuid", () => {
    const result = prepararUnidosisInputSchema.safeParse({
      ...validPreparar,
      pacienteId: "no-es-un-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza expiryUnidosis no datetime", () => {
    const result = prepararUnidosisInputSchema.safeParse({
      ...validPreparar,
      expiryUnidosis: "2025-13-01", // mes inválido
    });
    expect(result.success).toBe(false);
  });

  it("acepta fechaPreparacion opcional", () => {
    const withFecha = {
      ...validPreparar,
      fechaPreparacion: new Date().toISOString(),
    };
    expect(() => prepararUnidosisInputSchema.parse(withFecha)).not.toThrow();
  });
});

// ─── verificarUnidosisInputSchema ─────────────────────────────────────────────

describe("verificarUnidosisInputSchema", () => {
  it("acepta código válido", () => {
    expect(() =>
      verificarUnidosisInputSchema.parse({ codigoUnidosis: "UD-42" }),
    ).not.toThrow();
  });

  it("rechaza código vacío", () => {
    const result = verificarUnidosisInputSchema.safeParse({ codigoUnidosis: "" });
    expect(result.success).toBe(false);
  });

  it("rechaza código demasiado largo (>50)", () => {
    const result = verificarUnidosisInputSchema.safeParse({
      codigoUnidosis: "UD-" + "x".repeat(50),
    });
    expect(result.success).toBe(false);
  });
});

// ─── listUnidosisInputSchema ──────────────────────────────────────────────────

describe("listUnidosisInputSchema", () => {
  it("acepta input vacío (todos los campos opcionales)", () => {
    expect(() => listUnidosisInputSchema.parse({})).not.toThrow();
  });

  it("aplica default limit=20", () => {
    const result = listUnidosisInputSchema.parse({});
    expect(result.limit).toBe(20);
  });

  it("acepta limit personalizado dentro de rango", () => {
    const result = listUnidosisInputSchema.parse({ limit: 50 });
    expect(result.limit).toBe(50);
  });

  it("rechaza limit=0", () => {
    expect(listUnidosisInputSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it("rechaza limit > 100", () => {
    expect(listUnidosisInputSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("acepta pacienteId y cursor UUID válidos", () => {
    expect(() =>
      listUnidosisInputSchema.parse({
        pacienteId: VALID_UUID,
        cursor: VALID_UUID,
      }),
    ).not.toThrow();
  });
});

// ─── unidosisRowSchema ────────────────────────────────────────────────────────

describe("unidosisRowSchema", () => {
  const validRow = {
    id: VALID_UUID,
    codigoUnidosis: "UD-7",
    etiquetaQrGenerada: '{"ud":"UD-7"}',
    pacienteId: VALID_UUID,
    indicacionId: VALID_UUID,
    gtinOrigenId: VALID_UUID,
    loteOrigen: "LOT-X",
    cantidadPreparada: 2,
    fechaPreparacion: new Date().toISOString(),
    expiryUnidosis: VALID_EXPIRY,
    preparadoPor: VALID_UUID,
    creadoEn: new Date().toISOString(),
  };

  it("acepta fila completa válida", () => {
    expect(() => unidosisRowSchema.parse(validRow)).not.toThrow();
  });

  it("coerce string ISO a Date en fechaPreparacion", () => {
    const parsed = unidosisRowSchema.parse(validRow);
    expect(parsed.fechaPreparacion).toBeInstanceOf(Date);
  });

  it("acepta etiquetaQrGenerada null", () => {
    expect(() =>
      unidosisRowSchema.parse({ ...validRow, etiquetaQrGenerada: null }),
    ).not.toThrow();
  });
});
