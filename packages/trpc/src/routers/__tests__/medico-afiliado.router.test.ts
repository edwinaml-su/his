/**
 * Tests del medicoAfiliadoRouter — CC-0036 Ola 1B (REQ-HIS-AFIL-001
 * US.AFIL.1.2). Cubre gates de permiso, duplicado de JVPM, emisión de
 * `afiliado.creado`, y las transiciones de estado (activar/darBaja).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@his/database";
import { medicoAfiliadoRouter } from "../medico-afiliado.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const AFILIADO_ID = "00000000-0000-0000-0000-000000000070";

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

describe("medicoAfiliadoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  describe("list", () => {
    it("filtra por organizationId del tenant", async () => {
      grantAdmin(prisma, "medico_afiliado.leer");
      prisma.medicoAfiliado.findMany.mockResolvedValue([] as never);

      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      await caller.list();

      expect(prisma.medicoAfiliado.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: MOCK_TENANT.organizationId }),
        }),
      );
    });

    it("deniega sin el permiso medico_afiliado.leer (fail-safe sin seed)", async () => {
      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("create", () => {
    it("crea el afiliado en PROSPECTO y emite afiliado.creado", async () => {
      grantAdmin(prisma, "medico_afiliado.crear");
      prisma.medicoAfiliado.findFirst.mockResolvedValue(null as never);
      prisma.medicoAfiliado.create.mockResolvedValue({
        id: AFILIADO_ID,
        organizationId: MOCK_TENANT.organizationId,
        nombreCompleto: "Dr. Juan Pérez",
        jvpmNumero: "12345",
        tipoRelacion: "AFILIADO_ARRENDATARIO",
        estado: "PROSPECTO",
      } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: "event-1" } as never);

      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({
        nombreCompleto: "Dr. Juan Pérez",
        jvpmNumero: "12345",
        tipoRelacion: "AFILIADO_ARRENDATARIO",
      });

      expect(result).toMatchObject({ id: AFILIADO_ID, estado: "PROSPECTO" });
      expect(prisma.medicoAfiliado.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            jvpmNumero: "12345",
            estado: "PROSPECTO",
          }),
        }),
      );
      expect(prisma.domainEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "afiliado.creado",
            aggregateId: AFILIADO_ID,
          }),
        }),
      );
    });

    it("rechaza JVPM duplicado con CONFLICT y ofrece el registro existente", async () => {
      grantAdmin(prisma, "medico_afiliado.crear");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({ id: "existing-id" } as never);

      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          nombreCompleto: "Dr. Juan Pérez",
          jvpmNumero: "12345",
          tipoRelacion: "AFILIADO_ARRENDATARIO",
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("existing-id"),
      });
      expect(prisma.medicoAfiliado.create).not.toHaveBeenCalled();
    });

    it("traduce el JVPM duplicado detectado en el INSERT (TOCTOU, P2002) a CONFLICT", async () => {
      grantAdmin(prisma, "medico_afiliado.crear");
      prisma.medicoAfiliado.findFirst.mockResolvedValue(null as never); // pre-check no lo detectó
      prisma.medicoAfiliado.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "5.22.0",
        }) as never,
      );

      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          nombreCompleto: "Dr. Juan Pérez",
          jvpmNumero: "12345",
          tipoRelacion: "AFILIADO_ARRENDATARIO",
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("JVPM 12345"),
      });
    });

    it("deniega sin el permiso medico_afiliado.crear", async () => {
      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          nombreCompleto: "Dr. Juan Pérez",
          jvpmNumero: "12345",
          tipoRelacion: "AFILIADO_ARRENDATARIO",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("activar", () => {
    it("pasa de PROSPECTO a ACTIVO", async () => {
      grantAdmin(prisma, "medico_afiliado.editar");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({
        id: AFILIADO_ID,
        estado: "PROSPECTO",
      } as never);
      prisma.medicoAfiliado.update.mockResolvedValue({ id: AFILIADO_ID, estado: "ACTIVO" } as never);

      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.activar({ id: AFILIADO_ID });

      expect(result).toMatchObject({ estado: "ACTIVO" });
      expect(prisma.medicoAfiliado.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ estado: "ACTIVO" }) }),
      );
    });

    it("rechaza activar un afiliado que no está en PROSPECTO", async () => {
      grantAdmin(prisma, "medico_afiliado.editar");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({
        id: AFILIADO_ID,
        estado: "ACTIVO",
      } as never);

      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.activar({ id: AFILIADO_ID })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(prisma.medicoAfiliado.update).not.toHaveBeenCalled();
    });
  });

  describe("darBaja", () => {
    it("pasa de ACTIVO a INACTIVO con fecha y motivo", async () => {
      grantAdmin(prisma, "medico_afiliado.dar_baja");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({
        id: AFILIADO_ID,
        estado: "ACTIVO",
      } as never);
      prisma.medicoAfiliado.update.mockResolvedValue({ id: AFILIADO_ID, estado: "INACTIVO" } as never);

      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.darBaja({
        id: AFILIADO_ID,
        fechaBaja: "2026-09-15",
        motivoBaja: "Renuncia voluntaria",
      });

      expect(result).toMatchObject({ estado: "INACTIVO" });
      expect(prisma.medicoAfiliado.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            estado: "INACTIVO",
            motivoBaja: "Renuncia voluntaria",
          }),
        }),
      );
    });

    it("rechaza dar de baja a un afiliado que no está ACTIVO", async () => {
      grantAdmin(prisma, "medico_afiliado.dar_baja");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({
        id: AFILIADO_ID,
        estado: "PROSPECTO",
      } as never);

      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.darBaja({ id: AFILIADO_ID, fechaBaja: "2026-09-15", motivoBaja: "X" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(prisma.medicoAfiliado.update).not.toHaveBeenCalled();
    });

    it("deniega sin el permiso medico_afiliado.dar_baja", async () => {
      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.darBaja({ id: AFILIADO_ID, fechaBaja: "2026-09-15", motivoBaja: "X" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("vincularUsuario", () => {
    const userId = "00000000-0000-0000-0000-000000000099";

    it("enlaza el afiliado a un User con membresía vigente en la org del tenant", async () => {
      grantAdmin(prisma, "medico_afiliado.editar");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({ id: AFILIADO_ID } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue({ id: "membership-1" } as never);
      prisma.medicoAfiliado.update.mockResolvedValue({ id: AFILIADO_ID, userId } as never);

      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.vincularUsuario({ id: AFILIADO_ID, userId });

      expect(result).toMatchObject({ userId });
      expect(prisma.userOrganizationRole.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, organizationId: MOCK_TENANT.organizationId },
        }),
      );
    });

    it("rechaza vincular un userId sin membresía en la org del tenant (IDOR)", async () => {
      grantAdmin(prisma, "medico_afiliado.editar");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({ id: AFILIADO_ID } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);

      const caller = medicoAfiliadoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.vincularUsuario({ id: AFILIADO_ID, userId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(prisma.medicoAfiliado.update).not.toHaveBeenCalled();
    });
  });
});
