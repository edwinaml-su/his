/**
 * Tests del roomRouter — modelo de habitaciones espejo Odoo ACS HMS
 * (sql/231_room_bed_odoo_mirror.sql, encargo Edwin 2026-09-11).
 * Mismo patrón que establishment.router.test.ts: RBAC (ADMIN/DIR),
 * tenant-scoping, conflicto de código único y validación de GLN.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@his/database";
import { roomRouter } from "../room.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const ROOM_ID = "00000000-0000-0000-0000-000000000050";
const SERVICE_UNIT_ID = "00000000-0000-0000-0000-000000000051";
const GLN_ACTIVO = "7410398000262";

describe("roomRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  describe("list", () => {
    it("filtra por organizationId del tenant", async () => {
      prisma.room.findMany.mockResolvedValue([] as never);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      await caller.list();

      expect(prisma.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: MOCK_TENANT.organizationId },
        }),
      );
    });

    it("con activeOnly agrega el filtro active: true", async () => {
      prisma.room.findMany.mockResolvedValue([] as never);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ activeOnly: true });

      expect(prisma.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });

    it("lanza FORBIDDEN si el rol no es ADMIN/DIR", async () => {
      const caller = roomRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] } }),
      );
      await expect(caller.list()).rejects.toThrow(/Rol requerido/);
    });
  });

  describe("listServiceUnits", () => {
    it("filtra por organizationId + establishmentId + active=true", async () => {
      prisma.serviceUnit.findMany.mockResolvedValue([] as never);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      await caller.listServiceUnits({ establishmentId: MOCK_TENANT.establishmentId! });

      expect(prisma.serviceUnit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: MOCK_TENANT.organizationId,
            establishmentId: MOCK_TENANT.establishmentId,
            active: true,
          },
        }),
      );
    });
  });

  describe("create", () => {
    it("crea la habitación en la org del tenant", async () => {
      prisma.room.create.mockResolvedValue({ id: ROOM_ID, code: "SYDNEY" } as never);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({
        establishmentId: MOCK_TENANT.establishmentId!,
        serviceUnitId: SERVICE_UNIT_ID,
        code: "SYDNEY",
        name: "Sydney",
      });

      expect(result).toEqual({ id: ROOM_ID, code: "SYDNEY" });
      expect(prisma.room.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            code: "SYDNEY",
            name: "Sydney",
          }),
        }),
      );
    });

    it("traduce el código duplicado (P2002) a CONFLICT", async () => {
      prisma.room.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "5.22.0",
        }) as never,
      );

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          serviceUnitId: SERVICE_UNIT_ID,
          code: "SYDNEY",
          name: "Sydney",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza FORBIDDEN si el rol no es ADMIN/DIR", async () => {
      const caller = roomRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] } }),
      );
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          serviceUnitId: SERVICE_UNIT_ID,
          code: "SYDNEY",
          name: "Sydney",
        }),
      ).rejects.toThrow(/Rol requerido/);
    });

    it("valida el GLN contra ece.gs1_gln antes de crear (existe, activo, tipo cama)", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([{ tipo: "cama", activo: true }]);
      prisma.room.create.mockResolvedValue({ id: ROOM_ID, code: "SYDNEY" } as never);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      await caller.create({
        establishmentId: MOCK_TENANT.establishmentId!,
        serviceUnitId: SERVICE_UNIT_ID,
        code: "SYDNEY",
        name: "Sydney",
        glnCodigo: GLN_ACTIVO,
      });

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("ece.gs1_gln"),
        GLN_ACTIVO,
      );
      expect(prisma.room.create).toHaveBeenCalled();
    });

    it("rechaza un GLN que no existe en el catálogo", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([]);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          serviceUnitId: SERVICE_UNIT_ID,
          code: "SYDNEY",
          name: "Sydney",
          glnCodigo: GLN_ACTIVO,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.room.create).not.toHaveBeenCalled();
    });

    it("rechaza un GLN cuyo tipo no es 'cama'", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([{ tipo: "servicio", activo: true }]);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          serviceUnitId: SERVICE_UNIT_ID,
          code: "SYDNEY",
          name: "Sydney",
          glnCodigo: GLN_ACTIVO,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.room.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("exige que la habitación sea del tenant", async () => {
      prisma.room.findFirst.mockResolvedValue(null as never);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.update({ id: ROOM_ID, name: "Nuevo nombre" })).rejects.toThrow(
        "Habitación no encontrada",
      );
    });

    it("actualiza solo los campos enviados", async () => {
      prisma.room.findFirst.mockResolvedValue({ id: ROOM_ID } as never);
      prisma.room.update.mockResolvedValue({ id: ROOM_ID, name: "Nuevo nombre" } as never);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      await caller.update({ id: ROOM_ID, name: "Nuevo nombre" });

      const data = prisma.room.update.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data).toMatchObject({ name: "Nuevo nombre" });
      expect(data).not.toHaveProperty("floor");
      expect(data).not.toHaveProperty("roomType");
    });
  });

  describe("setActive", () => {
    it("exige que la habitación sea del tenant", async () => {
      prisma.room.findFirst.mockResolvedValue(null as never);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.setActive({ id: ROOM_ID, active: false })).rejects.toThrow(
        "Habitación no encontrada",
      );
    });

    it("es idempotente si el estado ya coincide", async () => {
      prisma.room.findFirst.mockResolvedValue({ id: ROOM_ID, active: true } as never);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setActive({ id: ROOM_ID, active: true });

      expect(result).toEqual({ id: ROOM_ID, active: true });
      expect(prisma.room.update).not.toHaveBeenCalled();
    });

    it("desactiva cuando el estado difiere", async () => {
      prisma.room.findFirst.mockResolvedValue({ id: ROOM_ID, active: true } as never);
      prisma.room.update.mockResolvedValue({ id: ROOM_ID, active: false } as never);

      const caller = roomRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setActive({ id: ROOM_ID, active: false });

      expect(result).toEqual({ id: ROOM_ID, active: false });
    });
  });
});
