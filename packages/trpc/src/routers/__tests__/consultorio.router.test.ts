/**
 * Tests del consultorioRouter — CC-0036 Ola 1B (REQ-HIS-AFIL-001
 * US.AFIL.1.1). Mismo patrón que room.router.test.ts, pero con
 * `requirePermission` (RolePermission) en vez de `requireRole`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@his/database";
import { consultorioRouter } from "../consultorio.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const CONSULTORIO_ID = "00000000-0000-0000-0000-000000000060";

/** Otorga `permissionCode` al rol ADMIN (el rol por defecto de MOCK_TENANT). */
function grantAdmin(prisma: DeepMockProxy<PrismaClient>, permissionCode: string): void {
  prisma.role.findMany.mockResolvedValue([
    { id: "r1", code: "ADMIN", inheritsFromRoleId: null },
  ] as never);
  prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
  prisma.rolePermission.findMany.mockResolvedValue([
    { effect: "ALLOW", permission: { code: permissionCode } },
  ] as never);
}

describe("consultorioRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  describe("list", () => {
    it("filtra por organizationId del tenant", async () => {
      grantAdmin(prisma, "consultorio.leer");
      prisma.consultorio.findMany.mockResolvedValue([] as never);

      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      await caller.list();

      expect(prisma.consultorio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: MOCK_TENANT.organizationId }),
        }),
      );
    });

    it("deniega sin el permiso consultorio.leer (fail-safe sin seed)", async () => {
      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("create", () => {
    it("crea el consultorio en la org del tenant", async () => {
      grantAdmin(prisma, "consultorio.crear");
      prisma.consultorio.create.mockResolvedValue({ id: CONSULTORIO_ID, codigo: "CE-201" } as never);

      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({
        establishmentId: MOCK_TENANT.establishmentId!,
        codigo: "CE-201",
        nombre: "Consultorio 201",
        tipoUso: "PROPIO",
      });

      expect(result).toEqual({ id: CONSULTORIO_ID, codigo: "CE-201" });
      expect(prisma.consultorio.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            codigo: "CE-201",
            tipoUso: "PROPIO",
          }),
        }),
      );
    });

    it("traduce el código duplicado (P2002) a CONFLICT con mensaje es-SV", async () => {
      grantAdmin(prisma, "consultorio.crear");
      prisma.consultorio.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "5.22.0",
        }) as never,
      );

      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          codigo: "CE-201",
          nombre: "Consultorio 201",
          tipoUso: "PROPIO",
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("Ya existe un consultorio con el código CE-201"),
      });
    });

    it("deniega sin el permiso consultorio.crear", async () => {
      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          codigo: "CE-201",
          nombre: "Consultorio 201",
          tipoUso: "PROPIO",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("update", () => {
    it("exige que el consultorio sea del tenant", async () => {
      grantAdmin(prisma, "consultorio.editar");
      prisma.consultorio.findFirst.mockResolvedValue(null as never);

      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.update({ id: CONSULTORIO_ID, nombre: "X" })).rejects.toThrow(
        "Consultorio no encontrado",
      );
    });

    it("actualiza solo los campos enviados", async () => {
      grantAdmin(prisma, "consultorio.editar");
      prisma.consultorio.findFirst.mockResolvedValue({ id: CONSULTORIO_ID } as never);
      prisma.consultorio.update.mockResolvedValue({ id: CONSULTORIO_ID, nombre: "Nuevo" } as never);

      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      await caller.update({ id: CONSULTORIO_ID, nombre: "Nuevo" });

      const data = prisma.consultorio.update.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data).toMatchObject({ nombre: "Nuevo" });
      expect(data).not.toHaveProperty("piso");
      expect(data).not.toHaveProperty("tipoUso");
    });
  });

  describe("setActive", () => {
    it("exige que el consultorio sea del tenant", async () => {
      grantAdmin(prisma, "consultorio.desactivar");
      prisma.consultorio.findFirst.mockResolvedValue(null as never);

      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.setActive({ id: CONSULTORIO_ID, active: false })).rejects.toThrow(
        "Consultorio no encontrado",
      );
    });

    it("es idempotente si el estado ya coincide", async () => {
      grantAdmin(prisma, "consultorio.desactivar");
      prisma.consultorio.findFirst.mockResolvedValue({ id: CONSULTORIO_ID, active: true } as never);

      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setActive({ id: CONSULTORIO_ID, active: true });

      expect(result).toEqual({ id: CONSULTORIO_ID, active: true });
      expect(prisma.consultorio.update).not.toHaveBeenCalled();
    });

    it("deniega sin el permiso consultorio.desactivar", async () => {
      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setActive({ id: CONSULTORIO_ID, active: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("CC-0036 Ola 2: bloquea la desactivación si hay un ContratoArrendamiento VIGENTE, con el folio", async () => {
      grantAdmin(prisma, "consultorio.desactivar");
      prisma.consultorio.findFirst.mockResolvedValue({ id: CONSULTORIO_ID, active: true } as never);
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({ folio: "ARR-000123" } as never);

      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setActive({ id: CONSULTORIO_ID, active: false }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("ARR-000123"),
      });
      expect(prisma.consultorio.update).not.toHaveBeenCalled();
    });

    it("CC-0036 Ola 2: permite desactivar cuando no hay contrato VIGENTE/EN_MORA bloqueante", async () => {
      grantAdmin(prisma, "consultorio.desactivar");
      prisma.consultorio.findFirst.mockResolvedValue({ id: CONSULTORIO_ID, active: true } as never);
      prisma.contratoArrendamiento.findFirst.mockResolvedValue(null as never);
      prisma.consultorio.update.mockResolvedValue({ id: CONSULTORIO_ID, active: false } as never);

      const caller = consultorioRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setActive({ id: CONSULTORIO_ID, active: false });

      expect(result).toMatchObject({ active: false });
    });
  });
});
