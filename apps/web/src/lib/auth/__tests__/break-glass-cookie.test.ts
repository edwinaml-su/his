/**
 * CC-0017 F3 — `parseBreakGlassCookie` (lib/auth/break-glass-cookie.ts).
 *
 * Función pura (sin I/O), consumida por `getTenantContext()`, aislada en su
 * propio módulo justamente para poder probar el contrato fail-safe sin
 * mockear Supabase/Prisma/`next/headers`: cualquier cookie ausente,
 * corrupta, con campos faltantes, o expirada debe resolver a `null` (==
 * comportamiento idéntico al de hoy, sin break-glass).
 */
import { describe, it, expect } from "vitest";
import { parseBreakGlassCookie } from "../break-glass-cookie";

const NOW = new Date("2026-08-08T12:00:00.000Z");
const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

function validRaw(activatedAt: string) {
  return JSON.stringify({
    patientId: PATIENT_ID,
    justification: "Paciente inconsciente, requiere revisión urgente de alergias.",
    activatedAt,
  });
}

describe("parseBreakGlassCookie — fail-safe (CC-0017 F3)", () => {
  it("cookie ausente (undefined) → null", () => {
    expect(parseBreakGlassCookie(undefined, NOW)).toBeNull();
  });

  it("cookie vacía → null", () => {
    expect(parseBreakGlassCookie("", NOW)).toBeNull();
  });

  it("JSON corrupto → null (no lanza)", () => {
    expect(parseBreakGlassCookie("{not-json", NOW)).toBeNull();
  });

  it("campos faltantes (sin justification) → null", () => {
    const raw = JSON.stringify({ patientId: PATIENT_ID, activatedAt: NOW.toISOString() });
    expect(parseBreakGlassCookie(raw, NOW)).toBeNull();
  });

  it("activatedAt no parseable → null", () => {
    const raw = JSON.stringify({
      patientId: PATIENT_ID,
      justification: "justificación válida de más de 20 caracteres",
      activatedAt: "no-es-una-fecha",
    });
    expect(parseBreakGlassCookie(raw, NOW)).toBeNull();
  });

  it("cookie vigente (activada hace 10 min, TTL 1h) → sesión con expiresAt futuro", () => {
    const activatedAt = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
    const result = parseBreakGlassCookie(validRaw(activatedAt), NOW);
    expect(result).not.toBeNull();
    expect(result?.patientId).toBe(PATIENT_ID);
    expect(new Date(result!.expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("cookie expirada (activada hace 2h, TTL 1h) → null", () => {
    const activatedAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
    expect(parseBreakGlassCookie(validRaw(activatedAt), NOW)).toBeNull();
  });

  it("cookie justo en el borde de expiración (exactamente TTL) → null", () => {
    const activatedAt = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(parseBreakGlassCookie(validRaw(activatedAt), NOW)).toBeNull();
  });
});
