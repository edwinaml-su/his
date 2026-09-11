/**
 * Tests del bed router — list, getMap, updateStatus.
 *
 * Nota sobre transiciones permitidas:
 *   El router actual NO impone máquina de estados (FREE→OCCUPIED→DIRTY,
 *   etc.). Esa regla aún no está implementada. Marcamos como SKIP el test
 *   correspondiente para dejar trazabilidad: cuando @Dev añada la lógica,
 *   se quita el `.skip` y se valida que rechaza transiciones ilegales.
 *   Backlog ref: US-BED-08.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@his/database";
import { bedRouter } from "../bed.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const BED_ID = "00000000-0000-0000-0000-000000000060";
const GLN_ACTIVO = "7410398000262";

describe("bedRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  describe("list", () => {
    it("filtra por organizationId + active=true", async () => {
      prisma.bed.findMany.mockResolvedValue([] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.list({});

      const args = prisma.bed.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        active: true,
      });
    });

    it("aplica filtro por status si se provee", async () => {
      prisma.bed.findMany.mockResolvedValue([] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ status: "FREE" });

      expect(prisma.bed.findMany.mock.calls[0]![0].where).toMatchObject({
        status: "FREE",
      });
    });
  });

  describe("getMap", () => {
    it("retorna servicios con al menos una cama", async () => {
      prisma.serviceUnit.findMany.mockResolvedValue([
        { id: "s1", code: "URG-A", beds: [{ id: "b1" }] },
        { id: "s2", code: "EMPTY", beds: [] },
      ] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.getMap();

      expect(out).toHaveLength(1);
      expect((out[0] as { id: string }).id).toBe("s1");
    });
  });

  describe("updateStatus", () => {
    it("actualiza el estado de la cama", async () => {
      // Nivel B (PR #324) — updateStatus ahora hace findFirst previo para
      // validar que la cama pertenece a un servicio del usuario. Para el
      // tenant default (ADMIN, cross-service) la validación pasa siempre.
      prisma.bed.findFirst.mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000010",
        serviceUnitId: "00000000-0000-0000-0000-0000000000ER",
      } as never);
      prisma.bed.update.mockResolvedValue({ id: "b1", status: "DIRTY" } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.updateStatus({
        bedId: "00000000-0000-0000-0000-000000000010",
        status: "DIRTY",
      });

      expect(prisma.bed.update.mock.calls[0]![0]).toMatchObject({
        where: { id: "00000000-0000-0000-0000-000000000010" },
        data: { status: "DIRTY" },
      });
    });

    it.skip("rechaza transición ilegal (US-BED-08, pendiente en @Dev)", async () => {
      // Intencional: la lógica de máquina de estados aún no existe.
      // Cuando se implemente: FREE → OCCUPIED debe requerir BedAssignment;
      // OCCUPIED → FREE debe pasar por DIRTY primero, etc.
      expect.fail("Habilitar cuando @Dev implemente bedStateMachine.");
    });
  });

  // Parametrización admin (2026-09-11) — espejo Odoo ACS HMS (roomId/bedType/
  // billingClass/glnCodigo), sql/231_room_bed_odoo_mirror.sql.
  describe("adminList", () => {
    it("filtra por organizationId del tenant e incluye habitación/servicio/establecimiento", async () => {
      prisma.bed.findMany.mockResolvedValue([] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.adminList({});

      expect(prisma.bed.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: MOCK_TENANT.organizationId },
          include: expect.objectContaining({
            establishment: expect.anything(),
            serviceUnit: expect.anything(),
            roomRef: expect.anything(),
          }),
        }),
      );
    });

    it("aplica el filtro roomId cuando se provee", async () => {
      prisma.bed.findMany.mockResolvedValue([] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.adminList({ roomId: "00000000-0000-0000-0000-000000000070" });

      expect(prisma.bed.findMany.mock.calls[0]![0].where).toMatchObject({
        roomId: "00000000-0000-0000-0000-000000000070",
      });
    });

    it("lanza FORBIDDEN si el rol no es ADMIN/DIR", async () => {
      const caller = bedRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] } }),
      );
      await expect(caller.adminList({})).rejects.toThrow(/Rol requerido/);
    });
  });

  describe("create", () => {
    it("crea la cama en la org del tenant", async () => {
      prisma.bed.create.mockResolvedValue({ id: BED_ID, code: "CAMA_1" } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({
        establishmentId: MOCK_TENANT.establishmentId!,
        serviceUnitId: "00000000-0000-0000-0000-000000000051",
        code: "CAMA_1",
      });

      expect(result).toEqual({ id: BED_ID, code: "CAMA_1" });
      expect(prisma.bed.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            code: "CAMA_1",
          }),
        }),
      );
    });

    it("traduce el código duplicado (P2002) a CONFLICT", async () => {
      prisma.bed.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "5.22.0",
        }) as never,
      );

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          serviceUnitId: "00000000-0000-0000-0000-000000000051",
          code: "CAMA_1",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza FORBIDDEN si el rol no es ADMIN/DIR", async () => {
      const caller = bedRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] } }),
      );
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          serviceUnitId: "00000000-0000-0000-0000-000000000051",
          code: "CAMA_1",
        }),
      ).rejects.toThrow(/Rol requerido/);
    });

    it("valida el GLN contra ece.gs1_gln antes de crear", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([{ tipo: "cama", activo: true }]);
      prisma.bed.create.mockResolvedValue({ id: BED_ID, code: "CAMA_1" } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.create({
        establishmentId: MOCK_TENANT.establishmentId!,
        serviceUnitId: "00000000-0000-0000-0000-000000000051",
        code: "CAMA_1",
        glnCodigo: GLN_ACTIVO,
      });

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("ece.gs1_gln"),
        GLN_ACTIVO,
      );
    });

    it("rechaza un GLN inactivo", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([{ tipo: "cama", activo: false }]);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          serviceUnitId: "00000000-0000-0000-0000-000000000051",
          code: "CAMA_1",
          glnCodigo: GLN_ACTIVO,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.bed.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("exige que la cama sea del tenant", async () => {
      prisma.bed.findFirst.mockResolvedValue(null as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.update({ id: BED_ID, isolation: "contacto" })).rejects.toThrow(
        "Cama no encontrada",
      );
    });

    it("actualiza solo los campos enviados", async () => {
      prisma.bed.findFirst.mockResolvedValue({ id: BED_ID } as never);
      prisma.bed.update.mockResolvedValue({ id: BED_ID, isolation: "contacto" } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.update({ id: BED_ID, isolation: "contacto" });

      const data = prisma.bed.update.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data).toMatchObject({ isolation: "contacto" });
      expect(data).not.toHaveProperty("code");
      expect(data).not.toHaveProperty("roomId");
    });
  });

  describe("setActive", () => {
    it("exige que la cama sea del tenant", async () => {
      prisma.bed.findFirst.mockResolvedValue(null as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.setActive({ id: BED_ID, active: false })).rejects.toThrow(
        "Cama no encontrada",
      );
    });

    it("es idempotente si el estado ya coincide", async () => {
      prisma.bed.findFirst.mockResolvedValue({ id: BED_ID, active: true } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setActive({ id: BED_ID, active: true });

      expect(result).toEqual({ id: BED_ID, active: true });
      expect(prisma.bed.update).not.toHaveBeenCalled();
    });
  });
});
