/**
 * Compliance test — IPSG.6 ME 2: Re-evaluación Escala Morse por turno (SLA 12 h)
 *
 * JCI Standard: IPSG.6 ME 2
 * "The organization identifies patients at risk for falls and implements measures to
 *  reduce the risk of falls for these patients."
 * Exigencia operacional: Escala Morse re-evaluada en cada turno hospitalario (≤12 h).
 *
 * La lógica del watchdog vive en pg_cron (120_morse_sla_watchdog.sql).
 * Este test valida la regla de negocio en TS simulando las filas que pg_cron consultaría.
 *
 * Cubre:
 *   1. Paciente con última Morse < 12 h → NO debe alertar.
 *   2. Paciente con última Morse > 12 h → DEBE alertar.
 *   3. Paciente sin ninguna valoración Morse → DEBE alertar (null = nunca evaluado).
 *   4. Episodio cerrado con Morse vencida → NO debe alertar (solo activos).
 *   5. Idempotencia: alerta ya emitida en la última hora → NO duplicar.
 */

// JCI Standard: IPSG.6 ME 2
import { describe, it, expect } from "vitest";
import { ipsg6MorseSlaExceededPayloadSchema } from "@his/contracts/events";

// ---------------------------------------------------------------------------
// Tipos y helpers que replican la lógica del watchdog SQL en TS puro
// ---------------------------------------------------------------------------

type EpisodioEstado = "abierto" | "en_curso" | "cerrado" | "cancelado";

interface EpisodioRow {
  episodioId: string;
  pacienteId: string;
  organizationId: string;
  estado: EpisodioEstado;
  /** null = nunca evaluado */
  ultimaMorseEn: Date | null;
}

interface AlertaEmitidaRow {
  episodioId: string;
  occurredAt: Date;
}

const SLA_HORAS = 12;
const DEDUP_VENTANA_MS = 60 * 60 * 1000; // 1 hora

/**
 * Replica la lógica del SELECT en el job pg_cron.
 * Retorna los episodios que deben generar alerta.
 */
function evaluarMorseSla(
  episodios: EpisodioRow[],
  alertasRecientes: AlertaEmitidaRow[],
  ahora: Date = new Date(),
): EpisodioRow[] {
  const alertaSet = new Set(
    alertasRecientes
      .filter(
        (a) => ahora.getTime() - a.occurredAt.getTime() < DEDUP_VENTANA_MS,
      )
      .map((a) => a.episodioId),
  );

  return episodios.filter((ep) => {
    // Solo episodios activos
    if (ep.estado !== "abierto" && ep.estado !== "en_curso") return false;

    // Guard de idempotencia: ya alertado en la última hora
    if (alertaSet.has(ep.episodioId)) return false;

    // Sin valoración → alerta inmediata
    if (ep.ultimaMorseEn === null) return true;

    // Valoración antigua → alerta
    const horasTranscurridas =
      (ahora.getTime() - ep.ultimaMorseEn.getTime()) / (1000 * 3600);
    return horasTranscurridas > SLA_HORAS;
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EPISODIO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EPISODIO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EPISODIO_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const EPISODIO_D = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const PACIENTE_1 = "11111111-1111-1111-1111-111111111111";
const ORG_ID     = "00000000-0000-0000-0000-000000000001";

const AHORA = new Date("2026-05-24T10:00:00Z");
const HACE_6H  = new Date(AHORA.getTime() - 6 * 3600 * 1000);
const HACE_13H = new Date(AHORA.getTime() - 13 * 3600 * 1000);
const HACE_30M = new Date(AHORA.getTime() - 30 * 60 * 1000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// JCI Standard: IPSG.6 ME 2
describe("IPSG.6 ME 2 — Vigilancia SLA Escala Morse por turno hospitalario", () => {
  // 1. Morse reciente → no alerta
  it("paciente con última Morse hace 6 h → no debe generar alerta", () => {
    const episodios: EpisodioRow[] = [
      {
        episodioId: EPISODIO_A,
        pacienteId: PACIENTE_1,
        organizationId: ORG_ID,
        estado: "en_curso",
        ultimaMorseEn: HACE_6H,
      },
    ];

    // JCI Standard: IPSG.6 ME 2 — dentro del SLA de 12 h no requiere acción
    const alertas = evaluarMorseSla(episodios, [], AHORA);
    expect(alertas).toHaveLength(0);
  });

  // 2. Morse vencida → alerta
  it("paciente con última Morse hace 13 h → DEBE generar alerta", () => {
    const episodios: EpisodioRow[] = [
      {
        episodioId: EPISODIO_B,
        pacienteId: PACIENTE_1,
        organizationId: ORG_ID,
        estado: "en_curso",
        ultimaMorseEn: HACE_13H,
      },
    ];

    // JCI Standard: IPSG.6 ME 2 — >12 h sin re-evaluación exige intervención
    const alertas = evaluarMorseSla(episodios, [], AHORA);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]!.episodioId).toBe(EPISODIO_B);
  });

  // 3. Sin valoración Morse → alerta
  it("paciente sin ninguna valoración Morse → DEBE generar alerta (nunca evaluado)", () => {
    const episodios: EpisodioRow[] = [
      {
        episodioId: EPISODIO_C,
        pacienteId: PACIENTE_1,
        organizationId: ORG_ID,
        estado: "abierto",
        ultimaMorseEn: null,
      },
    ];

    // JCI Standard: IPSG.6 ME 2 — ausencia de evaluación es incumplimiento
    const alertas = evaluarMorseSla(episodios, [], AHORA);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]!.ultimaMorseEn).toBeNull();
  });

  // 4. Episodio cerrado → no alerta (solo activos)
  it("episodio cerrado con Morse vencida → NO debe generar alerta", () => {
    const episodios: EpisodioRow[] = [
      {
        episodioId: EPISODIO_D,
        pacienteId: PACIENTE_1,
        organizationId: ORG_ID,
        estado: "cerrado",
        ultimaMorseEn: HACE_13H,
      },
    ];

    // JCI Standard: IPSG.6 ME 2 — paciente dado de alta no requiere re-evaluación
    const alertas = evaluarMorseSla(episodios, [], AHORA);
    expect(alertas).toHaveLength(0);
  });

  // 5. Idempotencia: alerta ya emitida en la última hora → no duplicar
  it("alerta ya emitida hace 30 min → NO duplicar (guard de idempotencia)", () => {
    const episodios: EpisodioRow[] = [
      {
        episodioId: EPISODIO_B,
        pacienteId: PACIENTE_1,
        organizationId: ORG_ID,
        estado: "en_curso",
        ultimaMorseEn: HACE_13H,
      },
    ];
    const alertasRecientes: AlertaEmitidaRow[] = [
      { episodioId: EPISODIO_B, occurredAt: HACE_30M },
    ];

    // JCI Standard: IPSG.6 ME 2 — una alerta por hora es suficiente; no spam
    const alertas = evaluarMorseSla(episodios, alertasRecientes, AHORA);
    expect(alertas).toHaveLength(0);
  });

  // 6. Validación del schema Zod del payload
  it("payload ipsg6.morse_sla_exceeded pasa el schema Zod con horasTranscurridas", () => {
    const payload = {
      pacienteId: PACIENTE_1,
      episodioId: EPISODIO_B,
      ultimaEvaluacionEn: HACE_13H.toISOString(),
      horasTranscurridas: 13.0,
    };

    // JCI Standard: IPSG.6 ME 2 — el evento emitido debe satisfacer el contrato de payload
    const result = ipsg6MorseSlaExceededPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  // 7. Payload con ultimaEvaluacionEn=null (nunca evaluado) pasa el schema
  it("payload con ultimaEvaluacionEn=null (nunca evaluado) pasa el schema Zod", () => {
    const payload = {
      pacienteId: PACIENTE_1,
      episodioId: EPISODIO_C,
      ultimaEvaluacionEn: null,
      horasTranscurridas: null,
    };

    // JCI Standard: IPSG.6 ME 2 — ausencia total de evaluación debe poder representarse
    const result = ipsg6MorseSlaExceededPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
