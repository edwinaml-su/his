/**
 * §10 Outpatient — router skeleton (Sprint 4 / Phase 2 entry).
 *
 * Cobertura mínima para destrabar UI y typecheck. Reglas de negocio finas
 * (overlap detection, prevención doble-booking, no-show automation) van en
 * iteración posterior cuando haya volumen.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  outpatientAppointmentCreateInput,
  outpatientAppointmentUpdateInput,
  outpatientAppointmentListInput,
  outpatientAppointmentCancelInput,
  outpatientConsultationCreateInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const outpatientRouter = router({
  appointment: router({
    list: tenantProcedure
      .input(outpatientAppointmentListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.outpatientAppointment.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
            ...(input.providerId && { providerId: input.providerId }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.status && { status: input.status }),
            ...(input.fromDate || input.toDate
              ? {
                  scheduledAt: {
                    ...(input.fromDate && { gte: input.fromDate }),
                    ...(input.toDate && { lte: input.toDate }),
                  },
                }
              : {}),
          },
          include: {
            patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
            provider: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { scheduledAt: "asc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.outpatientAppointment.findFirst({
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
      .input(outpatientAppointmentCreateInput)
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.outpatientAppointment.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            establishmentId: input.establishmentId,
            patientId: input.patientId,
            providerId: input.providerId,
            specialtyId: input.specialtyId ?? null,
            serviceUnitId: input.serviceUnitId ?? null,
            scheduledAt: input.scheduledAt,
            durationMinutes: input.durationMinutes,
            reason: input.reason ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    update: tenantProcedure
      .input(outpatientAppointmentUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const updated = await ctx.prisma.outpatientAppointment.updateMany({
          where: {
            id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          data: { ...data, updatedBy: ctx.user.id },
        });
        if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      }),

    cancel: tenantProcedure
      .input(outpatientAppointmentCancelInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.outpatientAppointment.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          data: {
            status: "CANCELLED",
            notes: input.reason,
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      }),
  }),

  consultation: router({
    create: tenantProcedure
      .input(outpatientConsultationCreateInput)
      .mutation(async ({ ctx, input }) => {
        const enc = await ctx.prisma.encounter.findFirst({
          where: {
            id: input.encounterId,
            organizationId: ctx.tenant.organizationId,
          },
          select: { id: true },
        });
        if (!enc) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Encuentro no existe en la organización." });
        }
        return ctx.prisma.outpatientConsultation.create({
          data: {
            appointmentId: input.appointmentId ?? null,
            encounterId: input.encounterId,
            reasonOfVisit: input.reasonOfVisit,
            subjective: input.subjective ?? null,
            objective: input.objective ?? null,
            assessment: input.assessment ?? null,
            plan: input.plan ?? null,
          },
        });
      }),
  }),
});
