/**
 * Router CRUD de asignaciones usuario↔servicio (Nivel A).
 *
 * Endpoints:
 *   - listByUser    : asignaciones del usuario (filtrable por vigentes).
 *   - listByService : usuarios asignados a un servicio (filtrable por vigentes).
 *   - assign        : alta idempotente; reactiva si existía cerrada.
 *   - revoke        : setea `validTo=now` (no borra — auditable).
 *
 * Autorización:
 *   - tenantProcedure base.
 *   - assign/revoke restringidos a ADMIN o roles directivos (DIR/DIRECTOR/
 *     MEDICAL_DIRECTOR) — Edwin pidió que cualquier user no pueda escalarse
 *     a sí mismo, así que sale del scope clínico.
 *
 * Tabla: `public."UserServiceUnitAssignment"` (SQL 60).
 * RLS: SELECT propia o break-glass; insert/update/delete a service_role + ADMIN.
 *
 * Auditoría: la tabla está cubierta por triggers genéricos de `audit.audit_log`
 * (hash chain). No requiere lógica adicional aquí.
 */
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import {
  userServiceUnitListByUserInput,
  userServiceUnitListByServiceInput,
  userServiceUnitAssignInput,
  userServiceUnitRevokeInput,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";

const ADMIN_ROLES = ["ADMIN", "DIR", "DIRECTOR", "MEDICAL_DIRECTOR"];

function rethrowPrisma(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ya existe una asignación con esa combinación (usuario, servicio, rol).",
      });
    }
    if (err.code === "P2003") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Referencia inválida (usuario, servicio o rol inexistente).",
      });
    }
    if (err.code === "P2025") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Asignación no encontrada." });
    }
  }
  throw err;
}

export const userServiceUnitRouter = router({
  /** Lista asignaciones de un usuario (con detalle de servicio + rol opcional). */
  listByUser: tenantProcedure
    .input(userServiceUnitListByUserInput)
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const where: Prisma.UserServiceUnitAssignmentWhereInput = {
        userId: input.userId,
        // Filtrar por org del tenant — un usuario puede tener asignaciones en
        // otras orgs del holding y aquí solo mostramos la org activa.
        serviceUnit: { organizationId: ctx.tenant.organizationId },
      };
      if (input.onlyActive) {
        where.validFrom = { lte: now };
        where.OR = [{ validTo: null }, { validTo: { gte: now } }];
      }

      const items = await ctx.prisma.userServiceUnitAssignment.findMany({
        where,
        orderBy: [{ validTo: "asc" }, { validFrom: "desc" }],
        include: {
          serviceUnit: { select: { id: true, code: true, name: true } },
          role: { select: { id: true, code: true, name: true } },
        },
      });

      return items.map((a) => ({
        id: a.id,
        userId: a.userId,
        serviceUnitId: a.serviceUnitId,
        roleId: a.roleId,
        validFrom: a.validFrom,
        validTo: a.validTo,
        active: a.validFrom <= now && (a.validTo === null || a.validTo >= now),
        serviceUnit: a.serviceUnit,
        role: a.role,
      }));
    }),

  /** Lista usuarios asignados a un servicio. Útil para staffing del servicio. */
  listByService: tenantProcedure
    .input(userServiceUnitListByServiceInput)
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const where: Prisma.UserServiceUnitAssignmentWhereInput = {
        serviceUnitId: input.serviceUnitId,
        serviceUnit: { organizationId: ctx.tenant.organizationId },
      };
      if (input.onlyActive) {
        where.validFrom = { lte: now };
        where.OR = [{ validTo: null }, { validTo: { gte: now } }];
      }

      const items = await ctx.prisma.userServiceUnitAssignment.findMany({
        where,
        orderBy: [{ validTo: "asc" }, { validFrom: "desc" }],
        include: {
          user: { select: { id: true, fullName: true, email: true, active: true } },
          role: { select: { id: true, code: true, name: true } },
        },
      });

      return items.map((a) => ({
        id: a.id,
        userId: a.userId,
        serviceUnitId: a.serviceUnitId,
        roleId: a.roleId,
        validFrom: a.validFrom,
        validTo: a.validTo,
        active: a.validFrom <= now && (a.validTo === null || a.validTo >= now),
        user: a.user,
        role: a.role,
      }));
    }),

  /**
   * Crea o reactiva una asignación. Restringido a ADMIN/DIR/DIRECTOR/MEDICAL_DIRECTOR.
   * Idempotente sobre la terna (user, serviceUnit, role).
   */
  assign: requireRole(ADMIN_ROLES)
    .input(userServiceUnitAssignInput)
    .mutation(async ({ ctx, input }) => {
      // Validar pertenencia del serviceUnit a la org del tenant (defensa adicional
      // sobre el RLS y sobre el filtro en listByUser/Service).
      const svc = await ctx.prisma.serviceUnit.findUnique({
        where: { id: input.serviceUnitId },
        select: { organizationId: true, active: true },
      });
      if (!svc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Servicio no encontrado." });
      }
      if (svc.organizationId !== ctx.tenant.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "El servicio pertenece a otra organización.",
        });
      }

      const now = new Date();
      const validFrom = input.validFrom ?? now;
      const validTo = input.validTo ?? null;

      // Idempotencia: el @@unique(userId, serviceUnitId, roleId) garantiza
      // que como mucho existe una fila vigente por la terna. Si está cerrada,
      // la reabrimos extendiendo la ventana.
      //
      // NOTA: usamos findFirst en vez de findUnique porque `roleId` es
      // nullable y Prisma genera el accessor compound (`userId_serviceUnit
      // Id_roleId`) con `roleId: string` (no aceptaría null aunque la columna
      // sí). Con `findFirst` + WHERE el `null` se compara correctamente
      // ("IS NULL" en SQL).
      const existing = await ctx.prisma.userServiceUnitAssignment.findFirst({
        where: {
          userId: input.userId,
          serviceUnitId: input.serviceUnitId,
          roleId: input.roleId,
        },
      });

      if (existing) {
        const isLive =
          existing.validFrom <= now &&
          (existing.validTo === null || existing.validTo >= now);
        if (isLive) return existing; // no-op
        return ctx.prisma.userServiceUnitAssignment.update({
          where: { id: existing.id },
          data: { validFrom, validTo },
        });
      }

      try {
        return await ctx.prisma.userServiceUnitAssignment.create({
          data: {
            userId: input.userId,
            serviceUnitId: input.serviceUnitId,
            roleId: input.roleId,
            validFrom,
            validTo,
            createdBy: ctx.user.id,
          },
        });
      } catch (err) {
        rethrowPrisma(err);
      }
    }),

  /** Revoca (validTo=now). No borra, mantiene historia. */
  revoke: requireRole(ADMIN_ROLES)
    .input(userServiceUnitRevokeInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const existing = await ctx.prisma.userServiceUnitAssignment.findUnique({
        where: { id: input.id },
        include: { serviceUnit: { select: { organizationId: true } } },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Asignación no encontrada." });
      }
      if (existing.serviceUnit.organizationId !== ctx.tenant.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Asignación pertenece a otra organización.",
        });
      }
      const isLive =
        existing.validFrom <= now &&
        (existing.validTo === null || existing.validTo >= now);
      if (!isLive) return existing;
      return ctx.prisma.userServiceUnitAssignment.update({
        where: { id: existing.id },
        data: { validTo: now },
      });
    }),
});
