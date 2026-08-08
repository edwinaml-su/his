/**
 * CC-0017 F2 — router tRPC: CRUD de `AbacRule`.
 *
 * Reemplaza la vista solo-lectura de `/abac` (que listaba `MVP_ABAC_RULES`
 * hardcoded). Las reglas ahora viven en BD (`AbacRule`, sql/195) y se
 * evalúan server-side por `packages/trpc/src/abac/motor.ts`.
 *
 * Roles: list/get → cualquier usuario tenant (lectura informativa, igual que
 * antes). create/update/setActive/delete → ADMIN/DIR (o super_admin/
 * admin_clinico — alias históricos del MVP, ver docs/CC/0017/REQ-SEC-ABAC-002).
 *
 * Todas las queries pasan por `withTenantContext` (contrato RLS, CLAUDE.md §RLS).
 */
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import {
  abacRuleListInput,
  abacRuleGetInput,
  abacRuleCreateInput,
  abacRuleUpdateInput,
  abacRuleSetActiveInput,
  abacRuleDeleteInput,
  abacCondicionSchema,
  type AbacRuleRecord,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

const WRITE_ROLES = ["ADMIN", "DIR", "super_admin", "admin_clinico"];
const writerProc = requireRole(WRITE_ROLES);

interface AbacRuleRow {
  id: string;
  organizationId: string;
  recurso: string;
  accion: string;
  effect: string;
  prioridad: number;
  descripcion: string | null;
  condiciones: unknown;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Convierte una fila Prisma a la forma de respuesta tipada (condiciones parseadas). */
function toRecord(row: AbacRuleRow): AbacRuleRecord {
  const arr = Array.isArray(row.condiciones) ? row.condiciones : [];
  const parsed = abacCondicionSchema.array().safeParse(arr);
  return {
    id: row.id,
    organizationId: row.organizationId,
    recurso: row.recurso as AbacRuleRecord["recurso"],
    accion: row.accion as AbacRuleRecord["accion"],
    effect: row.effect as AbacRuleRecord["effect"],
    prioridad: row.prioridad,
    descripcion: row.descripcion,
    // Fila corrupta (no debería ocurrir — el router siempre escribe vía Zod):
    // se reporta con condiciones=[] en vez de tumbar la respuesta completa.
    condiciones: parsed.success ? parsed.data : [],
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const abacRouter = router({
  list: tenantProcedure.input(abacRuleListInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const rows = await tx.abacRule.findMany({
        where: {
          organizationId: tenant.organizationId,
          ...(input.recurso ? { recurso: input.recurso } : {}),
          ...(input.accion ? { accion: input.accion } : {}),
          ...(input.activeOnly ? { active: true } : {}),
        },
        orderBy: [{ recurso: "asc" }, { accion: "asc" }, { prioridad: "desc" }],
      });
      return rows.map((r) => toRecord(r as unknown as AbacRuleRow));
    });
  }),

  get: tenantProcedure.input(abacRuleGetInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const row = await tx.abacRule.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Regla ABAC no encontrada." });
      }
      return toRecord(row as unknown as AbacRuleRow);
    });
  }),

  create: writerProc.input(abacRuleCreateInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const row = await tx.abacRule.create({
        data: {
          organizationId: tenant.organizationId,
          recurso: input.recurso,
          accion: input.accion,
          effect: input.effect,
          prioridad: input.prioridad,
          descripcion: input.descripcion ?? null,
          condiciones: input.condiciones as Prisma.InputJsonValue,
          active: true,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
      return toRecord(row as unknown as AbacRuleRow);
    });
  }),

  update: writerProc.input(abacRuleUpdateInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const existing = await tx.abacRule.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Regla ABAC no encontrada." });
      }

      const row = await tx.abacRule.update({
        where: { id: input.id },
        data: {
          ...(input.recurso !== undefined ? { recurso: input.recurso } : {}),
          ...(input.accion !== undefined ? { accion: input.accion } : {}),
          ...(input.effect !== undefined ? { effect: input.effect } : {}),
          ...(input.prioridad !== undefined ? { prioridad: input.prioridad } : {}),
          ...(input.descripcion !== undefined ? { descripcion: input.descripcion } : {}),
          ...(input.condiciones !== undefined
            ? { condiciones: input.condiciones as Prisma.InputJsonValue }
            : {}),
          updatedBy: user.id,
        },
      });
      return toRecord(row as unknown as AbacRuleRow);
    });
  }),

  setActive: writerProc.input(abacRuleSetActiveInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const existing = await tx.abacRule.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Regla ABAC no encontrada." });
      }
      const row = await tx.abacRule.update({
        where: { id: input.id },
        data: { active: input.active, updatedBy: user.id },
      });
      return toRecord(row as unknown as AbacRuleRow);
    });
  }),

  delete: writerProc.input(abacRuleDeleteInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const existing = await tx.abacRule.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Regla ABAC no encontrada." });
      }
      await tx.abacRule.delete({ where: { id: input.id } });
      return { ok: true as const, id: input.id };
    });
  }),
});
