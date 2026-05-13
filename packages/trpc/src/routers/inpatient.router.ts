/**
 * §11 Inpatient — router skeleton (Wave 7 / Phase 2 entry).
 *
 * Cobertura mínima: admission CRUD + vitals + kardex + care plans. Reglas
 * de transición fina (LOS automático, alta vs muerte, escalación de cuidados)
 * van en iteraciones siguientes cuando haya carga clínica real.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  inpatientAdmissionCreateInput,
  inpatientAdmissionListInput,
  inpatientAdmissionDischargeInput,
  inpatientVitalsRecordInput,
  inpatientKardexCreateInput,
  inpatientCarePlanCreateInput,
  inpatientCarePlanUpdateStatusInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const inpatientRouter = router({
  admission: router({
    list: tenantProcedure
      .input(inpatientAdmissionListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.inpatientAdmission.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
            ...(input.status && { status: input.status }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.attendingId && { attendingId: input.attendingId }),
            ...(input.establishmentId && {
              establishmentId: input.establishmentId,
            }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            attending: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { admittedAt: "desc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.inpatientAdmission.findFirst({
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
      .input(inpatientAdmissionCreateInput)
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
        return ctx.prisma.inpatientAdmission.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            establishmentId: input.establishmentId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            attendingId: input.attendingId,
            reason: input.reason,
            expectedLos: input.expectedLos ?? null,
            notes: input.notes ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    discharge: tenantProcedure
      .input(inpatientAdmissionDischargeInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.inpatientAdmission.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: "ACTIVE",
            deletedAt: null,
          },
          data: {
            status: "DISCHARGED",
            dischargedAt: new Date(),
            ...(input.notes && { notes: input.notes }),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Admisión no existe o no está activa.",
          });
        }
        return { ok: true as const };
      }),
  }),

  vitals: router({
    record: tenantProcedure
      .input(inpatientVitalsRecordInput)
      .mutation(async ({ ctx, input }) => {
        const adm = await ctx.prisma.inpatientAdmission.findFirst({
          where: {
            id: input.admissionId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!adm) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Admisión no existe en la organización.",
          });
        }
        return ctx.prisma.inpatientVitals.create({
          data: {
            admissionId: input.admissionId,
            recordedById: ctx.user.id,
            temperatureC: input.temperatureC ?? null,
            heartRate: input.heartRate ?? null,
            respiratoryRate: input.respiratoryRate ?? null,
            systolicBp: input.systolicBp ?? null,
            diastolicBp: input.diastolicBp ?? null,
            spo2: input.spo2 ?? null,
            painScale: input.painScale ?? null,
            notes: input.notes ?? null,
          },
        });
      }),

    listByAdmission: tenantProcedure
      .input(z.object({ admissionId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }))
      .query(async ({ ctx, input }) => {
        return ctx.prisma.inpatientVitals.findMany({
          where: {
            admissionId: input.admissionId,
            admission: { organizationId: ctx.tenant.organizationId },
          },
          orderBy: { recordedAt: "desc" },
          take: input.limit,
        });
      }),
  }),

  kardex: router({
    create: tenantProcedure
      .input(inpatientKardexCreateInput)
      .mutation(async ({ ctx, input }) => {
        const adm = await ctx.prisma.inpatientAdmission.findFirst({
          where: {
            id: input.admissionId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!adm) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Admisión no existe en la organización.",
          });
        }
        return ctx.prisma.inpatientKardex.create({
          data: {
            admissionId: input.admissionId,
            recordedById: ctx.user.id,
            category: input.category,
            entry: input.entry,
            shift: input.shift ?? null,
          },
        });
      }),
  }),

  carePlan: router({
    create: tenantProcedure
      .input(inpatientCarePlanCreateInput)
      .mutation(async ({ ctx, input }) => {
        const adm = await ctx.prisma.inpatientAdmission.findFirst({
          where: {
            id: input.admissionId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!adm) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Admisión no existe en la organización.",
          });
        }
        return ctx.prisma.inpatientCarePlan.create({
          data: {
            admissionId: input.admissionId,
            title: input.title,
            goal: input.goal ?? null,
            interventions: input.interventions ?? null,
            createdById: ctx.user.id,
          },
        });
      }),

    updateStatus: tenantProcedure
      .input(inpatientCarePlanUpdateStatusInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.inpatientCarePlan.updateMany({
          where: {
            id: input.id,
            admission: { organizationId: ctx.tenant.organizationId },
          },
          data: {
            status: input.status,
            ...(input.status === "COMPLETED" && { completedAt: new Date() }),
          },
        });
        if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      }),
  }),
});
