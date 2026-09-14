import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@his/database";
import {
  bedListSchema,
  bedUpdateStatusSchema,
  bedFindAvailableSchema,
  bedAssignToEncounterSchema,
  bedReleaseSchema,
  bedCreateSchema,
  bedUpdateSchema,
  bedSetActiveSchema,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";
import {
  isOutOfServiceUnitScope,
  serviceUnitWhereFragment,
} from "../lib/service-unit-scope";
import { assertGlnAsignable } from "../lib/gln-validation";
import { capturarCargo } from "../lib/charge-capture";
import { assertEgresoFisicoAutorizado } from "../lib/egreso-fisico-gate";

const adminProc = requireRole(["ADMIN", "DIR"]);

function rethrowUniqueCode(err: unknown, code: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `El código ${code} ya existe en este establecimiento.`,
    });
  }
  throw err;
}

export const bedRouter = router({
  list: tenantProcedure.input(bedListSchema).query(async ({ ctx, input }) => {
    // Nivel B — si el usuario pidió un servicio y NO está en su scope, 403.
    if (input.serviceUnitId && isOutOfServiceUnitScope(ctx.tenant, input.serviceUnitId)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "El servicio seleccionado no está en tus asignaciones.",
      });
    }
    return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
      tx.bed.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          active: true,
          // Si vino input.serviceUnitId (ya validado en scope), úsalo directo.
          // Si no, aplica el scope agregado del usuario. Bed.serviceUnitId es
          // REQUIRED → no incluimos nullable.
          ...(input.serviceUnitId
            ? { serviceUnitId: input.serviceUnitId }
            : serviceUnitWhereFragment(ctx.tenant, "serviceUnitId")),
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
      }),
    );
  }),

  /** Igual que list pero agrupado por servicio para el componente BedMap. */
  getMap: tenantProcedure.query(async ({ ctx }) => {
    const services = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
      tx.serviceUnit.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          active: true,
          // Nivel B — el wallboard solo muestra los servicios del usuario.
          ...serviceUnitWhereFragment(ctx.tenant, "id"),
        },
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
      }),
    );
    return services.filter((s) => s.beds.length > 0);
  }),

  updateStatus: tenantProcedure
    .input(bedUpdateStatusSchema)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Nivel B — la cama debe pertenecer a un servicio del usuario.
        const bed = await tx.bed.findFirst({
          where: { id: input.bedId, organizationId: ctx.tenant.organizationId },
          select: { id: true, serviceUnitId: true },
        });
        if (!bed) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cama no encontrada." });
        }
        if (isOutOfServiceUnitScope(ctx.tenant, bed.serviceUnitId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "La cama pertenece a un servicio fuera de tus asignaciones.",
          });
        }
        return tx.bed.update({
          where: { id: input.bedId },
          data: { status: input.status },
        });
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
      // Nivel B — valida que el filtro pedido esté en el scope del usuario.
      if (input.serviceUnitId && isOutOfServiceUnitScope(ctx.tenant, input.serviceUnitId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "El servicio seleccionado no está en tus asignaciones.",
        });
      }
      return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
        tx.bed.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            active: true,
            status: "FREE",
            ...(input.serviceUnitId
              ? { serviceUnitId: input.serviceUnitId }
              : serviceUnitWhereFragment(ctx.tenant, "serviceUnitId")),
          },
          include: {
            serviceUnit: { select: { id: true, code: true, name: true } },
          },
          orderBy: [{ serviceUnitId: "asc" }, { code: "asc" }],
        }),
      );
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
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const bed = await tx.bed.findFirst({
          where: {
            id: input.bedId,
            organizationId: ctx.tenant.organizationId,
            active: true,
          },
          include: {
            roomRef: { select: { chargeCode: true, roomType: true } },
          },
        });
        if (!bed) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Cama no encontrada.",
          });
        }
        // Nivel B — la cama debe pertenecer a un servicio del usuario.
        if (isOutOfServiceUnitScope(ctx.tenant, bed.serviceUnitId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "La cama pertenece a un servicio fuera de tus asignaciones.",
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

        // docs/48 §5 C3-2 — decisión Edwin 2026-09-12: la asignación de cama
        // (este BedAssignment) es el disparador del cargo de estancia, no el
        // alta ni el censo nocturno. Fallback sintético determinista si la
        // cama no tiene Room o la Room no tiene chargeCode — nunca cargo en
        // 0, nunca silencio (R3): cae a PENDIENTE_TARIFA, visible.
        const roomChargeCode =
          bed.roomRef?.chargeCode ?? `HAB-${bed.roomRef?.roomType ?? "SIN_HABITACION"}`;
        await capturarCargo(tx, {
          organizationId: ctx.tenant.organizationId,
          patientId: encounter.patientId,
          encounterId: input.encounterId,
          code: roomChargeCode,
          descripcion: `Estancia — cama ${bed.code}`,
          quantity: 1,
          origen: "HABITACION",
          referenciaId: assignment.id,
          actorId: ctx.user.id,
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
   *
   * docs/48 §5 C3-2 — decisión Edwin 2026-09-12: la liberación por alta NO
   * revierte el cargo de estancia (la estancia ya se consumió). No existe
   * hoy una operación específica de "cancelar asignación errónea" (distinta
   * del alta) sobre BedAssignment — la reversión de un cargo mal capturado
   * se hace hoy vía el flujo de devoluciones/conciliación de cuentas
   * (patientAccount.router.ts / revertirCargo manual), no desde este router.
   */
  release: tenantProcedure
    .input(bedReleaseSchema)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
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
          // CC-0027 — gate de egreso físico: bloquea la liberación manual de
          // cama de un encuentro con PatientAccount activa sin alta
          // administrativa concluida (ver lib/egreso-fisico-gate.ts). Las
          // excepciones (defunción, traslado interno) no llegan aquí — esos
          // flujos liberan la cama inline, sin pasar por esta mutation.
          await assertEgresoFisicoAutorizado(tx, {
            organizationId: ctx.tenant.organizationId,
            encounterId: active.encounterId,
          });
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

  /**
   * Parametrización admin (2026-09-11) — tabla `/organizations/camas`.
   * A diferencia de `list` (tenant clínico, scope Nivel B, solo activas),
   * esta lectura es admin-only: cruza establecimientos, incluye inactivas y
   * trae habitación/servicio/establecimiento para la tabla de mantenimiento.
   */
  adminList: adminProc
    .input(
      z.object({
        establishmentId: z.string().uuid().optional(),
        roomId: z.string().uuid().optional(),
        activeOnly: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, (tx) =>
        tx.bed.findMany({
          where: {
            organizationId: tenant.organizationId,
            ...(input.establishmentId ? { establishmentId: input.establishmentId } : {}),
            ...(input.roomId ? { roomId: input.roomId } : {}),
            ...(input.activeOnly ? { active: true } : {}),
          },
          include: {
            establishment: { select: { id: true, code: true, name: true } },
            serviceUnit: { select: { id: true, code: true, name: true } },
            roomRef: { select: { id: true, code: true, name: true } },
          },
          orderBy: [{ establishmentId: "asc" }, { code: "asc" }],
        }),
      );
    }),

  /**
   * Parametrización admin (2026-09-11) — alta de cama.
   * `roomId`/`bedType`/`billingClass`/`glnCodigo` son el espejo Odoo ACS HMS
   * (hospital.bed + custom camas.config, sql/231). ADMIN/DIR bypasean el
   * scope de servicio (Nivel B) — son roles cross-servicio.
   */
  create: adminProc.input(bedCreateSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    if (input.glnCodigo) {
      await assertGlnAsignable(prisma, input.glnCodigo, ["cama"]);
    }
    try {
      return await withTenantContext(prisma, tenant, (tx) =>
        tx.bed.create({
          data: {
            organizationId: tenant.organizationId,
            establishmentId: input.establishmentId,
            serviceUnitId: input.serviceUnitId,
            code: input.code,
            roomId: input.roomId ?? null,
            isolation: input.isolation ?? null,
            bedType: input.bedType ?? null,
            billingClass: input.billingClass ?? null,
            glnCodigo: input.glnCodigo ?? null,
          },
        }),
      );
    } catch (err) {
      rethrowUniqueCode(err, input.code);
    }
  }),

  /** Parametrización admin — edición de cama (código, servicio, habitación, tipo, GLN). */
  update: adminProc.input(bedUpdateSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    if (input.glnCodigo) {
      await assertGlnAsignable(prisma, input.glnCodigo, ["cama"]);
    }
    return withTenantContext(prisma, tenant, async (tx) => {
      const existing = await tx.bed.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cama no encontrada." });
      }

      try {
        return await tx.bed.update({
          where: { id: input.id },
          data: {
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.serviceUnitId !== undefined ? { serviceUnitId: input.serviceUnitId } : {}),
            ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
            ...(input.isolation !== undefined ? { isolation: input.isolation } : {}),
            ...(input.bedType !== undefined ? { bedType: input.bedType } : {}),
            ...(input.billingClass !== undefined ? { billingClass: input.billingClass } : {}),
            ...(input.glnCodigo !== undefined ? { glnCodigo: input.glnCodigo } : {}),
          },
        });
      } catch (err) {
        rethrowUniqueCode(err, input.code ?? "");
      }
    });
  }),

  /** Parametrización admin — activa/desactiva una cama (no hay DELETE). */
  setActive: adminProc.input(bedSetActiveSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const existing = await tx.bed.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        select: { id: true, active: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cama no encontrada." });
      }
      if (existing.active === input.active) {
        return existing; // idempotente
      }
      return tx.bed.update({
        where: { id: input.id },
        data: { active: input.active },
      });
    });
  }),
});
