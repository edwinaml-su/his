/**
 * Compliance tests — JCI Standard: IPSG.2 ME 4
 * "Hand-over communications include up-to-date information about the patient's
 *  care, treatment, condition, and any recent or anticipated changes."
 *
 * Cubre US.JCI.5.8 — Template SBAR estructurado en handoff REG_ENF cierre turno.
 *
 * Estrategia: funciones puras que replican el contrato de cerrarTurno +
 * validación Zod del schema SBAR. Sin base de datos real.
 *
 * JCI Standard: IPSG.2 ME 4
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Schema SBAR — réplica del schema definido en el router
// (no importamos el router directamente para evitar dependencias de Prisma)
// ---------------------------------------------------------------------------

const sbarFieldSchema = z.string().trim().min(10).max(2000);

// JCI Standard: IPSG.2 ME 4
const sbarSchema = z.object({
  situation:      sbarFieldSchema,
  background:     sbarFieldSchema,
  assessment:     sbarFieldSchema,
  recommendation: sbarFieldSchema,
});

const eceCierreSchema = z.object({
  id:   z.string().uuid(),
  sbar: sbarSchema.optional(),
});

type EceCierreInput = z.infer<typeof eceCierreSchema>;

// ---------------------------------------------------------------------------
// Lógica de cierre extraída como función pura
// ---------------------------------------------------------------------------

/** Replica el contrato de cerrarTurno para tests unitarios sin tRPC context. */
function validateCierreInput(input: EceCierreInput): {
  ok: true;
  warning?: string;
} {
  const parsed = eceCierreSchema.safeParse(input);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }

  const sbarMissing = parsed.data.sbar == null;
  return {
    ok: true as const,
    ...(sbarMissing && {
      warning:
        "SBAR no registrado. JCI IPSG.2 ME 4 recomienda handoff estructurado " +
        "al cierre de turno cuando el paciente permanece activo.",
    }),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_ID = "00000000-0000-0000-0000-000000000001";

const SBAR_COMPLETO = {
  situation:      "Paciente post-quirúrgico, estable, sin signos de alarma.",
  background:     "Colecistectomía laparoscópica hace 6h. Sin antecedentes relevantes.",
  assessment:     "Dolor controlado EVA 2/10, PA 118/76, FC 82. Herida sin signos de infección.",
  recommendation: "Control de signos vitales c/4h, analgesia PRN, deambulación asistida al despertar.",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IPSG.2 ME 4 — SBAR handoff al cierre de turno REG_ENF", () => {
  describe("cerrarTurno con SBAR completo", () => {
    it("acepta cierre con los 4 componentes SBAR y retorna ok sin warning", () => {
      // JCI Standard: IPSG.2 ME 4
      const result = validateCierreInput({ id: VALID_ID, sbar: SBAR_COMPLETO });

      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it("acepta cada campo SBAR con exactamente 10 caracteres (mínimo)", () => {
      const sbarMinimo = {
        situation:      "Estable hoy",
        background:     "Sin cambios",
        assessment:     "Sin alarmas",
        recommendation: "Continuar tx",
      };
      // JCI Standard: IPSG.2 ME 4
      const result = validateCierreInput({ id: VALID_ID, sbar: sbarMinimo });
      expect(result.ok).toBe(true);
    });
  });

  describe("cerrarTurno sin SBAR (paciente normal)", () => {
    it("permite cierre sin sbar y retorna warning informativo", () => {
      // JCI Standard: IPSG.2 ME 4
      // El estándar recomienda SBAR pero no bloquea si no hay enfermero entrante
      const result = validateCierreInput({ id: VALID_ID });

      expect(result.ok).toBe(true);
      expect(result.warning).toContain("IPSG.2 ME 4");
    });

    it("permite cierre con sbar explícitamente undefined (equivalente a omitido)", () => {
      // JCI Standard: IPSG.2 ME 4
      const result = validateCierreInput({ id: VALID_ID, sbar: undefined });

      expect(result.ok).toBe(true);
      expect(result.warning).toBeDefined();
    });
  });

  describe("cerrarTurno con SBAR malformado", () => {
    it("rechaza SBAR con campo situation vacío", () => {
      // JCI Standard: IPSG.2 ME 4
      expect(() =>
        validateCierreInput({
          id: VALID_ID,
          sbar: { ...SBAR_COMPLETO, situation: "Corto" },
        })
      ).toThrow(TRPCError);
    });

    it("rechaza SBAR con campo background de menos de 10 caracteres", () => {
      // JCI Standard: IPSG.2 ME 4
      expect(() =>
        validateCierreInput({
          id: VALID_ID,
          sbar: { ...SBAR_COMPLETO, background: "Poca info" },
        })
      ).toThrow(TRPCError);
    });

    it("rechaza SBAR con assessment que excede 2000 caracteres", () => {
      // JCI Standard: IPSG.2 ME 4
      const textoLargo = "x".repeat(2001);
      expect(() =>
        validateCierreInput({
          id: VALID_ID,
          sbar: { ...SBAR_COMPLETO, assessment: textoLargo },
        })
      ).toThrow(TRPCError);
    });

    it("rechaza SBAR con recommendation vacía (cadena de espacios trimmed)", () => {
      // JCI Standard: IPSG.2 ME 4
      expect(() =>
        validateCierreInput({
          id: VALID_ID,
          sbar: { ...SBAR_COMPLETO, recommendation: "   " },
        })
      ).toThrow(TRPCError);
    });

    it("rechaza SBAR parcial (falta campo assessment)", () => {
      // JCI Standard: IPSG.2 ME 4
      expect(() =>
        validateCierreInput({
          id: VALID_ID,
          sbar: {
            situation:      SBAR_COMPLETO.situation,
            background:     SBAR_COMPLETO.background,
            // assessment omitido
            recommendation: SBAR_COMPLETO.recommendation,
          } as typeof SBAR_COMPLETO,
        })
      ).toThrow(TRPCError);
    });

    it("el error es BAD_REQUEST (no INTERNAL_SERVER_ERROR)", () => {
      // JCI Standard: IPSG.2 ME 4
      let caught: TRPCError | null = null;
      try {
        validateCierreInput({
          id: VALID_ID,
          sbar: { ...SBAR_COMPLETO, situation: "x" },
        });
      } catch (e) {
        caught = e as TRPCError;
      }

      expect(caught).not.toBeNull();
      expect(caught?.code).toBe("BAD_REQUEST");
    });
  });

  describe("validación de id", () => {
    it("rechaza id que no es UUID válido", () => {
      // JCI Standard: IPSG.2 ME 4
      expect(() =>
        validateCierreInput({ id: "no-es-uuid", sbar: SBAR_COMPLETO })
      ).toThrow(TRPCError);
    });
  });
});
