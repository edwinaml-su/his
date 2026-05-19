import { describe, it, expect } from "vitest";
import {
  gs1ProductoRecibidoSchema,
  verificacion5CorrectosSchema,
  recibirMercanciaInput,
  rechazarRecepcionInput,
  verificar5CorrectosInput,
  listarRecepcionesInput,
} from "../gs1-inbound";

// ---------------------------------------------------------------------------
// gs1ProductoRecibidoSchema
// ---------------------------------------------------------------------------
describe("gs1ProductoRecibidoSchema", () => {
  const validProducto = {
    gtin: "07501000001231",
    cantidad: 10,
    lote: "L2026A",
    expiry: "2027-12-31",
  };

  it("acepta producto válido", () => {
    expect(gs1ProductoRecibidoSchema.safeParse(validProducto).success).toBe(true);
  });

  it("rechaza GTIN de menos de 14 dígitos", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({ ...validProducto, gtin: "1234567" });
    expect(r.success).toBe(false);
  });

  it("rechaza GTIN con caracteres no numéricos", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({ ...validProducto, gtin: "0750100000123X" });
    expect(r.success).toBe(false);
  });

  it("rechaza cantidad cero", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({ ...validProducto, cantidad: 0 });
    expect(r.success).toBe(false);
  });

  it("rechaza producto ya vencido", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({ ...validProducto, expiry: "2020-01-01" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toMatch(/vencido/i);
    }
  });

  it("rechaza formato de fecha incorrecto", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({ ...validProducto, expiry: "31-12-2027" });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verificacion5CorrectosSchema
// ---------------------------------------------------------------------------
describe("verificacion5CorrectosSchema", () => {
  it("acepta verificación válida de muelle", () => {
    const data = {
      paciente_n_a: true as const,
      medicamento_verif: true,
      dosis_n_a: true as const,
      via_n_a: true as const,
      hora_n_a: true as const,
    };
    expect(verificacion5CorrectosSchema.safeParse(data).success).toBe(true);
  });

  it("acepta medicamento_verif false (pendiente de confirmar)", () => {
    const data = {
      paciente_n_a: true as const,
      medicamento_verif: false,
      dosis_n_a: true as const,
      via_n_a: true as const,
      hora_n_a: true as const,
    };
    expect(verificacion5CorrectosSchema.safeParse(data).success).toBe(true);
  });

  it("rechaza paciente_n_a false (es literal true)", () => {
    const data = {
      paciente_n_a: false,
      medicamento_verif: true,
      dosis_n_a: true,
      via_n_a: true,
      hora_n_a: true,
    };
    expect(verificacion5CorrectosSchema.safeParse(data).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recibirMercanciaInput
// ---------------------------------------------------------------------------
describe("recibirMercanciaInput", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const valid = {
    numero_documento_recepcion: "REC-2026-001",
    proveedor_gln: "7413000000001",
    productos: [
      { gtin: "07501000001231", cantidad: 5, lote: "L001", expiry: "2027-06-30" },
    ],
    verificacion_5correctos: {
      paciente_n_a: true as const,
      medicamento_verif: false,
      dosis_n_a: true as const,
      via_n_a: true as const,
      hora_n_a: true as const,
    },
    establecimiento_id: uuid,
    registrado_por: uuid,
  };

  it("acepta input completo válido", () => {
    expect(recibirMercanciaInput.safeParse(valid).success).toBe(true);
  });

  it("acepta con sscc_pallet opcional ausente", () => {
    const r = recibirMercanciaInput.safeParse({ ...valid, sscc_pallet: undefined });
    expect(r.success).toBe(true);
  });

  it("rechaza GLN de proveedor con 12 dígitos", () => {
    const r = recibirMercanciaInput.safeParse({ ...valid, proveedor_gln: "741300000000" });
    expect(r.success).toBe(false);
  });

  it("rechaza lista de productos vacía", () => {
    const r = recibirMercanciaInput.safeParse({ ...valid, productos: [] });
    expect(r.success).toBe(false);
  });

  it("rechaza establecimiento_id con formato inválido", () => {
    const r = recibirMercanciaInput.safeParse({ ...valid, establecimiento_id: "not-a-uuid" });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rechazarRecepcionInput
// ---------------------------------------------------------------------------
describe("rechazarRecepcionInput", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";

  it("acepta input válido", () => {
    const r = rechazarRecepcionInput.safeParse({
      recepcionId: uuid,
      motivo_rechazo: "Producto dañado en tránsito",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza motivo menor a 5 chars", () => {
    const r = rechazarRecepcionInput.safeParse({ recepcionId: uuid, motivo_rechazo: "No" });
    expect(r.success).toBe(false);
  });

  it("rechaza recepcionId inválido", () => {
    const r = rechazarRecepcionInput.safeParse({
      recepcionId: "not-uuid",
      motivo_rechazo: "Producto vencido al recibir",
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verificar5CorrectosInput
// ---------------------------------------------------------------------------
describe("verificar5CorrectosInput", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";

  it("acepta input válido", () => {
    const r = verificar5CorrectosInput.safeParse({
      recepcionId: uuid,
      verificacion_5correctos: {
        paciente_n_a: true,
        medicamento_verif: true,
        dosis_n_a: true,
        via_n_a: true,
        hora_n_a: true,
      },
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listarRecepcionesInput
// ---------------------------------------------------------------------------
describe("listarRecepcionesInput", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";

  it("acepta sin estado (todos)", () => {
    const r = listarRecepcionesInput.safeParse({ establecimiento_id: uuid });
    expect(r.success).toBe(true);
  });

  it("acepta estado pendiente", () => {
    const r = listarRecepcionesInput.safeParse({
      establecimiento_id: uuid,
      estado: "pendiente",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza estado fuera del enum", () => {
    const r = listarRecepcionesInput.safeParse({
      establecimiento_id: uuid,
      estado: "en_proceso",
    });
    expect(r.success).toBe(false);
  });

  it("aplica defaults de paginación", () => {
    const r = listarRecepcionesInput.safeParse({ establecimiento_id: uuid });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(50);
      expect(r.data.offset).toBe(0);
    }
  });
});
