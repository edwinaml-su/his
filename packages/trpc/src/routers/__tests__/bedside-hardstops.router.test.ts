/**
 * Tests unitarios — bedsideHardStopsRouter (US.F2.6.27-30, Stream 10).
 *
 * Cubre los 8 hard stops + helpers de validación:
 *  1.  parseGs1Vencimiento — fecha pasada retorna Date en el pasado
 *  2.  parseGs1Vencimiento — fecha futura retorna Date en el futuro
 *  3.  dentroDeVentanaTerapeutica — dentro de ventana retorna true
 *  4.  dentroDeVentanaTerapeutica — fuera de ventana retorna false
 *  5.  HS-08: GSRN profesional revocado → PROFESIONAL_NO_HABILITADO
 *  6.  HS-08: GSRN profesional no encontrado → PROFESIONAL_NO_HABILITADO
 *  7.  HS-01: GSRN paciente no encontrado → PACIENTE_INCORRECTO
 *  8.  HS-01: GSRN paciente no coincide con indicación → PACIENTE_INCORRECTO
 *  9.  HS-02: GTIN escaneado ≠ GTIN prescrito → MEDICAMENTO_INCORRECTO
 * 10.  HS-06: Medicamento vencido → MEDICAMENTO_VENCIDO
 * 11.  HS-07: Lote en recall → LOTE_EN_RECALL
 * 12.  HS-03: Concentración incorrecta → DOSIS_INCORRECTA
 * 13.  HS-04: Vía incorrecta → VIA_INCORRECTA
 * 14.  HS-05: Fuera de ventana terapéutica → HORA_FUERA_DE_VENTANA
 * 15.  Todos correctos → { ok: true }
 * 16.  getHardStopSummary — retorna conteos agrupados
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import {
  bedsideHardStopsRouter,
  parseGs1Vencimiento,
  dentroDeVentanaTerapeutica,
  type BedsideValidateInput,
} from "../bedside-hardstops.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN } from "@his/test-utils";
import {
  HARD_STOP_SCENARIOS,
  GSRN_VALUES,
  GTIN_VALUES,
} from "../../../../test-utils/src/fixtures/bedside-hardstops";

// ---------------------------------------------------------------------------
// IDs de fixtures
// ---------------------------------------------------------------------------

const ORG_ID       = MOCK_TENANT.organizationId;
const INDICACION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PATIENT_ID    = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// ---------------------------------------------------------------------------
// Input base válido (todos los 5 correctos pasan)
// ---------------------------------------------------------------------------

const VALID_INPUT: BedsideValidateInput = {
  gsrnProfesional: GSRN_VALUES.nurses.HS01,
  gsrnPaciente: GSRN_VALUES.patients.HS01,
  scanData: {
    gtin: GTIN_VALUES.AMOXICILINA_500,
    lote: "L-VALID-2026",
    vencimiento: "20271231", // futuro
    serial: "21000001",
  },
  indicacionId: INDICACION_ID,
  timestampEscaneo: "2026-05-18T08:05:00.000Z",
  viaAdministracion: "IV",
};

// Indicación "buena" — coincide con VALID_INPUT
const INDICACION_BUENA = {
  id: INDICACION_ID,
  patient_id: PATIENT_ID,
  gtin_prescripto: GTIN_VALUES.AMOXICILINA_500,
  concentracion_prescrita: null, // sin restricción de dosis para el happy path
  via_administracion: "IV",
  hora_programada: new Date("2026-05-18T08:00:00.000Z"),
  ventana_minutos: 30,
};

// ---------------------------------------------------------------------------
// Helper: construye mock de prisma
// ---------------------------------------------------------------------------

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRaw.mockResolvedValue(0 as never);
  return prisma;
}

/** Configura el mock de prisma para el happy path (todos correctos) */
function setupHappyPath(prisma: DeepMockProxy<PrismaClient>) {
  // GSRN profesional activo
  prisma.$queryRawUnsafe
    .calledWith(expect.stringContaining("gs1_gsrn"), VALID_INPUT.gsrnProfesional)
    .mockResolvedValue([{ id: "gsrn-prof-id", activo: true, tipo: "profesional" }]);

  // GSRN paciente activo — referencia_id = PATIENT_ID
  prisma.$queryRawUnsafe
    .calledWith(expect.stringContaining("tipo = 'paciente'"), VALID_INPUT.gsrnPaciente)
    .mockResolvedValue([{ id: "gsrn-pac-id", referencia_id: PATIENT_ID, activo: true }]);

  // Indicación pertenece al PATIENT_ID
  prisma.$queryRawUnsafe
    .calledWith(expect.stringContaining("indicacion_bedside"), INDICACION_ID, ORG_ID)
    .mockResolvedValue([INDICACION_BUENA]);

  // Sin recall para el lote
  prisma.$queryRawUnsafe
    .calledWith(expect.stringContaining("gs1_gtin_lote"), VALID_INPUT.scanData.gtin, VALID_INPUT.scanData.lote)
    .mockResolvedValue([{ en_recall: false }]);

  // Catálogo GTIN — concentración no restringe (null en indicación)
  prisma.$queryRawUnsafe
    .calledWith(expect.stringContaining("gs1_gtin"), VALID_INPUT.scanData.gtin)
    .mockResolvedValue([{ concentracion: "500mg" }]);

  // Log de hard stop — silencioso
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
}

// ---------------------------------------------------------------------------
// Tests: helpers puros
// ---------------------------------------------------------------------------

describe("parseGs1Vencimiento", () => {
  it("fecha pasada retorna Date en el pasado", () => {
    const d = parseGs1Vencimiento("20240101");
    expect(d.getTime()).toBeLessThan(Date.now());
  });

  it("fecha futura retorna Date en el futuro", () => {
    const d = parseGs1Vencimiento("20291231");
    expect(d.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("dentroDeVentanaTerapeutica", () => {
  const horaProgramada = new Date("2026-05-18T08:00:00.000Z");

  it("dentro de ventana (5 min) retorna true", () => {
    const escaneo = new Date("2026-05-18T08:05:00.000Z");
    expect(dentroDeVentanaTerapeutica(horaProgramada, escaneo, 30)).toBe(true);
  });

  it("fuera de ventana (60 min) retorna false", () => {
    const escaneo = new Date("2026-05-18T09:00:00.000Z");
    expect(dentroDeVentanaTerapeutica(horaProgramada, escaneo, 30)).toBe(false);
  });

  it("exactamente en el límite (30 min) retorna true", () => {
    const escaneo = new Date("2026-05-18T08:30:00.000Z");
    expect(dentroDeVentanaTerapeutica(horaProgramada, escaneo, 30)).toBe(true);
  });

  it("un minuto pasado el límite (31 min) retorna false", () => {
    const escaneo = new Date("2026-05-18T08:31:00.000Z");
    expect(dentroDeVentanaTerapeutica(horaProgramada, escaneo, 30)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: validate mutation
// ---------------------------------------------------------------------------

describe("bedsideHardStopsRouter.validate", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let caller: ReturnType<typeof bedsideHardStopsRouter.createCaller>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
    caller = bedsideHardStopsRouter.createCaller(
      makeCtx({ prisma, user: MOCK_USER_ADMIN, tenant: MOCK_TENANT }),
    );
  });

  // 5 — HS-08: GSRN profesional con activo=false
  it("HS-08: GSRN profesional revocado → PROFESIONAL_NO_HABILITADO", async () => {
    const scenario = HARD_STOP_SCENARIOS["HARD_STOP-08"];

    // Mock para múltiples llamadas (el test llama validate dos veces)
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: "gsrn-revocado", activo: false, tipo: "profesional" },
    ] as never);
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);

    const input: BedsideValidateInput = {
      ...VALID_INPUT,
      gsrnProfesional: scenario.nurse.gsrn,
    };

    await expect(caller.validate(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { hardStopCode: "PROFESIONAL_NO_HABILITADO" },
    });
  });

  // 6 — HS-08: GSRN profesional no existe
  it("HS-08: GSRN profesional no encontrado → PROFESIONAL_NO_HABILITADO", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([]); // sin resultado
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);

    await expect(caller.validate(VALID_INPUT)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { hardStopCode: "PROFESIONAL_NO_HABILITADO" },
    });
  });

  // 7 — HS-01: GSRN paciente no encontrado
  it("HS-01: GSRN paciente no encontrado → PACIENTE_INCORRECTO", async () => {
    // profesional OK
    prisma.$queryRawUnsafe.mockResolvedValueOnce([
      { id: "gsrn-prof", activo: true, tipo: "profesional" },
    ]);
    // paciente: sin resultado
    prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

    await expect(caller.validate(VALID_INPUT)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { hardStopCode: "PACIENTE_INCORRECTO" },
    });
  });

  // 8 — HS-01: GSRN paciente no coincide con indicación
  it("HS-01: GSRN paciente no coincide con indicación → PACIENTE_INCORRECTO", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: "g-prof", activo: true, tipo: "profesional" }])
      .mockResolvedValueOnce([{ id: "g-pac", referencia_id: "OTRO-PATIENT-ID", activo: true }])
      .mockResolvedValueOnce([{ ...INDICACION_BUENA }]);

    await expect(caller.validate(VALID_INPUT)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { hardStopCode: "PACIENTE_INCORRECTO" },
    });
  });

  // 9 — HS-02: GTIN incorrecto
  it("HS-02: GTIN escaneado ≠ GTIN prescrito → MEDICAMENTO_INCORRECTO", async () => {
    const scenario = HARD_STOP_SCENARIOS["HARD_STOP-02"];

    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: "g-prof", activo: true, tipo: "profesional" }])
      .mockResolvedValueOnce([{ id: "g-pac", referencia_id: PATIENT_ID, activo: true }])
      .mockResolvedValueOnce([{
        ...INDICACION_BUENA,
        gtin_prescripto: GTIN_VALUES.AMOXICILINA_500,
      }]);
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);

    const input: BedsideValidateInput = {
      ...VALID_INPUT,
      scanData: {
        ...VALID_INPUT.scanData,
        gtin: scenario.medication.gtinEscaneado, // GTIN diferente
      },
    };

    await expect(caller.validate(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { hardStopCode: "MEDICAMENTO_INCORRECTO" },
    });
  });

  // 10 — HS-06: Medicamento vencido
  it("HS-06: Medicamento vencido (AI17 pasado) → MEDICAMENTO_VENCIDO", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: "g-prof", activo: true, tipo: "profesional" }])
      .mockResolvedValueOnce([{ id: "g-pac", referencia_id: PATIENT_ID, activo: true }])
      .mockResolvedValueOnce([{ ...INDICACION_BUENA }]);
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);

    const input: BedsideValidateInput = {
      ...VALID_INPUT,
      scanData: {
        ...VALID_INPUT.scanData,
        vencimiento: "20240101", // enero 2024 — pasado
      },
    };

    await expect(caller.validate(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { hardStopCode: "MEDICAMENTO_VENCIDO" },
    });
  });

  // 11 — HS-07: Lote en recall
  it("HS-07: Lote en recall activo → LOTE_EN_RECALL", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: "g-prof", activo: true, tipo: "profesional" }])
      .mockResolvedValueOnce([{ id: "g-pac", referencia_id: PATIENT_ID, activo: true }])
      .mockResolvedValueOnce([{ ...INDICACION_BUENA }])
      .mockResolvedValueOnce([{ en_recall: true }]); // lote en recall
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);

    await expect(caller.validate(VALID_INPUT)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { hardStopCode: "LOTE_EN_RECALL" },
    });
  });

  // 12 — HS-03: Concentración incorrecta
  it("HS-03: Concentración escaneada ≠ prescrita → DOSIS_INCORRECTA", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: "g-prof", activo: true, tipo: "profesional" }])
      .mockResolvedValueOnce([{ id: "g-pac", referencia_id: PATIENT_ID, activo: true }])
      .mockResolvedValueOnce([{ ...INDICACION_BUENA, concentracion_prescrita: "500mg" }])
      .mockResolvedValueOnce([{ en_recall: false }])
      .mockResolvedValueOnce([{ concentracion: "1000mg" }]); // concentración diferente
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);

    await expect(caller.validate(VALID_INPUT)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { hardStopCode: "DOSIS_INCORRECTA" },
    });
  });

  // 13 — HS-04: Vía incorrecta
  it("HS-04: Vía escaneada ≠ vía prescrita → VIA_INCORRECTA", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: "g-prof", activo: true, tipo: "profesional" }])
      .mockResolvedValueOnce([{ id: "g-pac", referencia_id: PATIENT_ID, activo: true }])
      .mockResolvedValueOnce([{ ...INDICACION_BUENA, via_administracion: "IV" }])
      .mockResolvedValueOnce([{ en_recall: false }])
      .mockResolvedValueOnce([{ concentracion: null }]); // sin restricción de dosis
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);

    const input: BedsideValidateInput = {
      ...VALID_INPUT,
      viaAdministracion: "VO", // oral vs IV → HS-04
    };

    await expect(caller.validate(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { hardStopCode: "VIA_INCORRECTA" },
    });
  });

  // 14 — HS-05: Fuera de ventana terapéutica
  it("HS-05: Escaneo fuera de ventana terapéutica → HORA_FUERA_DE_VENTANA", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: "g-prof", activo: true, tipo: "profesional" }])
      .mockResolvedValueOnce([{ id: "g-pac", referencia_id: PATIENT_ID, activo: true }])
      .mockResolvedValueOnce([{
        ...INDICACION_BUENA,
        hora_programada: new Date("2026-05-18T08:00:00.000Z"),
        ventana_minutos: 30,
      }])
      .mockResolvedValueOnce([{ en_recall: false }])
      .mockResolvedValueOnce([{ concentracion: null }]);

    const input: BedsideValidateInput = {
      ...VALID_INPUT,
      timestampEscaneo: "2026-05-18T09:30:00.000Z", // 90 min después → fuera de ventana
    };

    await expect(caller.validate(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { hardStopCode: "HORA_FUERA_DE_VENTANA" },
    });
  });

  // 15 — Todos correctos
  it("Todos los 5 correctos pasan → { ok: true }", async () => {
    setupHappyPath(prisma);
    const result = await caller.validate(VALID_INPUT);
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Tests: getHardStopSummary query
// ---------------------------------------------------------------------------

describe("bedsideHardStopsRouter.getHardStopSummary", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let caller: ReturnType<typeof bedsideHardStopsRouter.createCaller>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
    caller = bedsideHardStopsRouter.createCaller(
      makeCtx({ prisma, user: MOCK_USER_ADMIN, tenant: MOCK_TENANT }),
    );
  });

  it("retorna conteos agrupados por código de hard stop", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([
      { hard_stop_code: "MEDICAMENTO_INCORRECTO", total: "5" },
      { hard_stop_code: "MEDICAMENTO_VENCIDO",    total: "2" },
    ]);

    const result = await caller.getHardStopSummary({
      fechaInicio: "2026-05-18T00:00:00.000Z",
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ hardStopCode: "MEDICAMENTO_INCORRECTO", total: 5 });
    expect(result[1]).toEqual({ hardStopCode: "MEDICAMENTO_VENCIDO", total: 2 });
  });

  it("retorna array vacío si no hay hard stops en el período", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([]);
    const result = await caller.getHardStopSummary({
      fechaInicio: "2026-05-18T00:00:00.000Z",
      fechaFin: "2026-05-18T23:59:59.000Z",
    });
    expect(result).toEqual([]);
  });
});
