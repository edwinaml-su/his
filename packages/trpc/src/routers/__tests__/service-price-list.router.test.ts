/**
 * Tests del servicePriceListRouter (sql/133). Cubre CRUD básico y, en
 * particular para CC-0015: el filtro opcional `priceListId` de
 * `listActiveItems` y el nuevo procedure `resolverPorCuenta`.
 *
 * Todas las queries son $queryRawUnsafe/$executeRawUnsafe (tabla fuera de
 * Prisma) — se mockean directamente sobre el prisma mockDeep.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { servicePriceListRouter } from "../service-price-list.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const PRICE_LIST_ID = "00000000-0000-0000-0000-000000000030";
const CUENTA_ID = "00000000-0000-0000-0000-000000000031";
const TIPO_CUENTA_ID = "00000000-0000-0000-0000-000000000032";

describe("servicePriceListRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  function setupTx() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void }).mockImplementation(
      async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma),
    );
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("listActiveItems", () => {
    it("sin filtro: consulta todos los items activos de listas activas del tenant", async () => {
      setupTx();
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      await caller.listActiveItems();

      const [, ...params] = prisma.$queryRawUnsafe.mock.calls[0]!;
      expect(params).toEqual([MOCK_TENANT.organizationId]);
    });

    it("con priceListId: agrega el filtro AND pl.id = $2 a la query", async () => {
      setupTx();
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      await caller.listActiveItems({ priceListId: PRICE_LIST_ID });

      const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0]!;
      expect(String(sql)).toContain("AND pl.id = $2");
      expect(params).toEqual([MOCK_TENANT.organizationId, PRICE_LIST_ID]);
    });
  });

  describe("resolverPorCuenta", () => {
    it("resuelve cada code vía el price-resolver y devuelve {code, precio, fuente}", async () => {
      setupTx();
      // patientAccount.findFirst (resolverPriceListIdDeCuenta) → sin tipoCuentaId
      prisma.patientAccount.findFirst.mockResolvedValue({ tipoCuentaId: null } as never);
      // labTest.findFirst (tenant, luego global)
      prisma.labTest.findFirst
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce({ standardPrice: 12.34 } as never);

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.resolverPorCuenta({ cuentaId: CUENTA_ID, codes: ["GLU"] });

      expect(result).toEqual([{ code: "GLU", precio: 12.34, fuente: "estandar" }]);
    });

    it("resuelve por la lista cuando la cuenta tiene tipoCuenta con priceListId", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue({ tipoCuentaId: TIPO_CUENTA_ID } as never);
      prisma.tipoCuenta.findFirst.mockResolvedValue({ priceListId: PRICE_LIST_ID } as never);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ unitPrice: "7.00" }]);

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.resolverPorCuenta({ cuentaId: CUENTA_ID, codes: ["GLU"] });

      expect(result).toEqual([{ code: "GLU", precio: 7, fuente: "lista" }]);
    });
  });
});
