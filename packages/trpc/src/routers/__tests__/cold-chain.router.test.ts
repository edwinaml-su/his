/**
 * Tests para coldChainRouter (F2-S15 placeholder).
 *
 * Cubre:
 *   1. registrarLectura — lectura dentro de rango (sin alerta, sin evento)
 *   2. registrarLectura — lectura fuera de rango WARNING (INSERT alerta + emit)
 *   3. registrarLectura — lectura fuera de rango CRITICAL (delta > 2°C)
 *   4. listAlertas — NOT_FOUND si equipo no es del tenant
 *   5. listAlertas — devuelve alertas pendientes
 *   6. configurarRangoEquipo — upsert ok
 *   7. listLecturasHistorial — devuelve rows del equipo correcto
 *   8. registrarLectura — sin config de rangos: dentro_rango=true por defecto
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { coldChainRouter } from "../cold-chain.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// emitDomainEvent se importa en el router desde @his/database.
// El alias vitest.config lo resuelve al stub, que re-exporta el fuente real.
// Para evitar el path relativo roto en el stub, mockeamos en este test.
vi.mock("@his/database", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@his/database")>();
  return {
    ...mod,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-mocked" }),
  };
});

// Importamos el módulo mockeado para poder inspeccionar las llamadas
import * as dbModule from "@his/database";

// UUIDs fijos para evitar aleatoriedad en assertions
const EQUIP_ID = "aaaa0000-0000-0000-0000-000000000001";
const ORG_ID   = "00000000-0000-0000-0000-0000000000aa";
const LECTURA_ID = "bbbb0000-0000-0000-0000-000000000002";

// Config de rangos de temperatura para tests
const RANGE_CONFIG = {
  temp_min_c: 2,
  temp_max_c: 8,
  humedad_min_pct: null,
  humedad_max_pct: null,
};

// Helper: crea mock con equipo existente (tenant ok)
function makeEquipoMock(prisma: DeepMockProxy<PrismaClient>) {
  prisma.$queryRaw.mockResolvedValueOnce([{ id: EQUIP_ID }] as never); // equipo check
}

describe("coldChainRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // -------------------------------------------------------------------------
  // 1. registrarLectura — dentro de rango
  // -------------------------------------------------------------------------

  describe("registrarLectura — dentro de rango", () => {
    it("no genera alerta ni emite evento cuando temperatura ok", async () => {
      // equipo check
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: EQUIP_ID }] as never)           // 1. equipo
        .mockResolvedValueOnce([RANGE_CONFIG] as never);               // 2. config

      // La transacción devuelve la lectura insertada
      const txMock = {
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ id: LECTURA_ID }] as never),      // INSERT lectura
      };
      prisma.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) =>
        fn(txMock)
      );

      const caller = coldChainRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.registrarLectura({
        equipmentId: EQUIP_ID,
        temperaturaC: 4.5,        // dentro [2, 8]
        fuente: "manual",
      });

      expect(result.dentroRango).toBe(true);
      expect(result.severidad).toBeNull();
      // Solo 1 $queryRaw en la tx (INSERT lectura, SIN INSERT alerta)
      expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. registrarLectura — fuera de rango (WARNING)
  // -------------------------------------------------------------------------

  describe("registrarLectura — fuera de rango", () => {
    it("genera alerta WARNING y emite evento cuando temperatura levemente fuera", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: EQUIP_ID }] as never)
        .mockResolvedValueOnce([RANGE_CONFIG] as never);

      // Reset del mock entre tests
      vi.mocked(dbModule.emitDomainEvent).mockClear();

      const txMock = {
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ id: LECTURA_ID }] as never)  // INSERT lectura
          .mockResolvedValueOnce([{}] as never),                  // INSERT alerta
      };
      prisma.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) =>
        fn(txMock)
      );

      const caller = coldChainRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.registrarLectura({
        equipmentId: EQUIP_ID,
        temperaturaC: 9.5,        // fuera [2, 8], delta=min(7.5,1.5)=1.5 → WARNING
        fuente: "manual",
      });

      expect(result.dentroRango).toBe(false);
      expect(result.severidad).toBe("WARNING");
      // INSERT lectura + INSERT alerta
      expect(txMock.$queryRaw).toHaveBeenCalledTimes(2);
      // emitDomainEvent debe haberse llamado (mockeado a nivel módulo)
      expect(dbModule.emitDomainEvent).toHaveBeenCalledTimes(1);
      const emitArgs = vi.mocked(dbModule.emitDomainEvent).mock.calls[0]!;
      expect(emitArgs[1].eventType).toBe("cold_chain.excursion");
    });

    it("genera alerta CRITICAL cuando delta > 2°C", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: EQUIP_ID }] as never)
        .mockResolvedValueOnce([RANGE_CONFIG] as never);

      const txMock2 = {
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ id: LECTURA_ID }] as never)
          .mockResolvedValueOnce([{}] as never),
      };
      prisma.$transaction.mockImplementation(async (fn: (tx: typeof txMock2) => Promise<unknown>) =>
        fn(txMock2)
      );

      const caller = coldChainRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.registrarLectura({
        equipmentId: EQUIP_ID,
        temperaturaC: 12,         // delta=min(10,4)=4 > 2 → CRITICAL
        fuente: "iot_sensor",
      });

      expect(result.severidad).toBe("CRITICAL");
    });
  });

  // -------------------------------------------------------------------------
  // 3. listAlertas — NOT_FOUND si equipo no es del tenant
  // -------------------------------------------------------------------------

  describe("listAlertas", () => {
    it("lanza NOT_FOUND si el equipo no pertenece al tenant", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never); // sin equipo

      const caller = coldChainRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.listAlertas({ equipmentId: EQUIP_ID })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("devuelve alertas pendientes del equipo", async () => {
      const alerta = {
        id: "al-1",
        lectura_id: LECTURA_ID,
        severidad: "WARNING",
        mensaje: "Temperatura 9.5°C fuera de rango",
        creada_en: new Date(),
      };
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: EQUIP_ID }] as never)
        .mockResolvedValueOnce([alerta] as never);

      const caller = coldChainRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listAlertas({ equipmentId: EQUIP_ID });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ severidad: "WARNING" });
    });
  });

  // -------------------------------------------------------------------------
  // 4. configurarRangoEquipo — upsert ok
  // -------------------------------------------------------------------------

  describe("configurarRangoEquipo", () => {
    it("retorna ok:true si equipo existe en tenant", async () => {
      makeEquipoMock(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([] as never); // upsert

      const caller = coldChainRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.configurarRangoEquipo({
        equipmentId: EQUIP_ID,
        tempMinC: 2,
        tempMaxC: 8,
      });

      expect(result.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 5. listLecturasHistorial — devuelve rows
  // -------------------------------------------------------------------------

  describe("listLecturasHistorial", () => {
    it("devuelve lecturas de las últimas 24 h", async () => {
      const fila = {
        id: LECTURA_ID,
        temperatura_c: 5,
        humedad_pct: null,
        registrado_en: new Date(),
        dentro_rango: true,
        fuente: "manual",
      };
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: EQUIP_ID }] as never)
        .mockResolvedValueOnce([fila] as never);

      const caller = coldChainRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listLecturasHistorial({ equipmentId: EQUIP_ID });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ temperatura_c: 5, dentro_rango: true });
    });
  });

  // -------------------------------------------------------------------------
  // 6. registrarLectura — sin config (no evalúa rango)
  // -------------------------------------------------------------------------

  describe("registrarLectura — sin config de rangos", () => {
    it("marca dentro_rango=true cuando no hay config configurada", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: EQUIP_ID }] as never)
        .mockResolvedValueOnce([] as never);                          // config vacía

      const txMock = {
        $queryRaw: vi.fn().mockResolvedValueOnce([{ id: LECTURA_ID }] as never),
      };
      prisma.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) =>
        fn(txMock)
      );

      const caller = coldChainRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.registrarLectura({
        equipmentId: EQUIP_ID,
        temperaturaC: 25,
        fuente: "manual",
      });

      expect(result.dentroRango).toBe(true);
      expect(result.severidad).toBeNull();
    });
  });
});
