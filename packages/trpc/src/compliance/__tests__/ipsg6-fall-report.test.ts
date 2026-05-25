/**
 * Compliance test — JCI Standard: IPSG.6 ME 4
 *
 * IPSG.6: Reduce the Risk of Patient Harm Resulting from Falls.
 * ME 4:   The hospital implements and monitors a program for reducing patient
 *         falls including structured documentation of fall events.
 *
 * Cubre: US.5.16 — Formulario estructurado reporte de caídas.
 *
 * Estrategia: tests unitarios con funciones puras que replican el contrato
 * del schema Zod + guards del router fall-event.router.ts, sin levantar
 * Postgres ni tRPC completo.
 *
 * Tests de integración (BD real) corresponden a e2e/compliance-ipsg6.spec.ts (@QA).
 *
 * JCI Standard: IPSG.6 ME 4
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { fallEventInputSchema } from "@his/contracts/schemas/fall-event";

// ---------------------------------------------------------------------------
// Helpers que replican las guards del router
// ---------------------------------------------------------------------------

function validateFallEventInput(raw: unknown) {
  return fallEventInputSchema.safeParse(raw);
}

/**
 * Guard: firmaPin es obligatoria para registrar una caída.
 * Replica el reject que haría el procedure si el PIN llegara vacío.
 *
 * JCI Standard: IPSG.6 ME 4
 */
function assertPinPresent(pin: string | undefined): void {
  if (!pin || pin.length < 4) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Se requiere firma electrónica (PIN) para registrar una caída.",
    });
  }
}

/**
 * Guard: cuando lugar = 'otro', lugarOtro debe estar presente.
 * Replica el superRefine del schema Zod.
 *
 * JCI Standard: IPSG.6 ME 4
 */
function assertLugarOtroPresent(lugar: string, lugarOtro: string | undefined): void {
  if (lugar === "otro" && !lugarOtro) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "lugarOtro es obligatorio cuando lugar es 'otro'.",
    });
  }
}

// ---------------------------------------------------------------------------
// Fixture base válido
// ---------------------------------------------------------------------------

const BASE_VALID = {
  pacienteId:              "00000000-0000-0000-0000-000000000001",
  episodioId:              "00000000-0000-0000-0000-000000000002",
  lugar:                   "cama",
  testigoPresente:         true,
  testigoTipo:             "enfermera",
  circunstancia:           "Paciente intentó levantarse sin asistencia y perdió el equilibrio.",
  lesionResultante:        "leve",
  requirioAtencionMedica:  false,
  intervencionAplicada:    "Se colocaron barandas y se notificó al médico tratante.",
  firmaPin:                "1234",
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IPSG.6 ME 4 — Reporte estructurado de caídas", () => {
  // JCI Standard: IPSG.6 ME 4
  it("record con todos los campos válidos → schema OK", () => {
    const result = validateFallEventInput(BASE_VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lugar).toBe("cama");
      expect(result.data.lesionResultante).toBe("leve");
      expect(result.data.testigoPresente).toBe(true);
    }
  });

  // JCI Standard: IPSG.6 ME 4
  it("record sin firmaPin → UNAUTHORIZED", () => {
    expect(() => assertPinPresent(undefined)).toThrowError(
      expect.objectContaining({ code: "UNAUTHORIZED" }),
    );
  });

  // JCI Standard: IPSG.6 ME 4
  it("record con firmaPin vacío → UNAUTHORIZED", () => {
    expect(() => assertPinPresent("")).toThrowError(
      expect.objectContaining({ code: "UNAUTHORIZED" }),
    );
  });

  // JCI Standard: IPSG.6 ME 4
  it("record con lugar='otro' sin lugarOtro → BAD_REQUEST", () => {
    expect(() => assertLugarOtroPresent("otro", undefined)).toThrowError(
      expect.objectContaining({ code: "BAD_REQUEST" }),
    );
  });

  // JCI Standard: IPSG.6 ME 4
  it("record con lugar='otro' y lugarOtro presente → no lanza", () => {
    expect(() => assertLugarOtroPresent("otro", "Sala de espera")).not.toThrow();
  });

  // JCI Standard: IPSG.6 ME 4
  it("record con lugar='otro' sin lugarOtro → falla en schema Zod", () => {
    const raw = { ...BASE_VALID, lugar: "otro", lugarOtro: undefined };
    const result = validateFallEventInput(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("lugarOtro");
    }
  });

  // JCI Standard: IPSG.6 ME 4
  it("record con lugar='otro' y lugarOtro → schema OK", () => {
    const raw = { ...BASE_VALID, lugar: "otro", lugarOtro: "Sala de espera" };
    const result = validateFallEventInput(raw);
    expect(result.success).toBe(true);
  });

  // JCI Standard: IPSG.6 ME 4
  it("record con lesionResultante inválida → schema falla", () => {
    const raw = { ...BASE_VALID, lesionResultante: "critica" };
    const result = validateFallEventInput(raw);
    expect(result.success).toBe(false);
  });

  // JCI Standard: IPSG.6 ME 4
  it("record sin circunstancia → schema falla", () => {
    const raw = { ...BASE_VALID, circunstancia: "" };
    const result = validateFallEventInput(raw);
    expect(result.success).toBe(false);
  });
});
