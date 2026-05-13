/**
 * §12 Emergency — router skeleton (Wave 7 / Phase 2 entry).
 *
 * Cobertura mínima: visit CRUD + observation start/end + notes + disposition.
 * Reglas LWBS automáticas (timeout sin doctor), escalación y handoff
 * a inpatient van en iteraciones siguientes.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  emergencyVisitCreateInput,
  emergencyVisitListInput,
  emergencyVisitDispositionInput,
  emergencyVisitStartObservationInput,
  emergencyVisitEndObservationInput,
  emergencyNoteCreateInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const emergencyRouter = router({
  visit: router({
    list: tenantProcedure
      .input(emergencyVisitListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.emergencyVisit.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
            ...(input.disposition && { disposition: input.disposition }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.treatingId && { treatingId: input.treatingId }),
            ...(input.establishmentId && {
              establishmentId: input.establishmentId,
            }),
            ...((input.fromDate || input.toDate) && {
              arrivedAt: {
                ...(input.fromDate && { gte: input.fromDate }),
                ...(input.toDate && { lte: input.toDate }),
              },
            }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
          },
          orderBy: { arrivedAt: "desc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.emergencyVisit.findFirst({
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
      .input(emergencyVisitCreateInput)
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
        return ctx.prisma.emergencyVisit.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            establishmentId: input.establishmentId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            chiefComplaint: input.chiefComplaint,
            arrivalMode: input.arrivalMode,
            treatingId: input.treatingId ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    setDisposition: tenantProcedure
      .input(emergencyVisitDispositionInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.emergencyVisit.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          data: {
            disposition: input.disposition,
            dispositionAt: new Date(),
            ...(input.notes && { notes: input.notes }),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      }),

    startObservation: tenantProcedure
      .input(emergencyVisitStartObservationInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.emergencyVisit.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            observationStartedAt: null,
            deletedAt: null,
          },
          data: {
            observationStartedAt: new Date(),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Visita no existe u observación ya iniciada.",
          });
        }
        return { ok: true as const };
      }),

    endObservation: tenantProcedure
      .input(emergencyVisitEndObservationInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.emergencyVisit.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            observationStartedAt: { not: null },
            observationEndedAt: null,
            deletedAt: null,
          },
          data: {
            observationEndedAt: new Date(),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Visita no existe, sin observación abierta.",
          });
        }
        return { ok: true as const };
      }),
  }),

  note: router({
    create: tenantProcedure
      .input(emergencyNoteCreateInput)
      .mutation(async ({ ctx, input }) => {
        const visit = await ctx.prisma.emergencyVisit.findFirst({
          where: {
            id: input.visitId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!visit) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Visita no existe en la organización.",
          });
        }
        return ctx.prisma.emergencyNote.create({
          data: {
            visitId: input.visitId,
            recordedById: ctx.user.id,
            category: input.category,
            body: input.body,
          },
        });
      }),

    listByVisit: tenantProcedure
      .input(z.object({ visitId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }))
      .query(async ({ ctx, input }) => {
        return ctx.prisma.emergencyNote.findMany({
          where: {
            visitId: input.visitId,
            visit: { organizationId: ctx.tenant.organizationId },
          },
          orderBy: { recordedAt: "desc" },
          take: input.limit,
        });
      }),
  }),
});
