/**
 * §13 Surgery — router skeleton (Wave 7 / Phase 2 entry).
 *
 * Cobertura mínima: OR catalog + case schedule + time-out + start + complete + cancel.
 * Detección de solapamiento de quirófano, validación de personal anestésico
 * y firma de check-list pre-op van en iteraciones siguientes.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  operatingRoomCreateInput,
  operatingRoomListInput,
  surgeryCaseCreateInput,
  surgeryCaseListInput,
  surgeryCaseTimeOutInput,
  surgeryCaseStartInput,
  surgeryCaseCompleteInput,
  surgeryCaseCancelInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const surgeryRouter = router({
  operatingRoom: router({
    /**
     * Lista quirófanos del tenant. El OR cuelga de Establishment (no de Organization
     * directamente) — se filtra a través de la relación.
     */
    list: tenantProcedure
      .input(operatingRoomListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.operatingRoom.findMany({
          where: {
            establishment: { organizationId: ctx.tenant.organizationId },
            ...(input.establishmentId && {
              establishmentId: input.establishmentId,
            }),
            ...(input.activeOnly && { active: true }),
          },
          orderBy: { code: "asc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(operatingRoomCreateInput)
      .mutation(async ({ ctx, input }) => {
        const est = await ctx.prisma.establishment.findFirst({
          where: {
            id: input.establishmentId,
            organizationId: ctx.tenant.organizationId,
          },
          select: { id: true },
        });
        if (!est) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Establecimiento no existe en la organización.",
          });
        }
        return ctx.prisma.operatingRoom.create({ data: input });
      }),
  }),

  case: router({
    list: tenantProcedure
      .input(surgeryCaseListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.surgeryCase.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
            ...(input.status && { status: input.status }),
            ...(input.primarySurgeonId && {
              primarySurgeonId: input.primarySurgeonId,
            }),
            ...(input.operatingRoomId && {
              operatingRoomId: input.operatingRoomId,
            }),
            ...(input.patientId && { patientId: input.patientId }),
            ...((input.fromDate || input.toDate) && {
              scheduledStart: {
                ...(input.fromDate && { gte: input.fromDate }),
                ...(input.toDate && { lte: input.toDate }),
              },
            }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            primarySurgeon: { select: { id: true, fullName: true } },
            operatingRoom: { select: { id: true, code: true, name: true } },
          },
          orderBy: { scheduledStart: "asc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.surgeryCase.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    create: tenantProcedure
      .input(surgeryCaseCreateInput)
      .mutation(async ({ ctx, input }) => {
        const enc = await ctx.prisma.encounter.findFirst({
          where: {
            id: input.encounterId,
            organizationId: ctx.tenant.organizationId,
          },
          select: { id: true, patientId: true },
        });
        if (!enc) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Encuentro no existe en la organización.",
          });
        }
        if (enc.patientId !== input.patientId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "patientId no coincide con encounter.",
          });
        }
        return ctx.prisma.surgeryCase.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            establishmentId: input.establishmentId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            primarySurgeonId: input.primarySurgeonId,
            operatingRoomId: input.operatingRoomId ?? null,
            procedureDescription: input.procedureDescription,
            procedureCode: input.procedureCode ?? null,
            scheduledStart: input.scheduledStart,
            scheduledEnd: input.scheduledEnd,
            asaClass: input.asaClass ?? null,
            preopNotes: input.preopNotes ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    timeOut: tenantProcedure
      .input(surgeryCaseTimeOutInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SCHEDULED", "CONFIRMED"] },
            deletedAt: null,
          },
          data: {
            timeOutAt: new Date(),
            timeOutById: ctx.user.id,
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Caso no existe o no está en estado válido para time-out.",
          });
        }
        return { ok: true as const };
      }),

    start: tenantProcedure
      .input(surgeryCaseStartInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SCHEDULED", "CONFIRMED"] },
            timeOutAt: { not: null },
            deletedAt: null,
          },
          data: {
            status: "IN_PROGRESS",
            actualStart: new Date(),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Caso no existe o falta time-out previo.",
          });
        }
        return { ok: true as const };
      }),

    complete: tenantProcedure
      .input(surgeryCaseCompleteInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: "IN_PROGRESS",
            deletedAt: null,
          },
          data: {
            status: "COMPLETED",
            actualEnd: new Date(),
            ...(input.intraopNotes && { intraopNotes: input.intraopNotes }),
            ...(input.postopNotes && { postopNotes: input.postopNotes }),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Caso no existe o no está IN_PROGRESS.",
          });
        }
        return { ok: true as const };
      }),

    cancel: tenantProcedure
      .input(surgeryCaseCancelInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SCHEDULED", "CONFIRMED"] },
            deletedAt: null,
          },
          data: {
            status: "CANCELLED",
            cancelReason: input.cancelReason,
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Caso no existe o ya inició.",
          });
        }
        return { ok: true as const };
      }),
  }),
});
