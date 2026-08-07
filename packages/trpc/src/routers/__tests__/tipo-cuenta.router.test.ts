/**
 * CC-0015 — Tests del tipoCuentaRouter.
 * Mock: PrismaClient (vitest-mock-extended) + patrón setupTx (withTenantContext
 * ejecuta el callback con el propio prisma mock).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { tipoCuentaRouter } from "../tipo-cuenta.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN } from "@his/test-utils";

const TIPO_ID = "00000000-0000-0000-0000-000000000010";
const PRICE_LIST_ID = "00000000-0000-0000-0000-000000000020";

describe("tipoCuentaRouter", () => {
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

  describe("list", () => {
    it("lista tipos de cuenta del tenant con el nombre de lista resuelto vía raw query", async () => {
      setupTx();
      prisma.tipoCuenta.findMany.mockResolvedValue([
        { id: TIPO_ID, code: "ISBM", nombre: "ISBM", priceListId: PRICE_LIST_ID, esParticular: false, active: true },
      ] as never);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        { id: PRICE_LIST_ID, name: "ODOO — PRECIOS ISBM" },
      ] as never);

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list();

      expect(result).toEqual([
        expect.objectContaining({ code: "ISBM", priceListName: "ODOO — PRECIOS ISBM" }),
      ]);
      const whereArg = prisma.tipoCuenta.findMany.mock.calls[0]![0]!.where;
      expect(whereArg).toMatchObject({ organizationId: MOCK_TENANT.organizationId });
    });

    it("filtra por activeOnly cuando se pide", async () => {
      setupTx();
      prisma.tipoCuenta.findMany.mockResolvedValue([] as never);

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ activeOnly: true });

      const whereArg = prisma.tipoCuenta.findMany.mock.calls[0]![0]!.where;
      expect(whereArg).toMatchObject({ active: true });
    });

    it("priceListName es null cuando el tipo no tiene priceListId", async () => {
      setupTx();
      prisma.tipoCuenta.findMany.mockResolvedValue([
        { id: TIPO_ID, code: "PARTICULAR", nombre: "Particular", priceListId: null, esParticular: true, active: true },
      ] as never);

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list();

      expect(result[0]).toMatchObject({ priceListName: null });
      // No debería consultar ServicePriceList si no hay ids.
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("crea un tipo de cuenta sin priceListId", async () => {
      setupTx();
      prisma.tipoCuenta.findFirst.mockResolvedValue(null);
      prisma.tipoCuenta.create.mockResolvedValue({ id: TIPO_ID, code: "MAPFRE" } as never);

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({ code: "MAPFRE", nombre: "Mapfre Seguros", esParticular: false });

      expect(result).toMatchObject({ id: TIPO_ID });
      const createArgs = prisma.tipoCuenta.create.mock.calls[0]![0];
      expect(createArgs.data).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        code: "MAPFRE",
        priceListId: null,
        createdBy: MOCK_USER_ADMIN.id,
      });
    });

    it("valida que priceListId pertenezca al tenant antes de crear", async () => {
      setupTx();
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]); // ServicePriceList no encontrada

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({ code: "X", nombre: "X", priceListId: PRICE_LIST_ID, esParticular: false }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(prisma.tipoCuenta.create).not.toHaveBeenCalled();
    });

    it("rechaza code duplicado en el tenant", async () => {
      setupTx();
      prisma.tipoCuenta.findFirst.mockResolvedValue({ id: "other" } as never);

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({ code: "ISBM", nombre: "ISBM", esParticular: false }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(prisma.tipoCuenta.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("edita nombre y priceListId de un tipo existente", async () => {
      setupTx();
      prisma.tipoCuenta.findFirst.mockResolvedValue({ id: TIPO_ID } as never);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: PRICE_LIST_ID }]); // pertenece al tenant
      prisma.tipoCuenta.update.mockResolvedValue({ id: TIPO_ID, nombre: "ISBM Actualizado" } as never);

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.update({ id: TIPO_ID, nombre: "ISBM Actualizado", priceListId: PRICE_LIST_ID });

      expect(result).toMatchObject({ nombre: "ISBM Actualizado" });
      const updateArgs = prisma.tipoCuenta.update.mock.calls[0]![0];
      expect(updateArgs.data).toMatchObject({ nombre: "ISBM Actualizado", priceListId: PRICE_LIST_ID });
    });

    it("lanza NOT_FOUND si el tipo no pertenece al tenant", async () => {
      setupTx();
      prisma.tipoCuenta.findFirst.mockResolvedValue(null);

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.update({ id: TIPO_ID, nombre: "X" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("deactivate / reactivate", () => {
    it("desactiva un tipo de cuenta del tenant", async () => {
      setupTx();
      prisma.tipoCuenta.findFirst.mockResolvedValue({ id: TIPO_ID } as never);
      prisma.tipoCuenta.update.mockResolvedValue({ id: TIPO_ID, active: false } as never);

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.deactivate({ id: TIPO_ID });

      expect(result).toMatchObject({ active: false });
      const updateArgs = prisma.tipoCuenta.update.mock.calls[0]![0];
      expect(updateArgs.data).toMatchObject({ active: false });
    });

    it("reactiva un tipo de cuenta del tenant", async () => {
      setupTx();
      prisma.tipoCuenta.findFirst.mockResolvedValue({ id: TIPO_ID } as never);
      prisma.tipoCuenta.update.mockResolvedValue({ id: TIPO_ID, active: true } as never);

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.reactivate({ id: TIPO_ID });

      expect(result).toMatchObject({ active: true });
    });

    it("deactivate lanza NOT_FOUND si no pertenece al tenant", async () => {
      setupTx();
      prisma.tipoCuenta.findFirst.mockResolvedValue(null);

      const caller = tipoCuentaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.deactivate({ id: TIPO_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
