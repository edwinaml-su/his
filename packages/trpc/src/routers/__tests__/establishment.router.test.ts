/**
 * Tests del establishmentRouter — parametrización admin (2026-09-10).
 * Cubre RBAC (ADMIN/DIR), tenant-scoping y el conflicto de código único
 * (@@unique([organizationId, code])).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@his/database";
import { establishmentRouter } from "../establishment.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const EST_ID = "00000000-0000-0000-0000-000000000040";

describe("establishmentRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  describe("list", () => {
    it("filtra por organizationId del tenant", async () => {
      prisma.establishment.findMany.mockResolvedValue([] as never);

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      await caller.list();

      expect(prisma.establishment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: MOCK_TENANT.organizationId } }),
      );
    });

    it("con activeOnly agrega el filtro active: true", async () => {
      prisma.establishment.findMany.mockResolvedValue([] as never);

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ activeOnly: true });

      expect(prisma.establishment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: MOCK_TENANT.organizationId, active: true },
        }),
      );
    });

    it("enriquece cada fila con el GLN asociado (join ece.gs1_gln)", async () => {
      prisma.establishment.findMany.mockResolvedValue([
        { id: EST_ID, code: "HE" },
        { id: "00000000-0000-0000-0000-000000000041", code: "CM" },
      ] as never);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([
        { establishment_id: EST_ID, codigo: "7410398000026", descripcion: "Avante Hospital Especializado" },
      ]);

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list();

      expect(result).toEqual([
        { id: EST_ID, code: "HE", glnCodigo: "7410398000026", glnDescripcion: "Avante Hospital Especializado" },
        { id: "00000000-0000-0000-0000-000000000041", code: "CM", glnCodigo: null, glnDescripcion: null },
      ]);
    });

    it("no consulta GLN si la lista de establecimientos está vacía", async () => {
      prisma.establishment.findMany.mockResolvedValue([] as never);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).$queryRawUnsafe = vi.fn();

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      await caller.list();

      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("crea el establecimiento en la org del tenant", async () => {
      prisma.establishment.create.mockResolvedValue({ id: EST_ID, code: "US" } as never);

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({ code: "US", name: "Unidad Satelital" });

      expect(result).toEqual({ id: EST_ID, code: "US" });
      expect(prisma.establishment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            code: "US",
            name: "Unidad Satelital",
          }),
        }),
      );
    });

    it("traduce el código duplicado (P2002) a CONFLICT", async () => {
      prisma.establishment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "5.22.0",
        }) as never,
      );

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create({ code: "US", name: "Unidad Satelital" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("lanza FORBIDDEN si el rol no es ADMIN/DIR", async () => {
      const caller = establishmentRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] } }),
      );
      await expect(caller.create({ code: "US", name: "Unidad Satelital" })).rejects.toThrow(
        /Rol requerido/,
      );
    });
  });

  describe("update", () => {
    it("exige que el establecimiento sea del tenant", async () => {
      prisma.establishment.findFirst.mockResolvedValue(null as never);

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.update({ id: EST_ID, name: "Nuevo nombre" })).rejects.toThrow(
        "Establecimiento no encontrado",
      );
    });

    it("actualiza solo los campos enviados", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: EST_ID } as never);
      prisma.establishment.update.mockResolvedValue({ id: EST_ID, name: "Nuevo nombre" } as never);

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      await caller.update({ id: EST_ID, name: "Nuevo nombre" });

      expect(prisma.establishment.update).toHaveBeenCalledWith({
        where: { id: EST_ID },
        data: expect.objectContaining({ name: "Nuevo nombre" }),
      });
      const data = prisma.establishment.update.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data).not.toHaveProperty("code");
      expect(data).not.toHaveProperty("addressLine");
    });
  });

  describe("setActive", () => {
    it("exige que el establecimiento sea del tenant", async () => {
      prisma.establishment.findFirst.mockResolvedValue(null as never);

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.setActive({ id: EST_ID, active: false })).rejects.toThrow(
        "Establecimiento no encontrado",
      );
    });

    it("es idempotente si el estado ya coincide", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: EST_ID, active: true } as never);

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setActive({ id: EST_ID, active: true });

      expect(result).toEqual({ id: EST_ID, active: true });
      expect(prisma.establishment.update).not.toHaveBeenCalled();
    });

    it("desactiva cuando el estado difiere", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: EST_ID, active: true } as never);
      prisma.establishment.update.mockResolvedValue({ id: EST_ID, active: false } as never);

      const caller = establishmentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setActive({ id: EST_ID, active: false });

      expect(result).toEqual({ id: EST_ID, active: false });
      expect(prisma.establishment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: EST_ID }, data: expect.objectContaining({ active: false }) }),
      );
    });
  });
});
