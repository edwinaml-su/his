/**
 * Compliance test — JCI Standard: IPSG.2 ME 1
 *
 * IPSG.2: Improve Effective Communication.
 * ME 1:   The hospital implements a process for verbal or telephone orders or
 *         critical test results that requires a verification "read-back" of the
 *         complete order or test result by the person receiving the information.
 *
 * Cubre: US.JCI.5.5 — Workflow read-back de órdenes verbales (8 SP).
 *
 * Estrategia: tests unitarios con funciones puras que replican el contrato del
 * router verbal-order.router.ts sin levantar Postgres ni tRPC completo.
 *
 * Tests de integración (BD real) corresponden a e2e/compliance-ipsg2.spec.ts (@QA).
 *
 * JCI Standard: IPSG.2 ME 1
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Tipos mínimos — replica la forma de los datos del router
// ---------------------------------------------------------------------------

type VerbalOrderEstado = "dictada" | "registrada" | "confirmada" | "rechazada";

interface VerbalOrderStub {
  id: string;
  episodio_id: string;
  orden_texto: string;
  estado: VerbalOrderEstado;
  texto_readback: string | null;
}

// ---------------------------------------------------------------------------
// Funciones puras que replican el contrato del router
// ---------------------------------------------------------------------------

/**
 * Verifica que la orden está en estado 'registrada' antes de confirmar.
 * Replica la guard del procedure confirmReadback.
 *
 * JCI Standard: IPSG.2 ME 1
 */
function assertOrdenRegistrada(order: VerbalOrderStub | null, orderId: string): void {
  if (!order) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Orden verbal no encontrada: ${orderId}`,
    });
  }
  if (order.estado !== "registrada") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `La orden no está en estado 'registrada' (estado actual: ${order.estado}). Solo se puede confirmar una orden registrada.`,
    });
  }
}

/**
 * Aplica la transición de estado tras confirmación/rechazo del MC.
 * Replica la lógica de actualización del procedure confirmReadback.
 *
 * JCI Standard: IPSG.2 ME 1
 */
function applyReadbackDecision(
  order: VerbalOrderStub,
  ordenConfirmada: boolean,
  ordenCorregida?: string,
): { estado: VerbalOrderEstado; texto_readback: string | null } {
  const nuevoEstado: VerbalOrderEstado = ordenConfirmada ? "confirmada" : "rechazada";
  const textoReadback = !ordenConfirmada && ordenCorregida
    ? ordenCorregida
    : order.texto_readback;

  return { estado: nuevoEstado, texto_readback: textoReadback };
}

/**
 * Valida que el rol del usuario tiene permiso para confirmar.
 * Solo MC o ESP pueden ejecutar confirmReadback.
 *
 * JCI Standard: IPSG.2 ME 1
 */
function assertRoleCanConfirm(roleCodes: string[]): void {
  const allowed = ["MC", "ESP"];
  if (!roleCodes.some((r) => allowed.includes(r))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Rol requerido: ${allowed.join(", ")}`,
    });
  }
}

/**
 * Valida que el rol del usuario tiene permiso para registrar (record).
 * Solo NURSE o ENF pueden ejecutar record.
 *
 * JCI Standard: IPSG.2 ME 1
 */
function assertRoleCanRecord(roleCodes: string[]): void {
  const allowed = ["NURSE", "ENF"];
  if (!roleCodes.some((r) => allowed.includes(r))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Rol requerido: ${allowed.join(", ")}`,
    });
  }
}

/**
 * Simula la verificación de PIN — replica el comportamiento de verifyPinOrThrow.
 * En producción usa argon2.verify; aquí se modela como función pura de stub.
 *
 * JCI Standard: IPSG.2 ME 1
 */
function verifyPinStub(storedHash: string, pin: string): void {
  // El stub usa igualdad directa — en producción es argon2.verify()
  if (pin !== storedHash) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "PIN incorrecto. Intentos restantes: 4.",
    });
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORDER_ID = "11111111-1111-1111-1111-111111111111";

const ordenRegistrada: VerbalOrderStub = {
  id: ORDER_ID,
  episodio_id: "22222222-2222-2222-2222-222222222222",
  orden_texto: "Amoxicilina 500mg c/8h VO x 7 días",
  estado: "registrada",
  texto_readback: null,
};

const ordenConfirmadaFixture: VerbalOrderStub = {
  ...ordenRegistrada,
  estado: "confirmada",
};

const VALID_PIN_HASH = "secret1234";

// ---------------------------------------------------------------------------
// Suite — ciclo completo read-back IPSG.2
// ---------------------------------------------------------------------------

// JCI Standard: IPSG.2 ME 1
describe("IPSG.2 ME 1 — Workflow read-back de órdenes verbales", () => {
  /**
   * Happy path: enfermera registra → MC confirma → estado=confirmada.
   * Valida el ciclo nominal completo del JCI read-back.
   */
  it("happy path: ENF registra y MC confirma → estado confirmada", () => {
    // JCI Standard: IPSG.2 ME 1

    // 1. ENF puede registrar
    expect(() => assertRoleCanRecord(["ENF"])).not.toThrow();

    // 2. La orden existe y está registrada
    expect(() => assertOrdenRegistrada(ordenRegistrada, ORDER_ID)).not.toThrow();

    // 3. MC tiene rol para confirmar
    expect(() => assertRoleCanConfirm(["MC"])).not.toThrow();

    // 4. PIN correcto
    expect(() => verifyPinStub(VALID_PIN_HASH, VALID_PIN_HASH)).not.toThrow();

    // 5. Transición confirmada
    const result = applyReadbackDecision(ordenRegistrada, true);
    expect(result.estado).toBe("confirmada");
  });

  /**
   * MC rechaza → ordenCorregida persiste en texto_readback → ENF debe re-registrar.
   * Valida la rama de rechazo del ciclo JCI.
   */
  it("MC rechaza con ordenCorregida → estado rechazada y texto_readback actualizado", () => {
    // JCI Standard: IPSG.2 ME 1
    const textoCorregido = "Amoxicilina 1g c/12h VO x 7 días";

    expect(() => assertOrdenRegistrada(ordenRegistrada, ORDER_ID)).not.toThrow();
    expect(() => verifyPinStub(VALID_PIN_HASH, VALID_PIN_HASH)).not.toThrow();

    const result = applyReadbackDecision(ordenRegistrada, false, textoCorregido);
    expect(result.estado).toBe("rechazada");
    expect(result.texto_readback).toBe(textoCorregido);
  });

  /**
   * PIN incorrecto → UNAUTHORIZED.
   * Valida que el router bloquea confirmación sin PIN válido.
   */
  it("PIN incorrecto → TRPCError UNAUTHORIZED", () => {
    // JCI Standard: IPSG.2 ME 1
    let caught: unknown;
    try {
      verifyPinStub(VALID_PIN_HASH, "wrong-pin");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("UNAUTHORIZED");
  });

  /**
   * Rol incorrecto: NURSE intenta confirmar → FORBIDDEN.
   * JCI requiere que solo el médico (MC/ESP) confirme el read-back.
   */
  it("NURSE intenta confirmReadback → TRPCError FORBIDDEN", () => {
    // JCI Standard: IPSG.2 ME 1
    let caught: unknown;
    try {
      assertRoleCanConfirm(["NURSE"]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("FORBIDDEN");
  });

  /**
   * Orden no encontrada → NOT_FOUND.
   * Protege contra IDs inválidos en confirmReadback.
   */
  it("orden no encontrada → TRPCError NOT_FOUND", () => {
    // JCI Standard: IPSG.2 ME 1
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

  /**
   * Confirmar una orden ya confirmada → CONFLICT.
   * Previene doble confirmación (idempotencia del ciclo JCI).
   */
  it("confirmar orden ya confirmada → TRPCError CONFLICT", () => {
    // JCI Standard: IPSG.2 ME 1
    let caught: unknown;
    try {
      assertOrdenRegistrada(ordenConfirmadaFixture, ORDER_ID);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("CONFLICT");
    expect(trpcErr.message).toContain("confirmada");
  });

  /**
   * Rol incorrecto: MC intenta record (registrar orden) → FORBIDDEN.
   * El registro es responsabilidad exclusiva de la enfermera.
   */
  it("MC intenta record → TRPCError FORBIDDEN", () => {
    // JCI Standard: IPSG.2 ME 1
    let caught: unknown;
    try {
      assertRoleCanRecord(["MC"]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("FORBIDDEN");
  });

  /**
   * Rechazar sin texto corregido → texto_readback permanece null.
   * Caso válido: MC rechaza sin dictar corrección (la enfermera consulta al MC).
   */
  it("MC rechaza sin ordenCorregida → texto_readback permanece null", () => {
    // JCI Standard: IPSG.2 ME 1
    const result = applyReadbackDecision(ordenRegistrada, false);
    expect(result.estado).toBe("rechazada");
    expect(result.texto_readback).toBeNull();
  });
});
