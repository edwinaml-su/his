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

      expect(result).toEqual([{ code: "GLU", precio: 12.34, fuente: "estandar", reglaId: null }]);
    });

    it("resuelve por la lista cuando la cuenta tiene tipoCuenta con priceListId", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue({ tipoCuentaId: TIPO_CUENTA_ID } as never);
      prisma.tipoCuenta.findFirst.mockResolvedValue({ priceListId: PRICE_LIST_ID } as never);
      // CC-0021: el motor consulta en paralelo el ítem plano y las reglas candidatas.
      prisma.$queryRawUnsafe.mockImplementation((async (sql: string) =>
        String(sql).includes('"ServicePriceRule"') ? [] : [{ unitPrice: "7.00" }]) as never);

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.resolverPorCuenta({ cuentaId: CUENTA_ID, codes: ["GLU"] });

      expect(result).toEqual([{ code: "GLU", precio: 7, fuente: "lista", reglaId: null }]);
    });

    it("una regla de la lista gana al ítem plano del mismo código", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue({ tipoCuentaId: TIPO_CUENTA_ID } as never);
      prisma.tipoCuenta.findFirst.mockResolvedValue({ priceListId: PRICE_LIST_ID } as never);
      prisma.$queryRawUnsafe.mockImplementation((async (sql: string) =>
        String(sql).includes('"ServicePriceRule"')
          ? [
              {
                id: "regla-1",
                appliedOn: "item",
                computePrice: "fixed",
                fixedPrice: "5.00",
                percentPrice: "0",
                base: "list_price",
                basePriceListId: null,
                priceDiscount: "0",
                priceSurcharge: "0",
                priceRound: "0",
                priceMinMargin: "0",
                priceMaxMargin: "0",
              },
            ]
          : [{ unitPrice: "7.00" }]) as never);

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.resolverPorCuenta({ cuentaId: CUENTA_ID, codes: ["GLU"] });

      expect(result).toEqual([{ code: "GLU", precio: 5, fuente: "regla", reglaId: "regla-1" }]);
    });
  });

  // ---------------------------------------------------------------------------
  // CC-0021 — CRUD de reglas y categorías
  // ---------------------------------------------------------------------------

  describe("reglas de precio", () => {
    const REGLA_ID = "00000000-0000-0000-0000-000000000033";
    const CATEGORY_ID = "00000000-0000-0000-0000-000000000034";

    it("listRules exige que la lista sea del tenant", async () => {
      setupTx();
      prisma.$queryRawUnsafe.mockResolvedValue([] as never); // la guarda no encuentra la lista

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.listRules({ priceListId: PRICE_LIST_ID })).rejects.toThrow("Tarifario no encontrado");
    });

    it("listRules ordena por especificidad antes que por cantidad mínima", async () => {
      setupTx();
      prisma.$queryRawUnsafe.mockResolvedValue([{ id: PRICE_LIST_ID }] as never);

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      await caller.listRules({ priceListId: PRICE_LIST_ID });

      const [sql] = prisma.$queryRawUnsafe.mock.calls.at(-1)!;
      expect(String(sql)).toContain(`WHEN 'item' THEN 0 WHEN 'category' THEN 1 ELSE 2 END`);
      expect(String(sql)).toContain(`r."minQuantity" DESC`);
    });

    it("addRule inserta la regla tras validar lista y categoría del tenant", async () => {
      setupTx();
      prisma.$queryRawUnsafe.mockImplementation((async (sql: string) =>
        String(sql).startsWith("INSERT") ? [{ id: REGLA_ID }] : [{ id: "ok" }]) as never);

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.addRule({
        priceListId: PRICE_LIST_ID,
        appliedOn: "category",
        categoryId: CATEGORY_ID,
        computePrice: "formula",
        priceMinMargin: 0.7,
        priceMaxMargin: 0.7,
        minQuantity: 0,
        percentPrice: 0,
        base: "list_price",
        priceDiscount: 0,
        priceSurcharge: 0,
        priceRound: 0,
        sequence: 0,
      });

      expect(result).toEqual({ id: REGLA_ID });
      const insert = prisma.$queryRawUnsafe.mock.calls.find(([sql]) => String(sql).startsWith("INSERT"))!;
      expect(String(insert[0])).toContain('INSERT INTO "ServicePriceRule"');
      expect(insert).toContain("category");
    });

    it("addRule rechaza una regla de categoría sin categoría (validación de contrato)", async () => {
      setupTx();
      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.addRule({ priceListId: PRICE_LIST_ID, appliedOn: "category", computePrice: "fixed", fixedPrice: 1 }),
      ).rejects.toThrow(/categoría/i);
    });

    it("setRuleActive exige que la regla sea del tenant", async () => {
      setupTx();
      prisma.$queryRawUnsafe.mockResolvedValue([] as never);

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.setRuleActive({ id: REGLA_ID, active: false })).rejects.toThrow("Regla no encontrada");
    });

    it("simularPrecio evalúa la lista indicada sin pasar por una cuenta", async () => {
      setupTx();
      prisma.$queryRawUnsafe.mockImplementation((async (sql: string) => {
        if (String(sql).includes('"ServicePriceRule"')) return [];
        if (String(sql).includes('"ServicePriceListItem"')) return [{ unitPrice: "6.45", estimatedCost: null }];
        return [{ id: PRICE_LIST_ID }];
      }) as never);

      const caller = servicePriceListRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.simularPrecio({ priceListId: PRICE_LIST_ID, code: "VEROLAX", cantidad: 1 });

      expect(result).toMatchObject({ precio: 6.45, fuente: "lista", priceListId: PRICE_LIST_ID });
      expect(prisma.patientAccount.findFirst).not.toHaveBeenCalled();
    });
  });
});
