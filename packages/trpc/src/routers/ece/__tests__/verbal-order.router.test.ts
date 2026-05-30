/**
 * Tests unitarios — verbal-order.router.ts — JCI IPSG.2-H1 read-back enforcement.
 *
 * Estrategia: funciones puras que replican el contrato del router sin Postgres.
 * Tests de integración (BD real) → e2e/compliance-ipsg2.spec.ts (@QA).
 *
 * JCI Standard: IPSG.2 ME 1
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Tipos mínimos
// ---------------------------------------------------------------------------

type VerbalOrderEstado = "dictada" | "registrada" | "confirmada" | "rechazada";

interface VerbalOrderStub {
  id: string;
  orden_texto: string;
  estado: VerbalOrderEstado;
  texto_readback: string | null;
  readback_at: Date | null;
  readback_by: string | null;
  readback_text: string | null;
  readback_match: boolean | null;
}

// ---------------------------------------------------------------------------
// Funciones puras que replican el contrato del router (IPSG.2-H1 edition)
// ---------------------------------------------------------------------------

/** Guarda de estado — replica assertOrdenRegistrada del router. */
function assertOrdenRegistrada(order: VerbalOrderStub | null, orderId: string): void {
  if (!order) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Orden verbal no encontrada: ${orderId}` });
  }
  if (order.estado !== "registrada") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `La orden no está en estado 'registrada' (estado actual: ${order.estado}). Solo se puede confirmar una orden registrada.`,
    });
  }
}

/**
 * Guard IPSG.2-H1 — replica la lógica añadida en confirmReadback.
 * readbackMatch=false → PRECONDITION_FAILED antes de verificar PIN.
 */
function assertReadbackMatchOrThrow(readbackMatch: boolean): void {
  if (!readbackMatch) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El read-back no coincidió con la orden original. Corrija la orden antes de confirmar (IPSG.2-H1).",
    });
  }
}

/** Valida longitud mínima de readbackText (replica validación Zod del input). */
function assertReadbackTextLength(readbackText: string): void {
  if (readbackText.length < 10) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "readbackText debe tener al menos 10 caracteres.",
    });
  }
}

/**
 * Simula la persistencia del read-back — replica el UPDATE del router.
 * Devuelve el estado resultante del registro.
 */
function applyReadbackAndConfirm(
  order: VerbalOrderStub,
  opts: {
    readbackText: string;
    readbackMatch: boolean;
    ordenConfirmada: boolean;
    byUserId: string;
  },
): VerbalOrderStub {
  return {
    ...order,
    estado: opts.ordenConfirmada ? "confirmada" : "rechazada",
    readback_at: new Date(),
    readback_by: opts.byUserId,
    readback_text: opts.readbackText,
    readback_match: opts.readbackMatch,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORDER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const ordenRegistrada: VerbalOrderStub = {
  id: ORDER_ID,
  orden_texto: "Amoxicilina 500mg c/8h VO x 7 días",
  estado: "registrada",
  texto_readback: null,
  readback_at: null,
  readback_by: null,
  readback_text: null,
  readback_match: null,
};

const ordenConfirmadaFixture: VerbalOrderStub = {
  ...ordenRegistrada,
  estado: "confirmada",
  readback_at: new Date(),
  readback_by: USER_ID,
  readback_text: "Amoxicilina 500mg cada 8 horas vía oral por 7 días",
  readback_match: true,
};

// ---------------------------------------------------------------------------
// Suite — IPSG.2-H1 read-back enforcement
// ---------------------------------------------------------------------------

describe("IPSG.2-H1 — Read-back auditable de órdenes verbales", () => {
  /**
   * Happy path: readbackMatch=true + readbackText ≥ 10 chars → persiste y confirma.
   * JCI Standard: IPSG.2 ME 1
   */
  it("happy path: readbackMatch=true persiste timestamp y userId", () => {
    expect(() => assertOrdenRegistrada(ordenRegistrada, ORDER_ID)).not.toThrow();
    expect(() => assertReadbackMatchOrThrow(true)).not.toThrow();

    const updated = applyReadbackAndConfirm(ordenRegistrada, {
      readbackText: "Amoxicilina 500mg c/8h VO x 7 días",
      readbackMatch: true,
      ordenConfirmada: true,
      byUserId: USER_ID,
    });

    expect(updated.estado).toBe("confirmada");
    expect(updated.readback_at).toBeInstanceOf(Date);
    expect(updated.readback_by).toBe(USER_ID);
    expect(updated.readback_text).toBe("Amoxicilina 500mg c/8h VO x 7 días");
    expect(updated.readback_match).toBe(true);
  });

  /**
   * Reject: readbackMatch=false → PRECONDITION_FAILED.
   * No puede confirmarse una orden cuyo read-back no coincide (IPSG.2-H1).
   * JCI Standard: IPSG.2 ME 1
   */
  it("readbackMatch=false → TRPCError PRECONDITION_FAILED", () => {
    let caught: unknown;
    try {
      assertReadbackMatchOrThrow(false);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("PRECONDITION_FAILED");
    expect(trpcErr.message).toContain("IPSG.2-H1");
  });

  /**
   * Reject: readbackText < 10 chars → validation error.
   * El texto mínimo asegura que el receptor haya reproducido contenido sustantivo.
   * JCI Standard: IPSG.2 ME 1
   */
  it("readbackText con menos de 10 chars → TRPCError BAD_REQUEST", () => {
    let caught: unknown;
    try {
      assertReadbackTextLength("corto");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("BAD_REQUEST");
  });

  /**
   * Confirmar orden ya confirmada → CONFLICT.
   * Previene doble-confirmación; readback_at solo se registra una vez.
   * JCI Standard: IPSG.2 ME 1
   */
  it("confirmar orden ya confirmada → TRPCError CONFLICT", () => {
    let caught: unknown;
    try {
      assertOrdenRegistrada(ordenConfirmadaFixture, ORDER_ID);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("CONFLICT");
  });

  /**
   * readbackText con exactamente 10 chars → pasa validación de longitud mínima.
   */
  it("readbackText con 10 chars exactos → sin error", () => {
    expect(() => assertReadbackTextLength("1234567890")).not.toThrow();
  });

  /**
   * Orden no encontrada → NOT_FOUND.
   */
  it("orden no encontrada → TRPCError NOT_FOUND", () => {
    let caught: unknown;
    try {
      assertOrdenRegistrada(null, ORDER_ID);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("NOT_FOUND");
  });
});
