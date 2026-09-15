/**
 * CC-0032 — cierre de escalación de privilegios RBAC (P0-2, docs/audit/
 * 2026-09-15_cobertura/03-facturacion-admin-seguridad.md).
 *
 * Cubre las 4 mutations de `userAdminRouter` que estaban en `tenantProcedure`
 * sin gate (`update`, `deactivate`, `assignRole`, `revokeRole`) y la defensa
 * en profundidad:
 *   - `assignRole`/`revokeRole` → requireRole(["SUPER_ADMIN"]).
 *   - `update`/`deactivate` → requireRole(["SUPER_ADMIN","ADMIN"]), pero un
 *     ADMIN (sin SUPER_ADMIN) no puede tocar a un usuario con membresía
 *     SUPER_ADMIN vigente (assertActorCanTargetUser).
 *   - `assignRole` rechaza SIEMPRE asignar el rol SUPER_ADMIN por API,
 *     incluso si el actor ya es SUPER_ADMIN (sólo SQL/DBA lo otorga).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { userAdminRouter } from "../user-admin.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN } from "@his/test-utils";

const orgId = MOCK_TENANT.organizationId;
const TARGET_ID = "00000000-0000-0000-0000-0000000000ff";
const ROLE_ID = "00000000-0000-0000-0000-000000000010";
const SUPER_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000011";

/** ADMIN de la org, SIN SUPER_ADMIN. */
const ADMIN_TENANT = MOCK_TENANT;
/** Único titular autorizado (Edwin) — rol SUPER_ADMIN, mayúsculas. */
const SUPER_ADMIN_TENANT = { ...MOCK_TENANT, roleCodes: ["SUPER_ADMIN"] };

describe("userAdminRouter — CC-0032 gates", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  describe("update", () => {
    it("FORBIDDEN si el caller no tiene SUPER_ADMIN ni ADMIN", async () => {
      const caller = userAdminRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["NURSE"] } }),
      );
      await expect(
        caller.update({ id: TARGET_ID, fullName: "Nuevo Nombre" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("ADMIN puede editar a un usuario sin membresía SUPER_ADMIN", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);
      prisma.user.update.mockResolvedValue({ id: TARGET_ID, fullName: "Nuevo Nombre" } as never);

      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: ADMIN_TENANT }));
      const result = await caller.update({ id: TARGET_ID, fullName: "Nuevo Nombre" });

      expect(result.fullName).toBe("Nuevo Nombre");
    });

    it("FORBIDDEN si un ADMIN intenta editar a un usuario con membresía SUPER_ADMIN vigente", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue({ id: "uor-1" } as never);

      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: ADMIN_TENANT }));
      await expect(
        caller.update({ id: TARGET_ID, fullName: "Hackeado" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("SUPER_ADMIN puede editar a otro SUPER_ADMIN (no consulta membresías)", async () => {
      prisma.user.update.mockResolvedValue({ id: TARGET_ID, fullName: "Editado" } as never);

      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: SUPER_ADMIN_TENANT }));
      const result = await caller.update({ id: TARGET_ID, fullName: "Editado" });

      expect(result.fullName).toBe("Editado");
      expect(prisma.userOrganizationRole.findFirst).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // deactivate
  // ---------------------------------------------------------------------------

  describe("deactivate", () => {
    it("FORBIDDEN si el caller no tiene SUPER_ADMIN ni ADMIN", async () => {
      const caller = userAdminRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["NURSE"] } }),
      );
      await expect(caller.deactivate({ id: TARGET_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("ADMIN puede desactivar a un usuario sin membresía SUPER_ADMIN", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);
      prisma.user.update.mockResolvedValue({ id: TARGET_ID, active: false } as never);

      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: ADMIN_TENANT }));
      const result = await caller.deactivate({ id: TARGET_ID });

      expect(result.active).toBe(false);
    });

    it("FORBIDDEN si un ADMIN intenta desactivar a un usuario con membresía SUPER_ADMIN vigente", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue({ id: "uor-1" } as never);

      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: ADMIN_TENANT }));
      await expect(caller.deactivate({ id: TARGET_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("BAD_REQUEST si intenta desactivarse a sí mismo (guard preexistente, antes del check SUPER_ADMIN)", async () => {
      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: SUPER_ADMIN_TENANT }));
      await expect(caller.deactivate({ id: MOCK_USER_ADMIN.id })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // assignRole
  // ---------------------------------------------------------------------------

  describe("assignRole", () => {
    it("FORBIDDEN si el caller no es SUPER_ADMIN (ni siquiera ADMIN pasa)", async () => {
      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: ADMIN_TENANT }));
      await expect(
        caller.assignRole({ userId: TARGET_ID, organizationId: orgId, roleId: ROLE_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
    });

    it("FORBIDDEN si se intenta asignar el rol SUPER_ADMIN — ni siquiera otro SUPER_ADMIN puede vía API", async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: SUPER_ADMIN_ROLE_ID,
        code: "SUPER_ADMIN",
        active: true,
        organizationId: orgId,
      } as never);

      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: SUPER_ADMIN_TENANT }));
      await expect(
        caller.assignRole({
          userId: TARGET_ID,
          organizationId: orgId,
          roleId: SUPER_ADMIN_ROLE_ID,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(prisma.userOrganizationRole.create).not.toHaveBeenCalled();
    });

    it("SUPER_ADMIN puede asignar un rol normal", async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: ROLE_ID,
        code: "NURSE",
        active: true,
        organizationId: orgId,
      } as never);
      prisma.userOrganizationRole.findUnique.mockResolvedValue(null as never);
      prisma.userOrganizationRole.create.mockResolvedValue({
        id: "uor-new",
        userId: TARGET_ID,
        organizationId: orgId,
        roleId: ROLE_ID,
      } as never);

      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: SUPER_ADMIN_TENANT }));
      const result = await caller.assignRole({
        userId: TARGET_ID,
        organizationId: orgId,
        roleId: ROLE_ID,
      });

      expect(result.roleId).toBe(ROLE_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // revokeRole
  // ---------------------------------------------------------------------------

  describe("revokeRole", () => {
    it("FORBIDDEN si el caller no es SUPER_ADMIN", async () => {
      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: ADMIN_TENANT }));
      await expect(
        caller.revokeRole({ userId: TARGET_ID, organizationId: orgId, roleId: ROLE_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("SUPER_ADMIN puede revocar un rol vigente", async () => {
      const now = new Date();
      prisma.userOrganizationRole.findUnique.mockResolvedValue({
        id: "uor-1",
        userId: TARGET_ID,
        organizationId: orgId,
        roleId: ROLE_ID,
        validFrom: now,
        validTo: null,
      } as never);
      prisma.userOrganizationRole.update.mockResolvedValue({
        id: "uor-1",
        validTo: now,
      } as never);

      const caller = userAdminRouter.createCaller(makeCtx({ prisma, tenant: SUPER_ADMIN_TENANT }));
      const result = await caller.revokeRole({
        userId: TARGET_ID,
        organizationId: orgId,
        roleId: ROLE_ID,
      });

      expect(result).not.toBeNull();
    });
  });
});
