/**
 * docs/48 Ola 4 (C4-2) — Tests del conciliacionCargosRouter.
 *
 * Todas las queries son $queryRawUnsafe (mismo patrón que
 * finance-reports.router.test.ts) — se mockea `prisma.$queryRawUnsafe` y se
 * verifica que cada procedure llame con los parámetros de rango/org
 * correctos y devuelva las filas mockeadas tal cual.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { conciliacionCargosRouter } from "../conciliacion-cargos.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

describe("conciliacionCargosRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  function setupTx() {
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") {
        return (cb as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return cb;
    });
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx();
  });

  const RANGE = { fechaDesde: "2026-09-01", fechaHasta: "2026-09-30" };

  describe("indicacionesSinDispensa", () => {
    it("devuelve las filas del query y filtra por organizationId + rango", async () => {
      const rows = [
        {
          prescriptionId: "rx-1",
          prescriptionItemId: "item-1",
          patientId: "pat-1",
          prescribedAt: new Date("2026-09-05"),
          genericName: "Amoxicilina",
        },
      ];
      prisma.$queryRawUnsafe.mockResolvedValue(rows as never);

      const caller = conciliacionCargosRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.indicacionesSinDispensa(RANGE);

      expect(result).toEqual(rows);
      const [sql, org, desde, hasta] = prisma.$queryRawUnsafe.mock.calls[0]!;
      expect(String(sql)).toContain("PharmacyReservation");
      expect(String(sql)).toContain("signedAt");
      expect(org).toBe(MOCK_TENANT.organizationId);
      expect(desde).toBe("2026-09-01T00:00:00");
      expect(hasta).toBe("2026-09-30T23:59:59");
    });
  });

  describe("dispensadoSinCargo", () => {
    it("devuelve StockMovement OUT sin cargo asociado", async () => {
      const rows = [
        {
          stockMovementId: "mov-1",
          referenceCode: "res-1",
          performedAt: new Date(),
          sku: "SKU-1",
          quantity: "1",
        },
      ];
      prisma.$queryRawUnsafe.mockResolvedValue(rows as never);

      const caller = conciliacionCargosRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.dispensadoSinCargo(RANGE);

      expect(result).toEqual(rows);
      const sql = String(prisma.$queryRawUnsafe.mock.calls[0]![0]);
      expect(sql).toContain("StockMovement");
      expect(sql).toContain("dispensaci");
    });
  });

  describe("cargosSinMovimiento", () => {
    it("devuelve cargos DISPENSACION_FARMACIA sin StockMovement asociado", async () => {
      const rows = [
        {
          cargoId: "cargo-1",
          accountId: "acc-1",
          code: "SKU-1",
          totalPrice: "10.00",
          createdAt: new Date(),
          referenciaId: "res-1",
        },
      ];
      prisma.$queryRawUnsafe.mockResolvedValue(rows as never);

      const caller = conciliacionCargosRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.cargosSinMovimiento(RANGE);

      expect(result).toEqual(rows);
      const sql = String(prisma.$queryRawUnsafe.mock.calls[0]![0]);
      expect(sql).toContain("DISPENSACION_FARMACIA");
      expect(sql).toContain("VIGENTE");
    });
  });

  describe("cargosSinTarifa", () => {
    it("devuelve cargos PENDIENTE_TARIFA con antigüedad", async () => {
      const rows = [
        {
          cargoId: "cargo-1",
          accountId: "acc-1",
          code: "SKU-1",
          descripcion: "Dispensación GS1",
          quantity: "1",
          createdAt: new Date(),
          antiguedadDias: 5,
        },
      ];
      prisma.$queryRawUnsafe.mockResolvedValue(rows as never);

      const caller = conciliacionCargosRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.cargosSinTarifa(RANGE);

      expect(result).toEqual(rows);
      const sql = String(prisma.$queryRawUnsafe.mock.calls[0]![0]);
      expect(sql).toContain("PENDIENTE_TARIFA");
      expect(sql).toContain("antiguedadDias");
    });
  });

  describe("devolucionesSinReversion", () => {
    it("devuelve cargos VIGENTE con reserva CANCELLED (global, todas las cuentas)", async () => {
      const rows = [
        {
          cargoId: "cargo-1",
          accountId: "acc-1",
          reservationId: "res-1",
          cancelMotivo: "Devolución",
          totalPrice: "10.00",
          createdAt: new Date(),
        },
      ];
      prisma.$queryRawUnsafe.mockResolvedValue(rows as never);

      const caller = conciliacionCargosRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.devolucionesSinReversion(RANGE);

      expect(result).toEqual(rows);
      const sql = String(prisma.$queryRawUnsafe.mock.calls[0]![0]);
      expect(sql).toContain("CANCELLED");
      expect(sql).toContain("VIGENTE");
    });
  });

  describe("resumen", () => {
    it("devuelve los 5 conteos convertidos a number", async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        {
          indicaciones_sin_dispensa: "3",
          dispensado_sin_cargo: "1",
          cargos_sin_movimiento: "0",
          cargos_sin_tarifa: "7",
          devoluciones_sin_reversion: "2",
        },
      ] as never);

      const caller = conciliacionCargosRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.resumen(RANGE);

      expect(result).toEqual({
        indicacionesSinDispensa: 3,
        dispensadoSinCargo: 1,
        cargosSinMovimiento: 0,
        cargosSinTarifa: 7,
        devolucionesSinReversion: 2,
      });
    });
  });
});
