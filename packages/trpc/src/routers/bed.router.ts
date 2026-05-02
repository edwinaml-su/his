import { TRPCError } from "@trpc/server";
import {
  bedListSchema,
  bedUpdateStatusSchema,
  bedFindAvailableSchema,
  bedAssignToEncounterSchema,
  bedReleaseSchema,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const bedRouter = router({
  list: tenantProcedure.input(bedListSchema).query(async ({ ctx, input }) => {
    return ctx.prisma.bed.findMany({
      where: {
        organizationId: ctx.tenant.organizationId,
        active: true,
        ...(input.serviceUnitId ? { serviceUnitId: input.serviceUnitId } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      include: {
        serviceUnit: true,
        assignments: {
          where: { releasedAt: null },
          include: { encounter: { include: { patient: true } } },
          take: 1,
        },
      },
      orderBy: [{ serviceUnitId: "asc" }, { code: "asc" }],
    });
  }),

  /** Igual que list pero agrupado por servicio para el componente BedMap. */
  getMap: tenantProcedure.query(async ({ ctx }) => {
    const services = await ctx.prisma.serviceUnit.findMany({
      where: { organizationId: ctx.tenant.organizationId, active: true },
      include: {
        beds: {
          where: { active: true },
          include: {
            assignments: {
              where: { releasedAt: null },
              include: { encounter: { include: { patient: true } } },
              take: 1,
            },
          },
          orderBy: { code: "asc" },
        },
      },
      orderBy: { code: "asc" },
    });
    return services.filter((s) => s.beds.length > 0);
  }),

  updateStatus: tenantProcedure
    .input(bedUpdateStatusSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.bed.update({
        where: { id: input.bedId },
        data: { status: input.status },
      });
    }),

  /**
   * US-5.2 — Lista camas con status='FREE' opcionalmente filtradas por
   * servicio. Devuelve datos suficientes para el selector del wizard
   * (`code` + `serviceUnit.name`). Excluye camas inactivas.
   */
  findAvailable: tenantProcedure
    .input(bedFindAvailableSchema)
    .query(async ({ ctx, input }) => {
      return ctx.prisma.bed.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          active: true,
          status: "FREE",
          ...(input.serviceUnitId ? { serviceUnitId: input.serviceUnitId } : {}),
        },
        include: {
          serviceUnit: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ serviceUnitId: "asc" }, { code: "asc" }],
      });
    }),

  /**
   * US-5.2 — Asignación manual de cama a un encuentro abierto.
   *
   * Transacción:
   *   1) Cama existe en la org, está activa y `status='FREE'`.
   *   2) Encuentro abierto y sin BedAssignment activo (un paciente
   *      sólo puede ocupar una cama a la vez; un cambio se modela
   *      vía `transfer`/`release`).
   *   3) Crear BedAssignment con `assignedAt=now`, `reason` opcional.
   *   4) Bed.status='OCCUPIED'.
   *
   * Race conditions:
   *   - Dos usuarios pueden intentar tomar la misma cama. El validador
   *     de paso (1) corre dentro de la transacción y la actualización
   *     de `bed.status` impide doble asignación efectiva. Para fortaleza
   *     en alta concurrencia se debería usar `SELECT ... FOR UPDATE`
   *     vía `$queryRaw`; queda como TODO Sprint 2 si MINSAL lo exige.
   */
  assignToEncounter: tenantProcedure
    .input(bedAssignToEncounterSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const bed = await tx.bed.findFirst({
          where: {
            id: input.bedId,
            organizationId: ctx.tenant.organizationId,
            active: true,
          },
        });
        if (!bed) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Cama no encontrada.",
          });
        }
        if (bed.status !== "FREE") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `La cama ${bed.code} no está disponible (${bed.status}).`,
          });
        }

        const encounter = await tx.encounter.findFirst({
          where: {
            id: input.encounterId,
            organizationId: ctx.tenant.organizationId,
            dischargedAt: null,
          },
          include: {
            bedAssignments: { where: { releasedAt: null }, take: 1 },
          },
        });
        if (!encounter) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Encuentro abierto no encontrado.",
          });
        }
        if (encounter.bedAssignments.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "El encuentro ya tiene una cama asignada. Liberar o transferir primero.",
          });
        }

        const assignment = await tx.bedAssignment.create({
          data: {
            encounterId: input.encounterId,
            bedId: input.bedId,
            reason: input.reason ?? "Asignación manual",
            createdBy: ctx.user.id,
          },
        });
        await tx.bed.update({
          where: { id: input.bedId },
          data: { status: "OCCUPIED" },
        });
        return assignment;
      });
    }),

  /**
   * US-5.2 — Liberación de cama.
   *
   * Cierra el BedAssignment activo (releasedAt + releasedReason) y mueve
   * la cama a `DIRTY`, no a `FREE`, para forzar el ciclo de limpieza
   * (housekeeping). El módulo de limpieza (Sprint 4) será quien transicione
   * `DIRTY → FREE` tras sanitizar.
   *
   * Si no existe asignación activa, la respuesta es noop (idempotente).
   */
  release: tenantProcedure
    .input(bedReleaseSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const bed = await tx.bed.findFirst({
          where: {
            id: input.bedId,
            organizationId: ctx.tenant.organizationId,
            active: true,
          },
        });
        if (!bed) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Cama no encontrada.",
          });
        }

        const active = await tx.bedAssignment.findFirst({
          where: { bedId: input.bedId, releasedAt: null },
        });

        if (active) {
          await tx.bedAssignment.update({
            where: { id: active.id },
            data: {
              releasedAt: new Date(),
              reason: input.reason,
            },
          });
        }

        // Auto-clean queue: cama → DIRTY salvo que ya estuviera bloqueada
        // o en mantenimiento (en cuyo caso preservamos el estado superior).
        if (bed.status === "OCCUPIED" || bed.status === "RESERVED") {
          await tx.bed.update({
            where: { id: input.bedId },
            data: { status: "DIRTY" },
          });
        }

        return { ok: true, releasedAssignmentId: active?.id ?? null };
      });
    }),
});
