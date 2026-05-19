/**
 * Tests del eceObstetriciaRouter (NTEC Art. 25 — Dashboard Maternidad).
 *
 * Cubre los 4 procedures de solo lectura:
 *   kpis:    retorna conteos (partos_hoy, partos_pendientes, cesareas_hoy, fallecidos)
 *   salas:   lista de salas con estado derivado de episodios activos
 *   alertas: eventos de dominio activos de las últimas 24 h
 *   cola:    episodios obstétricos en labor activa sin nacimiento registrado
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceObstetriciaRouter } from "../obstetricia.router";
import { makeCtx } from "../../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Mocks globales
// ---------------------------------------------------------------------------

vi.mock("../../../workflow/context", () => ({
  withWorkflowContext: vi.fn(
    async (
      _prisma: unknown,
      _ctx: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => fn(_prisma),
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EPISODIO_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SALA_ID     = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ALERTA_ID   = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makeKpisRow(overrides: Partial<{
  partos_hoy: bigint;
  partos_pendientes: bigint;
  cesareas_hoy: bigint;
  fallecidos_maternos_hoy: bigint;
}> = {}) {
  return {
    partos_hoy: overrides.partos_hoy ?? BigInt(5),
    partos_pendientes: overrides.partos_pendientes ?? BigInt(3),
    cesareas_hoy: overrides.cesareas_hoy ?? BigInt(1),
    fallecidos_maternos_hoy: overrides.fallecidos_maternos_hoy ?? BigInt(0),
  };
}

function makeSalaRow(overrides: Partial<{
  id: string;
  codigo: string;
  tipo: string;
  estado: string;
  paciente_nombre: string | null;
  minutos_en_sala: number | null;
  dilatacion_cm: number | null;
}> = {}) {
  const defaults = {
    id: SALA_ID,
    codigo: "EX-01",
    tipo: "expulsion",
    estado: "ocupada",
    paciente_nombre: "García, M." as string | null,
    minutos_en_sala: 45 as number | null,
    dilatacion_cm: 8 as number | null,
  };
  return { ...defaults, ...overrides };
}

function makeAlertaRow(overrides: Partial<{
  id: string;
  tipo: string;
  paciente_nombre: string;
  sala_codigo: string;
  minutos_transcurridos: number;
  mensaje: string;
}> = {}) {
  return {
    id: overrides.id ?? ALERTA_ID,
    tipo: overrides.tipo ?? "ece.partograma.alerta",
    paciente_nombre: overrides.paciente_nombre ?? "López, R.",
    sala_codigo: overrides.sala_codigo ?? "PP-02",
    minutos_transcurridos: overrides.minutos_transcurridos ?? 120,
    mensaje: overrides.mensaje ?? "Dilatación por debajo de curva de alerta",
  };
}

function makeEpisodioRow(overrides: Partial<{
  id: string;
  paciente_nombre: string;
  semanas_gestacion: number | null;
  hora_ingreso: string;
  motivo: string | null;
}> = {}) {
  const defaults = {
    id: EPISODIO_ID,
    paciente_nombre: "Flores, A.",
    semanas_gestacion: 39 as number | null,
    hora_ingreso: "14:30",
    motivo: "Trabajo de parto" as string | null,
  };
  return { ...defaults, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("eceObstetriciaRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  // ── kpis ──────────────────────────────────────────────────────────────────

  describe("kpis", () => {
    it("retorna KPIs con conteos reales del turno", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeKpisRow()]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.kpis();

      expect(result.partos_hoy).toBe(5);
      expect(result.partos_pendientes).toBe(3);
      expect(result.cesareas_hoy).toBe(1);
      expect(result.fallecidos_maternos_hoy).toBe(0);
    });

    it("devuelve ceros cuando no hay actividad", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        makeKpisRow({
          partos_hoy: BigInt(0),
          partos_pendientes: BigInt(0),
          cesareas_hoy: BigInt(0),
          fallecidos_maternos_hoy: BigInt(0),
        }),
      ]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.kpis();

      expect(result.partos_hoy).toBe(0);
      expect(result.partos_pendientes).toBe(0);
    });

    it("convierte bigint a number correctamente", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        makeKpisRow({ fallecidos_maternos_hoy: BigInt(2) }),
      ]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.kpis();

      expect(typeof result.fallecidos_maternos_hoy).toBe("number");
      expect(result.fallecidos_maternos_hoy).toBe(2);
    });
  });

  // ── salas ─────────────────────────────────────────────────────────────────

  describe("salas", () => {
    it("retorna lista de salas con estado ocupada", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeSalaRow()]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.salas();

      expect(result).toHaveLength(1);
      expect(result[0].codigo).toBe("EX-01");
      expect(result[0].estado).toBe("ocupada");
      expect(result[0].paciente_nombre).toBe("García, M.");
    });

    it("retorna lista vacía si no hay salas activas", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.salas();

      expect(result).toHaveLength(0);
    });

    it("maneja sala en limpieza (sin paciente)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        makeSalaRow({
          estado: "limpieza",
          paciente_nombre: null,
          minutos_en_sala: null,
          dilatacion_cm: null,
        }),
      ]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.salas();

      expect(result[0].estado).toBe("limpieza");
      expect(result[0].paciente_nombre).toBeNull();
    });
  });

  // ── alertas ───────────────────────────────────────────────────────────────

  describe("alertas", () => {
    it("retorna alertas activas de las últimas 24 h", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeAlertaRow()]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.alertas();

      expect(result).toHaveLength(1);
      expect(result[0].tipo).toBe("ece.partograma.alerta");
      expect(result[0].paciente_nombre).toBe("López, R.");
      expect(result[0].minutos_transcurridos).toBe(120);
    });

    it("retorna lista vacía si no hay alertas activas", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.alertas();

      expect(result).toHaveLength(0);
    });

    it("maneja múltiples tipos de alerta", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        makeAlertaRow({ tipo: "ece.partograma.alerta" }),
        makeAlertaRow({
          id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
          tipo: "ece.hpp.activo",
          paciente_nombre: "Martínez, K.",
        }),
      ]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.alertas();

      expect(result).toHaveLength(2);
      const tipos = result.map((a) => a.tipo);
      expect(tipos).toContain("ece.partograma.alerta");
      expect(tipos).toContain("ece.hpp.activo");
    });
  });

  // ── cola ──────────────────────────────────────────────────────────────────

  describe("cola", () => {
    it("retorna episodios en labor activa", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeEpisodioRow()]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.cola();

      expect(result).toHaveLength(1);
      expect(result[0].paciente_nombre).toBe("Flores, A.");
      expect(result[0].semanas_gestacion).toBe(39);
      expect(result[0].hora_ingreso).toBe("14:30");
    });

    it("retorna lista vacía si no hay labor activa", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.cola();

      expect(result).toHaveLength(0);
    });

    it("maneja semanas_gestacion null", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        makeEpisodioRow({ semanas_gestacion: null }),
      ]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.cola();

      expect(result[0].semanas_gestacion).toBeNull();
    });

    it("maneja motivo null", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        makeEpisodioRow({ motivo: null }),
      ]);

      const caller = eceObstetriciaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.cola();

      expect(result[0].motivo).toBeNull();
    });
  });
});
