/**
 * Tests unitarios — Schemas Zod Proceso F GS1: gs1-devoluciones.
 *
 * Cubre:
 *   1. motivoDevolucionSchema — valores válidos e inválidos
 *   2. estadoDevolucionSchema — valores válidos e inválidos
 *   3. productoDevolucionSchema — validación GTIN, lote, cantidad
 *   4. gs1DevolucionSolicitarSchema — happy path y errores de borde
 *   5. gs1DevolucionAutorizarSchema — uuid requerido
 *   6. gs1DevolucionRecepcionSchema — flag recibidoConforme
 *   7. gs1DevolucionListSchema — defaults y filtros opcionales
 */
import { describe, it, expect } from "vitest";
import {
  motivoDevolucionSchema,
  estadoDevolucionSchema,
  productoDevolucionSchema,
  gs1DevolucionSolicitarSchema,
  gs1DevolucionAutorizarSchema,
  gs1DevolucionRecepcionSchema,
  gs1DevolucionListSchema,
} from "../gs1-devoluciones";

const UUID = "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// 1. motivoDevolucionSchema
// ---------------------------------------------------------------------------
describe("motivoDevolucionSchema", () => {
  it.each(["vencido", "defectuoso", "recall", "exceso", "no_administrado"])(
    "acepta motivo válido: %s",
    (m) => expect(motivoDevolucionSchema.safeParse(m).success).toBe(true),
  );

  it("rechaza motivo desconocido", () =>
    expect(motivoDevolucionSchema.safeParse("perdido").success).toBe(false));

  it("rechaza cadena vacía", () =>
    expect(motivoDevolucionSchema.safeParse("").success).toBe(false));
});

// ---------------------------------------------------------------------------
// 2. estadoDevolucionSchema
// ---------------------------------------------------------------------------
describe("estadoDevolucionSchema", () => {
  it.each(["solicitado", "autorizado", "en_transito", "recibido", "rechazado"])(
    "acepta estado válido: %s",
    (s) => expect(estadoDevolucionSchema.safeParse(s).success).toBe(true),
  );

  it("rechaza estado desconocido", () =>
    expect(estadoDevolucionSchema.safeParse("cancelado").success).toBe(false));
});

// ---------------------------------------------------------------------------
// 3. productoDevolucionSchema
// ---------------------------------------------------------------------------
describe("productoDevolucionSchema", () => {
  const base = { gtin: "07501055932458", lote: "LOT-2024-001", cantidad: 10 };

  it("acepta producto válido", () =>
    expect(productoDevolucionSchema.safeParse(base).success).toBe(true));

  it("rechaza cantidad cero", () =>
    expect(
      productoDevolucionSchema.safeParse({ ...base, cantidad: 0 }).success,
    ).toBe(false));

  it("rechaza cantidad negativa", () =>
    expect(
      productoDevolucionSchema.safeParse({ ...base, cantidad: -1 }).success,
    ).toBe(false));

  it("rechaza GTIN con letras", () =>
    expect(
      productoDevolucionSchema.safeParse({ ...base, gtin: "GTIN-INVALID" }).success,
    ).toBe(false));

  it("rechaza GTIN vacío", () =>
    expect(
      productoDevolucionSchema.safeParse({ ...base, gtin: "" }).success,
    ).toBe(false));

  it("rechaza lote vacío", () =>
    expect(
      productoDevolucionSchema.safeParse({ ...base, lote: "" }).success,
    ).toBe(false));

  it("acepta GTIN de 8 dígitos (EAN-8)", () =>
    expect(
      productoDevolucionSchema.safeParse({ ...base, gtin: "01234567" }).success,
    ).toBe(true));
});

// ---------------------------------------------------------------------------
// 4. gs1DevolucionSolicitarSchema
// ---------------------------------------------------------------------------
describe("gs1DevolucionSolicitarSchema", () => {
  const base = {
    origenGln: "7501234567890",
    destinoGln: "7509876543210",
    motivo: "recall" as const,
    productos: [{ gtin: "07501055932458", lote: "LOT-A", cantidad: 5 }],
  };

  it("acepta solicitud mínima válida", () =>
    expect(gs1DevolucionSolicitarSchema.safeParse(base).success).toBe(true));

  it("acepta con fechaDevolucion y notas opcionales", () =>
    expect(
      gs1DevolucionSolicitarSchema.safeParse({
        ...base,
        fechaDevolucion: new Date("2026-01-15"),
        notas: "Lote comprometido por recall del fabricante",
      }).success,
    ).toBe(true));

  it("rechaza sin productos (array vacío)", () =>
    expect(
      gs1DevolucionSolicitarSchema.safeParse({ ...base, productos: [] }).success,
    ).toBe(false));

  it("rechaza origenGln con letras", () =>
    expect(
      gs1DevolucionSolicitarSchema.safeParse({ ...base, origenGln: "ABC123" }).success,
    ).toBe(false));

  it("rechaza destinoGln vacío", () =>
    expect(
      gs1DevolucionSolicitarSchema.safeParse({ ...base, destinoGln: "" }).success,
    ).toBe(false));

  it("rechaza motivo inválido", () =>
    expect(
      gs1DevolucionSolicitarSchema.safeParse({ ...base, motivo: "perdido" }).success,
    ).toBe(false));

  it("rechaza notas que superen 1000 caracteres", () =>
    expect(
      gs1DevolucionSolicitarSchema.safeParse({
        ...base,
        notas: "x".repeat(1001),
      }).success,
    ).toBe(false));
});

// ---------------------------------------------------------------------------
// 5. gs1DevolucionAutorizarSchema
// ---------------------------------------------------------------------------
describe("gs1DevolucionAutorizarSchema", () => {
  it("acepta con UUID válido", () =>
    expect(
      gs1DevolucionAutorizarSchema.safeParse({ devolucionId: UUID }).success,
    ).toBe(true));

  it("acepta con notas opcionales", () =>
    expect(
      gs1DevolucionAutorizarSchema.safeParse({
        devolucionId: UUID,
        notas: "Autorizado por jefe de logística",
      }).success,
    ).toBe(true));

  it("rechaza UUID malformado", () =>
    expect(
      gs1DevolucionAutorizarSchema.safeParse({ devolucionId: "no-uuid" }).success,
    ).toBe(false));

  it("rechaza sin devolucionId", () =>
    expect(gs1DevolucionAutorizarSchema.safeParse({}).success).toBe(false));
});

// ---------------------------------------------------------------------------
// 6. gs1DevolucionRecepcionSchema
// ---------------------------------------------------------------------------
describe("gs1DevolucionRecepcionSchema", () => {
  it("acepta recibidoConforme=true", () =>
    expect(
      gs1DevolucionRecepcionSchema.safeParse({
        devolucionId: UUID,
        recibidoConforme: true,
      }).success,
    ).toBe(true));

  it("acepta recibidoConforme=false (rechazo)", () =>
    expect(
      gs1DevolucionRecepcionSchema.safeParse({
        devolucionId: UUID,
        recibidoConforme: false,
        notas: "Empaque dañado",
      }).success,
    ).toBe(true));

  it("rechaza sin recibidoConforme", () =>
    expect(
      gs1DevolucionRecepcionSchema.safeParse({ devolucionId: UUID }).success,
    ).toBe(false));
});

// ---------------------------------------------------------------------------
// 7. gs1DevolucionListSchema
// ---------------------------------------------------------------------------
describe("gs1DevolucionListSchema", () => {
  it("aplica default limit=25", () => {
    const result = gs1DevolucionListSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.success && result.data.limit).toBe(25);
  });

  it("acepta filtro por estado", () =>
    expect(
      gs1DevolucionListSchema.safeParse({ estado: "solicitado" }).success,
    ).toBe(true));

  it("acepta filtro por motivo", () =>
    expect(
      gs1DevolucionListSchema.safeParse({ motivo: "recall" }).success,
    ).toBe(true));

  it("rechaza limit > 100", () =>
    expect(
      gs1DevolucionListSchema.safeParse({ limit: 101 }).success,
    ).toBe(false));

  it("rechaza limit < 1", () =>
    expect(
      gs1DevolucionListSchema.safeParse({ limit: 0 }).success,
    ).toBe(false));

  it("acepta cursor UUID válido", () =>
    expect(
      gs1DevolucionListSchema.safeParse({ cursor: UUID }).success,
    ).toBe(true));

  it("rechaza cursor UUID malformado", () =>
    expect(
      gs1DevolucionListSchema.safeParse({ cursor: "bad-cursor" }).success,
    ).toBe(false));
});
