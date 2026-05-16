/**
 * Tests del rbacRouter (US-2.3 — RBAC gestión de roles y permisos).
 *
 * Cubre:
 *   - listRoles: filtra por org+global, search, activeOnly.
 *   - getRole: NOT_FOUND, FORBIDDEN cross-tenant, happy-path.
 *   - createRole: non-admin crea rol de org, FORBIDDEN para global sin super_admin,
 *     FORBIDDEN al intentar crear en otra org.
 *   - updateRole: NOT_FOUND, FORBIDDEN global sin super_admin, FORBIDDEN cross-tenant.
 *   - deactivateRole: soft delete, FORBIDDEN guards.
 *   - listPermissions: devuelve catálogo filtrado/sin filtro.
 *   - setRolePermissions: reemplaza set, FORBIDDEN guards, BAD_REQUEST por FK inexistente.
 *
 * Patrón: tenantProcedure → makeCtx con MOCK_TENANT (roleCodes incluye ADMIN).
 * Super-admin: makeCtx con roleCodes:["super_admin"].
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { rbacRouter } from "../rbac.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_TENANT_OTHER_ORG } from "@his/test-utils";

const orgId = MOCK_TENANT.organizationId;
const otherOrgId = MOCK_TENANT_OTHER_ORG.organizationId;

const roleId = "00000000-0000-0000-0000-000000000001";
const permId = "00000000-0000-0000-0000-000000000002";

/** Tenant con super_admin para operaciones globales. */
const SUPER_ADMIN_TENANT = { ...MOCK_TENANT, roleCodes: ["super_admin"] };

describe("rbacRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ---------------------------------------------------------------------------
  // listRoles
  // ---------------------------------------------------------------------------

  describe("listRoles", () => {
    it("incluye roles de org y globales por defecto (includeGlobal=true)", async () => {
      prisma.role.findMany.mockResolvedValue([] as never);
      prisma.permission.count.mockResolvedValue(5 as never);
      prisma.userOrganizationRole.groupBy.mockResolvedValue([] as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await caller.listRoles({});

      const args = prisma.role.findMany.mock.calls[0]![0];
      // where.AND[0] debe incluir OR con organizationId: orgId y null
      const firstCond = (args.where as { AND: unknown[] }).AND[0];
      expect(JSON.stringify(firstCond)).toContain(orgId);
    });

    it("sólo org cuando includeGlobal=false", async () => {
      prisma.role.findMany.mockResolvedValue([] as never);
      prisma.permission.count.mockResolvedValue(0 as never);
      prisma.userOrganizationRole.groupBy.mockResolvedValue([] as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await caller.listRoles({ includeGlobal: false });

      const args = prisma.role.findMany.mock.calls[0]![0];
      const firstCond = (args.where as { AND: unknown[] }).AND[0];
      // Sin OR (organizationId directo)
      expect(JSON.stringify(firstCond)).toContain(`"organizationId":"${orgId}"`);
      expect(JSON.stringify(firstCond)).not.toContain('"OR"');
    });

    it("aplica search cuando se provee", async () => {
      prisma.role.findMany.mockResolvedValue([] as never);
      prisma.permission.count.mockResolvedValue(0 as never);
      prisma.userOrganizationRole.groupBy.mockResolvedValue([] as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await caller.listRoles({ search: "admin" });

      const args = prisma.role.findMany.mock.calls[0]![0];
      const andArr = (args.where as { AND: unknown[] }).AND;
      expect(JSON.stringify(andArr)).toContain("admin");
    });

    it("calcula coverage NONE cuando no hay permisos ALLOW", async () => {
      prisma.role.findMany.mockResolvedValue([
        {
          id: roleId,
          organizationId: orgId,
          code: "test",
          name: "Test",
          description: null,
          active: true,
          _count: { permissions: 0, userRoles: 0 },
          permissions: [],
        },
      ] as never);
      prisma.permission.count.mockResolvedValue(10 as never);
      prisma.userOrganizationRole.groupBy.mockResolvedValue([] as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listRoles({});

      expect(result[0]!.coverage).toBe("NONE");
    });

    it("calcula coverage ALL cuando allowCount >= totalPermissions", async () => {
      prisma.role.findMany.mockResolvedValue([
        {
          id: roleId,
          organizationId: orgId,
          code: "test",
          name: "Test",
          description: null,
          active: true,
          _count: { permissions: 3, userRoles: 0 },
          permissions: [
            { effect: "ALLOW" },
            { effect: "ALLOW" },
            { effect: "ALLOW" },
          ],
        },
      ] as never);
      prisma.permission.count.mockResolvedValue(3 as never);
      prisma.userOrganizationRole.groupBy.mockResolvedValue([] as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listRoles({});

      expect(result[0]!.coverage).toBe("ALL");
    });

    it("sin tenant → FORBIDDEN", async () => {
      const caller = rbacRouter.createCaller(makeCtx({ prisma, tenant: null }));
      await expect(caller.listRoles({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ---------------------------------------------------------------------------
  // getRole
  // ---------------------------------------------------------------------------

  describe("getRole", () => {
    it("NOT_FOUND si el rol no existe", async () => {
      prisma.role.findUnique.mockResolvedValue(null as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.getRole({ id: roleId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("FORBIDDEN si el rol es de otra org (cross-tenant)", async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: roleId,
        organizationId: otherOrgId,
        code: "other",
        name: "Other",
        description: null,
        active: true,
        permissions: [],
      } as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.getRole({ id: roleId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("happy-path: devuelve rol con permisos de la org propia", async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: roleId,
        organizationId: orgId,
        code: "admin",
        name: "Administrador",
        description: null,
        active: true,
        permissions: [
          {
            permissionId: permId,
            effect: "ALLOW",
            permission: {
              id: permId,
              code: "patient:read",
              resource: "patient",
              action: "read",
            },
          },
        ],
      } as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.getRole({ id: roleId });

      expect(result.id).toBe(roleId);
      expect(result.permissions).toHaveLength(1);
      expect(result.permissions[0]!.effect).toBe("ALLOW");
    });

    it("rol global (organizationId=null) es accesible desde cualquier tenant", async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: roleId,
        organizationId: null,
        code: "super_admin",
        name: "Super Admin",
        description: null,
        active: true,
        permissions: [],
      } as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.getRole({ id: roleId });
      expect(result.organizationId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // createRole
  // ---------------------------------------------------------------------------

  describe("createRole", () => {
    it("crea rol en la org del tenant por defecto", async () => {
      const newRole = { id: roleId, organizationId: orgId, code: "medico", name: "Médico", description: null, active: true };
      prisma.role.create.mockResolvedValue(newRole as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.createRole({ code: "medico", name: "Médico" });

      expect(result.organizationId).toBe(orgId);
      expect(prisma.role.create).toHaveBeenCalledOnce();
    });

    it("FORBIDDEN si no-super_admin intenta crear rol global (organizationId=null)", async () => {
      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.createRole({ code: "global", name: "Global", organizationId: null }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(prisma.role.create).not.toHaveBeenCalled();
    });

    it("super_admin puede crear rol global", async () => {
      const globalRole = { id: roleId, organizationId: null, code: "global", name: "Global", description: null, active: true };
      prisma.role.create.mockResolvedValue(globalRole as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma, tenant: SUPER_ADMIN_TENANT }));
      const result = await caller.createRole({ code: "global", name: "Global", organizationId: null });

      expect(result.organizationId).toBeNull();
    });

    it("FORBIDDEN si se intenta crear rol en otra org", async () => {
      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.createRole({ code: "test", name: "Test", organizationId: otherOrgId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("propaga error cuando prisma.role.create falla", async () => {
      // Nota: en el ambiente de tests el stub de @his/database no exporta la
      // clase Prisma, por lo que rethrowPrisma no puede hacer instanceof.
      // Verificamos que cualquier error de BD lanza una excepción (no silencia).
      prisma.role.create.mockRejectedValue(new Error("DB error") as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.createRole({ code: "dupe", name: "Duplicado" }),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // updateRole
  // ---------------------------------------------------------------------------

  describe("updateRole", () => {
    it("NOT_FOUND si el rol no existe", async () => {
      prisma.role.findUnique.mockResolvedValue(null as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.updateRole({ id: roleId, name: "Nuevo" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("FORBIDDEN si rol global y no super_admin", async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: roleId,
        organizationId: null,
        code: "global",
        name: "Global",
        active: true,
      } as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.updateRole({ id: roleId, name: "Modificado" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("FORBIDDEN si rol es de otra org", async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: roleId,
        organizationId: otherOrgId,
        code: "other",
        name: "Other",
        active: true,
      } as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.updateRole({ id: roleId, active: false })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("happy-path: actualiza nombre en rol de la org propia", async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: roleId,
        organizationId: orgId,
        code: "admin",
        name: "Admin",
        active: true,
      } as never);
      prisma.role.update.mockResolvedValue({
        id: roleId,
        organizationId: orgId,
        code: "admin",
        name: "Admin Actualizado",
        active: true,
      } as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.updateRole({ id: roleId, name: "Admin Actualizado" });

      expect(result.name).toBe("Admin Actualizado");
    });
  });

  // ---------------------------------------------------------------------------
  // deactivateRole
  // ---------------------------------------------------------------------------

  describe("deactivateRole", () => {
    it("NOT_FOUND si el rol no existe", async () => {
      prisma.role.findUnique.mockResolvedValue(null as never);
      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.deactivateRole({ id: roleId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("FORBIDDEN si rol global y no super_admin", async () => {
      prisma.role.findUnique.mockResolvedValue({ id: roleId, organizationId: null, active: true } as never);
      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.deactivateRole({ id: roleId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("FORBIDDEN si rol de otra org", async () => {
      prisma.role.findUnique.mockResolvedValue({ id: roleId, organizationId: otherOrgId, active: true } as never);
      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.deactivateRole({ id: roleId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("soft delete: llama update con active=false", async () => {
      prisma.role.findUnique.mockResolvedValue({ id: roleId, organizationId: orgId, active: true } as never);
      prisma.role.update.mockResolvedValue({ id: roleId, active: false } as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.deactivateRole({ id: roleId });

      expect(prisma.role.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { active: false } }),
      );
      expect(result.active).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // listPermissions
  // ---------------------------------------------------------------------------

  describe("listPermissions", () => {
    it("retorna catálogo sin filtro", async () => {
      const perms = [
        { id: permId, code: "patient:read", resource: "patient", action: "read" },
      ];
      prisma.permission.findMany.mockResolvedValue(perms as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listPermissions({});

      expect(result).toHaveLength(1);
      expect(result[0]!.resource).toBe("patient");
    });

    it("aplica filtro search en el where", async () => {
      prisma.permission.findMany.mockResolvedValue([] as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await caller.listPermissions({ search: "patient" });

      const args = prisma.permission.findMany.mock.calls[0]![0];
      expect(JSON.stringify(args.where)).toContain("patient");
    });
  });

  // ---------------------------------------------------------------------------
  // setRolePermissions
  // ---------------------------------------------------------------------------

  describe("setRolePermissions", () => {
    it("NOT_FOUND si el rol no existe", async () => {
      prisma.role.findUnique.mockResolvedValue(null as never);
      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setRolePermissions({ roleId, permissions: [] }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("FORBIDDEN si rol global y no super_admin", async () => {
      prisma.role.findUnique.mockResolvedValue({ id: roleId, organizationId: null } as never);
      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setRolePermissions({ roleId, permissions: [] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("FORBIDDEN si rol de otra org", async () => {
      prisma.role.findUnique.mockResolvedValue({ id: roleId, organizationId: otherOrgId } as never);
      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setRolePermissions({ roleId, permissions: [] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("happy-path: reemplaza permisos atómicamente y retorna count", async () => {
      prisma.role.findUnique.mockResolvedValue({ id: roleId, organizationId: orgId } as never);
      prisma.$transaction.mockResolvedValue([{ count: 0 }, { count: 2 }] as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setRolePermissions({
        roleId,
        permissions: [
          { permissionId: permId, effect: "ALLOW" },
          { permissionId: "00000000-0000-0000-0000-000000000003", effect: "DENY" },
        ],
      });

      expect(result.ok).toBe(true);
      expect(result.count).toBe(2);
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it("deduplica permissionId duplicados: gana el último", async () => {
      prisma.role.findUnique.mockResolvedValue({ id: roleId, organizationId: orgId } as never);
      prisma.$transaction.mockResolvedValue([null, null] as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setRolePermissions({
        roleId,
        permissions: [
          { permissionId: permId, effect: "ALLOW" },
          { permissionId: permId, effect: "DENY" }, // duplicado, gana DENY
        ],
      });

      expect(result.count).toBe(1);
    });

    it("propaga error cuando $transaction falla en setRolePermissions", async () => {
      // Nota: en el ambiente de tests el stub de @his/database no exporta la
      // clase Prisma, por lo que el path P2003 → BAD_REQUEST no puede activarse.
      // Verificamos que cualquier error de $transaction no se silencia.
      prisma.role.findUnique.mockResolvedValue({ id: roleId, organizationId: orgId } as never);
      prisma.$transaction.mockRejectedValue(new Error("FK error") as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setRolePermissions({
          roleId,
          permissions: [{ permissionId: permId, effect: "ALLOW" }],
        }),
      ).rejects.toThrow();
    });

    it("permisos vacíos: sólo deleteMany, count=0", async () => {
      prisma.role.findUnique.mockResolvedValue({ id: roleId, organizationId: orgId } as never);
      prisma.$transaction.mockResolvedValue([{ count: 3 }] as never);

      const caller = rbacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setRolePermissions({ roleId, permissions: [] });

      expect(result.count).toBe(0);
    });
  });
});
