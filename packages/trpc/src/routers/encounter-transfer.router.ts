/**
 * US-5.3 — Traslados internos (equipo Lima · Sprint 3).
 *
 * Router dedicado para mover un encuentro abierto entre servicios y/o
 * camas. Coexiste con el legacy `encounter.router.transfer` (que hoy
 * sólo registra el evento sin mover camas). Cuando otros equipos
 * eliminen el legacy, este router queda como única fuente de verdad.
 *
 * Reglas de negocio (DoR/DoD US-5.3):
 *   1. Encuentro debe estar abierto (`dischargedAt IS NULL`).
 *   2. Si tiene `BedAssignment` activo, se cierra y la cama pasa a
 *      `DIRTY` (pendiente de limpieza, TDR §8.6).
 *   3. Se inserta el record `EncounterTransfer` con from/to.
 *   4. Si hay `toBedId`, se valida `bed.status='FREE'`, se crea nuevo
 *      `BedAssignment` y la cama pasa a `OCCUPIED`.
 *   5. Se actualiza `Encounter.serviceUnitId` con el destino.
 *
 * Nota schema: el modelo Prisma usa `fromServiceId/toServiceId/
 * fromBedId/toBedId/occurredAt/createdBy`. El brief original menciona
 * `fromServiceUnitId/toServiceUnitId/fromBedAssignmentId/...` pero la
 * migración real (C:/proyecto/HIS/packages/database/prisma/schema.prisma
 * §1256) mantiene los nombres legacy. Respetamos el schema migrado.
 */
import { TRPCError } from "@trpc/server";
import {
  transferEncounterInput,
  listTransfersByEncounterInput,
  listRecentTransfersInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const encounterTransferRouter = router({
  /**
   * Mueve un encuentro abierto a otro servicio (y opcionalmente a otra
   * cama). Operación atómica.
   */
  transferEncounter: tenantProcedure
    .input(transferEncounterInput)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        // 1) Encuentro abierto en la org.
        const enc = await tx.encounter.findFirst({
          where: {
            id: input.encounterId,
            organizationId: ctx.tenant.organizationId,
          },
          include: {
            bedAssignments: {
              where: { releasedAt: null },
              include: { bed: true },
              take: 1,
            },
          },
        });
        if (!enc) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Encuentro no encontrado.",
          });
        }
        if (enc.dischargedAt) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "No se puede trasladar un encuentro dado de alta.",
          });
        }

        if (
          enc.serviceUnitId === input.toServiceUnitId &&
          (!input.toBedId ||
            (enc.bedAssignments[0]?.bedId === input.toBedId))
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El destino coincide con la ubicación actual.",
          });
        }

        const activeAssignment = enc.bedAssignments[0] ?? null;
        const fromBedId = activeAssignment?.bedId ?? null;
        const fromServiceId = enc.serviceUnitId ?? null;

        // 2) Cerrar BedAssignment activo y marcar cama como DIRTY.
        if (activeAssignment) {
          await tx.bedAssignment.update({
            where: { id: activeAssignment.id },
            data: { releasedAt: new Date() },
          });
          await tx.bed.update({
            where: { id: activeAssignment.bedId },
            data: { status: "DIRTY" },
          });
        }

        // 3) Validar cama destino si aplica.
        if (input.toBedId) {
          const bed = await tx.bed.findFirst({
            where: {
              id: input.toBedId,
              organizationId: ctx.tenant.organizationId,
              active: true,
            },
          });
          if (!bed) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Cama destino no encontrada.",
            });
          }
          if (bed.status !== "FREE") {
            throw new TRPCError({
              code: "CONFLICT",
              message: `La cama ${bed.code} no está disponible (${bed.status}).`,
            });
          }
          if (bed.serviceUnitId !== input.toServiceUnitId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "La cama destino no pertenece al servicio destino seleccionado.",
            });
          }
        }

        // 4) Registrar transferencia.
        const transfer = await tx.encounterTransfer.create({
          data: {
            encounterId: enc.id,
            fromServiceId: fromServiceId ?? undefined,
            toServiceId: input.toServiceUnitId,
            fromBedId: fromBedId ?? undefined,
            toBedId: input.toBedId,
            reason: input.reason,
            createdBy: ctx.user.id,
          },
        });

        // 5) Crear nuevo BedAssignment y ocupar cama destino.
        if (input.toBedId) {
          await tx.bedAssignment.create({
            data: {
              encounterId: enc.id,
              bedId: input.toBedId,
              reason: `Traslado: ${input.reason}`,
              createdBy: ctx.user.id,
            },
          });
          await tx.bed.update({
            where: { id: input.toBedId },
            data: { status: "OCCUPIED" },
          });
        }

        // 6) Actualizar serviceUnit del encuentro.
        await tx.encounter.update({
          where: { id: enc.id },
          data: {
            serviceUnitId: input.toServiceUnitId,
            updatedBy: ctx.user.id,
          },
        });

        return transfer;
      });
    }),

  /** Histórico de traslados de un encuentro (orden cronológico). */
  listByEncounter: tenantProcedure
    .input(listTransfersByEncounterInput)
    .query(async ({ ctx, input }) => {
      // Verifica pertenencia del encuentro al tenant.
      const enc = await ctx.prisma.encounter.findFirst({
        where: {
          id: input.encounterId,
          organizationId: ctx.tenant.organizationId,
        },
        select: { id: true },
      });
      if (!enc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Encuentro no encontrado.",
        });
      }
      return ctx.prisma.encounterTransfer.findMany({
        where: { encounterId: input.encounterId },
        orderBy: { occurredAt: "asc" },
      });
    }),

  /**
   * Listado paginado de traslados recientes de la organización para el
   * tablero `/transfers`. Filtro opcional por servicio destino.
   */
  listRecent: tenantProcedure
    .input(listRecentTransfersInput)
    .query(async ({ ctx, input }) => {
      const where = {
        encounter: { organizationId: ctx.tenant.organizationId },
        ...(input.serviceUnitId
          ? { toServiceId: input.serviceUnitId }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.encounterTransfer.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: { occurredAt: "desc" },
          include: {
            encounter: {
              select: {
                id: true,
                encounterNumber: true,
                patient: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    mrn: true,
                  },
                },
              },
            },
          },
        }),
        ctx.prisma.encounterTransfer.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }),
});
