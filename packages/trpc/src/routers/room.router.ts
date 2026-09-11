/**
 * Router tRPC — Habitaciones (Room, CRUD admin).
 *
 * Modelo espejo de `hospital.ward` (Odoo ACS HMS) — encargo de Edwin
 * 2026-09-11. `sql/231_room_bed_odoo_mirror.sql` crea la tabla, la migra
 * desde las 72 camas reales de prod (`Bed.room` → 1 Room por cama) y enlaza
 * `Bed.roomId`.
 *
 * Mismo patrón que `establishment.router.ts`: `Room` tiene modelo Prisma →
 * `withTenantContext` (contrato RLS) en cada procedure. RBAC: ADMIN o DIR
 * para todo (router de administración/parametrización).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@his/database";
import {
  roomListSchema,
  roomCreateSchema,
  roomUpdateSchema,
  roomSetActiveSchema,
} from "@his/contracts";
import { router, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";
import { assertGlnAsignable } from "../lib/gln-validation";

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

export const roomRouter = router({
  /** Lista las habitaciones de la org del tenant, con filtros opcionales. */
  list: adminProc.input(roomListSchema).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    return withTenantContext(prisma, tenant, (tx) =>
      tx.room.findMany({
        where: {
          organizationId: tenant.organizationId,
          ...(input?.establishmentId ? { establishmentId: input.establishmentId } : {}),
          ...(input?.serviceUnitId ? { serviceUnitId: input.serviceUnitId } : {}),
          ...(input?.activeOnly ? { active: true } : {}),
        },
        include: {
          serviceUnit: { select: { id: true, code: true, name: true } },
          establishment: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ establishmentId: "asc" }, { code: "asc" }],
      }),
    );
  }),

  /**
   * Unidades de servicio activas de un establecimiento — alimenta el
   * selector de las dialogs de Room/Bed (no existe un `serviceUnit.router`
   * dedicado; esta lectura es puntual para esos formularios admin).
   */
  listServiceUnits: adminProc
    .input(z.object({ establishmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, (tx) =>
        tx.serviceUnit.findMany({
          where: {
            organizationId: tenant.organizationId,
            establishmentId: input.establishmentId,
            active: true,
          },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
        }),
      );
    }),

  /** Crea una habitación nueva en la org del tenant. */
  create: adminProc.input(roomCreateSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    if (input.glnCodigo) {
      await assertGlnAsignable(prisma, input.glnCodigo, ["cama"]);
    }
    try {
      return await withTenantContext(prisma, tenant, (tx) =>
        tx.room.create({
          data: {
            organizationId: tenant.organizationId,
            establishmentId: input.establishmentId,
            serviceUnitId: input.serviceUnitId,
            code: input.code,
            name: input.name,
            floor: input.floor ?? null,
            ...(input.roomType !== undefined ? { roomType: input.roomType } : {}),
            ...(input.genderPolicy !== undefined ? { genderPolicy: input.genderPolicy } : {}),
            ...(input.private !== undefined ? { private: input.private } : {}),
            ...(input.bioHazard !== undefined ? { bioHazard: input.bioHazard } : {}),
            ...(input.airConditioning !== undefined ? { airConditioning: input.airConditioning } : {}),
            ...(input.television !== undefined ? { television: input.television } : {}),
            ...(input.telephone !== undefined ? { telephone: input.telephone } : {}),
            ...(input.privateBathroom !== undefined ? { privateBathroom: input.privateBathroom } : {}),
            ...(input.internet !== undefined ? { internet: input.internet } : {}),
            ...(input.refrigerator !== undefined ? { refrigerator: input.refrigerator } : {}),
            ...(input.microwave !== undefined ? { microwave: input.microwave } : {}),
            ...(input.guestSofa !== undefined ? { guestSofa: input.guestSofa } : {}),
            chargeCode: input.chargeCode ?? null,
            ...(input.invoicePolicy !== undefined ? { invoicePolicy: input.invoicePolicy } : {}),
            glnCodigo: input.glnCodigo ?? null,
            notes: input.notes ?? null,
            createdBy: user.id,
            updatedBy: user.id,
          },
        }),
      );
    } catch (err) {
      rethrowUniqueCode(err, input.code);
    }
  }),

  /** Edita una habitación existente del tenant. */
  update: adminProc.input(roomUpdateSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    if (input.glnCodigo) {
      await assertGlnAsignable(prisma, input.glnCodigo, ["cama"]);
    }
    return withTenantContext(prisma, tenant, async (tx) => {
      const existing = await tx.room.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Habitación no encontrada." });
      }

      try {
        return await tx.room.update({
          where: { id: input.id },
          data: {
            ...(input.serviceUnitId !== undefined ? { serviceUnitId: input.serviceUnitId } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.floor !== undefined ? { floor: input.floor } : {}),
            ...(input.roomType !== undefined ? { roomType: input.roomType } : {}),
            ...(input.genderPolicy !== undefined ? { genderPolicy: input.genderPolicy } : {}),
            ...(input.private !== undefined ? { private: input.private } : {}),
            ...(input.bioHazard !== undefined ? { bioHazard: input.bioHazard } : {}),
            ...(input.airConditioning !== undefined ? { airConditioning: input.airConditioning } : {}),
            ...(input.television !== undefined ? { television: input.television } : {}),
            ...(input.telephone !== undefined ? { telephone: input.telephone } : {}),
            ...(input.privateBathroom !== undefined ? { privateBathroom: input.privateBathroom } : {}),
            ...(input.internet !== undefined ? { internet: input.internet } : {}),
            ...(input.refrigerator !== undefined ? { refrigerator: input.refrigerator } : {}),
            ...(input.microwave !== undefined ? { microwave: input.microwave } : {}),
            ...(input.guestSofa !== undefined ? { guestSofa: input.guestSofa } : {}),
            ...(input.chargeCode !== undefined ? { chargeCode: input.chargeCode } : {}),
            ...(input.invoicePolicy !== undefined ? { invoicePolicy: input.invoicePolicy } : {}),
            ...(input.glnCodigo !== undefined ? { glnCodigo: input.glnCodigo } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            updatedBy: user.id,
          },
        });
      } catch (err) {
        rethrowUniqueCode(err, input.id);
      }
    });
  }),

  /** Activa/desactiva una habitación (no hay DELETE — solo toggle). */
  setActive: adminProc.input(roomSetActiveSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const existing = await tx.room.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        select: { id: true, active: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Habitación no encontrada." });
      }
      if (existing.active === input.active) {
        return existing; // idempotente
      }
      return tx.room.update({
        where: { id: input.id },
        data: { active: input.active, updatedBy: user.id },
      });
    });
  }),
});
