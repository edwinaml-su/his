/**
 * §10 Outpatient — router con hardening layer 1 (Beta.7).
 *
 * Reglas:
 *  1. State machine AppointmentStatus con transiciones validadas.
 *  2. Double-booking detection por provider al crear/reprogramar.
 *  3. No-show detection: detectNoShows (dryRun o commit).
 *  4. Consultation linked to appointment: bloquea si appointment no esta
 *     en CHECKED_IN/COMPLETED. Walk-in (appointmentId null) permitido.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  outpatientAppointmentCreateInput,
  outpatientAppointmentUpdateInput,
  outpatientAppointmentListInput,
  outpatientAppointmentCancelInput,
  noShowDetectInput,
  outpatientConsultationCreateInput,
  ALLOWED_TRANSITIONS,
  type AppointmentStatusType,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";
import type { PrismaClient } from "@prisma/client";
import {
  isOutOfServiceUnitScope,
  serviceUnitWhereFragment,
} from "../lib/service-unit-scope";

async function detectAppointmentConflict(
  prisma: PrismaClient,
  organizationId: string,
  providerId: string,
  scheduledAt: Date,
  durationMinutes: number,
  excludeId?: string,
): Promise<boolean> {
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60_000);

  const conflicting = await prisma.outpatientAppointment.findFirst({
    where: {
      organizationId,
      providerId,
      deletedAt: null,
      status: { notIn: ["CANCELLED"] },
      scheduledAt: {
        lt: endAt,
        gte: new Date(scheduledAt.getTime() - 180 * 60_000),
      },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, scheduledAt: true, durationMinutes: true },
  });

  if (!conflicting) return false;

  const existingEnd = new Date(
    conflicting.scheduledAt.getTime() + conflicting.durationMinutes * 60_000,
  );
  return existingEnd > scheduledAt;
}

async function detectNoShowCandidates(
  prisma: PrismaClient,
  organizationId: string,
  thresholdMinutes: number,
): Promise<Array<{ id: string; scheduledAt: Date; providerId: string; patientId: string }>> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000);
  return prisma.outpatientAppointment.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      scheduledAt: { lt: cutoff },
    },
    select: { id: true, scheduledAt: true, providerId: true, patientId: true },
    orderBy: { scheduledAt: "asc" },
  });
}

export const outpatientRouter = router({
  appointment: router({
    list: tenantProcedure
      .input(outpatientAppointmentListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.outpatientAppointment.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
            // Nivel B — restringe a citas del servicio del usuario; incluye
            // nulls porque appointment.serviceUnitId todavía no se popula
            // siempre desde la UI (es opcional al crear).
            ...serviceUnitWhereFragment(ctx.tenant, "serviceUnitId", {
              includeNullable: true,
            }),
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
          where: { id: input.id, organizationId: ctx.tenant.organizationId, deletedAt: null },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    create: tenantProcedure
      .input(outpatientAppointmentCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Nivel B — si vino serviceUnitId, debe pertenecer al scope del usuario.
        if (input.serviceUnitId && isOutOfServiceUnitScope(ctx.tenant, input.serviceUnitId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "El servicio seleccionado no está en tus asignaciones.",
          });
        }
        const hasConflict = await detectAppointmentConflict(
          ctx.prisma,
          ctx.tenant.organizationId,
          input.providerId,
          input.scheduledAt,
          input.durationMinutes,
        );
        if (hasConflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "El proveedor ya tiene una cita en ese intervalo de tiempo.",
          });
        }

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
            reasonCategory: input.reasonCategory ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    update: tenantProcedure
      .input(outpatientAppointmentUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const { id, status: newStatus, scheduledAt, durationMinutes, ...rest } = input;

        if (newStatus !== undefined) {
          const current = await ctx.prisma.outpatientAppointment.findFirst({
            where: { id, organizationId: ctx.tenant.organizationId, deletedAt: null },
            select: { status: true, providerId: true, scheduledAt: true, durationMinutes: true },
          });
          if (!current) throw new TRPCError({ code: "NOT_FOUND" });

          const allowed = ALLOWED_TRANSITIONS[current.status as AppointmentStatusType];
          if (!allowed.includes(newStatus)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Transicion invalida: ${current.status} -> ${newStatus}. Permitidas: ${allowed.join(", ") || "ninguna (estado terminal)"}`,
            });
          }

          if (scheduledAt !== undefined || durationMinutes !== undefined) {
            const eff = scheduledAt ?? current.scheduledAt;
            const dur = durationMinutes ?? current.durationMinutes;
            const hasConflict = await detectAppointmentConflict(
              ctx.prisma, ctx.tenant.organizationId, current.providerId, eff, dur, id,
            );
            if (hasConflict) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "El proveedor ya tiene una cita en ese intervalo de tiempo.",
              });
            }
          }
        } else if (scheduledAt !== undefined || durationMinutes !== undefined) {
          const current = await ctx.prisma.outpatientAppointment.findFirst({
            where: { id, organizationId: ctx.tenant.organizationId, deletedAt: null },
            select: { providerId: true, scheduledAt: true, durationMinutes: true },
          });
          if (!current) throw new TRPCError({ code: "NOT_FOUND" });

          const eff = scheduledAt ?? current.scheduledAt;
          const dur = durationMinutes ?? current.durationMinutes;
          const hasConflict = await detectAppointmentConflict(
            ctx.prisma, ctx.tenant.organizationId, current.providerId, eff, dur, id,
          );
          if (hasConflict) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "El proveedor ya tiene una cita en ese intervalo de tiempo.",
            });
          }
        }

        const updated = await ctx.prisma.outpatientAppointment.updateMany({
          where: { id, organizationId: ctx.tenant.organizationId, deletedAt: null },
          data: {
            ...(newStatus !== undefined && { status: newStatus }),
            ...(scheduledAt !== undefined && { scheduledAt }),
            ...(durationMinutes !== undefined && { durationMinutes }),
            ...rest,
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      }),

    cancel: tenantProcedure
      .input(outpatientAppointmentCancelInput)
      .mutation(async ({ ctx, input }) => {
        const current = await ctx.prisma.outpatientAppointment.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId, deletedAt: null },
          select: { status: true },
        });
        if (!current) throw new TRPCError({ code: "NOT_FOUND" });

        const allowed = ALLOWED_TRANSITIONS[current.status as AppointmentStatusType];
        if (!allowed.includes("CANCELLED")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No se puede cancelar una cita en estado ${current.status}.`,
          });
        }

        const updated = await ctx.prisma.outpatientAppointment.updateMany({
          where: { id: input.id, organizationId: ctx.tenant.organizationId, deletedAt: null },
          data: { status: "CANCELLED", notes: input.reason, updatedBy: ctx.user.id },
        });
        if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      }),

    detectNoShows: tenantProcedure
      .input(noShowDetectInput)
      .mutation(async ({ ctx, input }) => {
        const candidates = await detectNoShowCandidates(
          ctx.prisma,
          ctx.tenant.organizationId,
          input.thresholdMinutes,
        );

        if (!input.commit) {
          return { count: candidates.length, candidates, committed: false };
        }

        if (candidates.length > 0) {
          await ctx.prisma.outpatientAppointment.updateMany({
            where: {
              id: { in: candidates.map((c) => c.id) },
              organizationId: ctx.tenant.organizationId,
            },
            data: { status: "NO_SHOW", updatedBy: ctx.user.id },
          });
        }

        return { count: candidates.length, candidates, committed: true };
      }),
  }),

  consultation: router({
    create: tenantProcedure
      .input(outpatientConsultationCreateInput)
      .mutation(async ({ ctx, input }) => {
        const enc = await ctx.prisma.encounter.findFirst({
          where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
          select: { id: true },
        });
        if (!enc) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Encuentro no existe en la organizacion." });
        }

        if (input.appointmentId !== undefined) {
          const appt = await ctx.prisma.outpatientAppointment.findFirst({
            where: {
              id: input.appointmentId,
              organizationId: ctx.tenant.organizationId,
              deletedAt: null,
            },
            select: { status: true },
          });
          if (!appt) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Cita no encontrada." });
          }
          if (appt.status !== "CHECKED_IN" && appt.status !== "COMPLETED") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `La consulta solo puede crearse cuando la cita esta en CHECKED_IN o COMPLETED. Estado actual: ${appt.status}`,
            });
          }
        }

        return ctx.prisma.outpatientConsultation.create({
          data: {
            appointmentId: input.appointmentId ?? null,
            encounterId: input.encounterId,
            reasonOfVisit: input.reasonOfVisit,
            reasonCategory: input.reasonCategory ?? null,
            subjective: input.subjective ?? null,
            objective: input.objective ?? null,
            assessment: input.assessment ?? null,
            plan: input.plan ?? null,
          },
        });
      }),
  }),
});