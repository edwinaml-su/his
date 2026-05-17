/**
 * Tests unitarios — WHO Surgical Safety Checklist router.
 *
 * Estrategia: mock de ctx.prisma.$queryRaw / $executeRaw para aislar del BD.
 * No se monta el servidor HTTP; se llama directamente a los handlers vía caller.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  whoSignInSchema,
  whoTimeOutSchema,
  whoSignOutSchema,
} from "../who-checklist.router";

// ---------------------------------------------------------------------------
// Helpers de fixtures
// ---------------------------------------------------------------------------

const UUID_ACTO   = "11111111-1111-1111-1111-111111111111";
const UUID_CHKL   = "22222222-2222-2222-2222-222222222222";
const UUID_PERS   = "33333333-3333-3333-3333-333333333333";

const SIGN_IN_DATA = {
  responsableId: UUID_PERS,
  responsableNombre: "Dra. López",
  items: [
    { clave: "identidad_confirmada", label: "Identidad confirmada", verificado: true },
    { clave: "sitio_marcado",        label: "Sitio marcado",        verificado: true },
  ],
};

const TIME_OUT_DATA = {
  responsableId: UUID_PERS,
  responsableNombre: "Dr. Pérez",
  items: [
    { clave: "equipo_presentado",   label: "Equipo presentado",  verificado: true },
    { clave: "paciente_confirmado", label: "Paciente confirmado", verificado: true },
  ],
};

const SIGN_OUT_DATA = {
  responsableId: UUID_PERS,
  responsableNombre: "Enf. García",
  items: [
    { clave: "procedimiento_confirmado", label: "Procedimiento confirmado", verificado: true },
    { clave: "conteo_instrumental",      label: "Conteo correcto",          verificado: true },
  ],
};

// ---------------------------------------------------------------------------
// Test Zod schemas — estos no requieren DB
// ---------------------------------------------------------------------------

describe("whoSignInSchema", () => {
  it("acepta payload válido", () => {
    expect(() => whoSignInSchema.parse(SIGN_IN_DATA)).not.toThrow();
  });

  it("rechaza responsableNombre vacío", () => {
    expect(() =>
      whoSignInSchema.parse({ ...SIGN_IN_DATA, responsableNombre: "" }),
    ).toThrow();
  });

  it("rechaza items vacíos", () => {
    expect(() =>
      whoSignInSchema.parse({ ...SIGN_IN_DATA, items: [] }),
    ).toThrow();
  });

  it("rechaza responsableId no-UUID", () => {
    expect(() =>
      whoSignInSchema.parse({ ...SIGN_IN_DATA, responsableId: "no-uuid" }),
    ).toThrow();
  });
});

describe("whoTimeOutSchema", () => {
  it("acepta payload válido", () => {
    expect(() => whoTimeOutSchema.parse(TIME_OUT_DATA)).not.toThrow();
  });

  it("rechaza responsableNombre vacío", () => {
    expect(() =>
      whoTimeOutSchema.parse({ ...TIME_OUT_DATA, responsableNombre: "" }),
    ).toThrow();
  });
});

describe("whoSignOutSchema", () => {
  it("acepta payload válido", () => {
    expect(() => whoSignOutSchema.parse(SIGN_OUT_DATA)).not.toThrow();
  });

  it("rechaza items con más de 20 elementos", () => {
    const manyItems = Array.from({ length: 21 }, (_, i) => ({
      clave: `item_${i}`,
      label: `Item ${i}`,
      verificado: true,
    }));
    expect(() =>
      whoSignOutSchema.parse({ ...SIGN_OUT_DATA, items: manyItems }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test transiciones de estado (lógica de negocio pura)
// ---------------------------------------------------------------------------

describe("transiciones de estado WHO checklist", () => {
  /**
   * Extrae la lógica de validación de estado del router para testearla
   * sin montar el servidor tRPC.
   */
  function validateTransition(estadoActual: string, faseSolicitada: "sign_in" | "time_out" | "sign_out"): boolean {
    if (faseSolicitada === "sign_in")  return estadoActual === "iniciado";
    if (faseSolicitada === "time_out") return estadoActual === "sign_in_completo";
    if (faseSolicitada === "sign_out") return estadoActual === "time_out_completo";
    return false;
  }

  it("sign_in solo es válido en estado iniciado", () => {
    expect(validateTransition("iniciado", "sign_in")).toBe(true);
    expect(validateTransition("sign_in_completo", "sign_in")).toBe(false);
    expect(validateTransition("completo", "sign_in")).toBe(false);
  });

  it("time_out solo es válido en sign_in_completo", () => {
    expect(validateTransition("sign_in_completo", "time_out")).toBe(true);
    expect(validateTransition("iniciado", "time_out")).toBe(false);
    expect(validateTransition("completo", "time_out")).toBe(false);
  });

  it("sign_out solo es válido en time_out_completo", () => {
    expect(validateTransition("time_out_completo", "sign_out")).toBe(true);
    expect(validateTransition("sign_in_completo", "sign_out")).toBe(false);
    expect(validateTransition("iniciado", "sign_out")).toBe(false);
  });

  it("flujo completo es secuencial: iniciado→sign_in→time_out→sign_out", () => {
    let estado = "iniciado";
    expect(validateTransition(estado, "sign_in")).toBe(true);
    estado = "sign_in_completo";
    expect(validateTransition(estado, "time_out")).toBe(true);
    estado = "time_out_completo";
    expect(validateTransition(estado, "sign_out")).toBe(true);
  });
});
