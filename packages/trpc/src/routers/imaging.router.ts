/**
 * §18 RIS/PACS — router skeleton (Wave 7 / Phase 2 entry).
 *
 * Cobertura mínima: modality catalog + order CRUD + status transitions + report.
 * Integración real DICOM (accession assignment, modality worklist) y firma
 * radiológica con cert van en iteraciones siguientes.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  imagingModalityCreateInput,
  imagingModalityListInput,
  imagingOrderCreateInput,
  imagingOrderListInput,
  imagingOrderUpdateStatusInput,
  imagingOrderCancelInput,
  imagingReportCreateInput,
  imagingReportSignInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const imagingRouter = router({
  modality: router({
    /**
     * Lista modalidades del tenant. Modality cuelga de Establishment.
     */
    list: tenantProcedure
      .input(imagingModalityListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.imagingModality.findMany({
          where: {
            establishment: { organizationId: ctx.tenant.organizationId },
            ...(input.establishmentId && {
              establishmentId: input.establishmentId,
            }),
            ...(input.modalityType && { modalityType: input.modalityType }),
            ...(input.activeOnly && { active: true }),
          },
          orderBy: { code: "asc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(imagingModalityCreateInput)
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
        return ctx.prisma.imagingModality.create({
          data: {
            establishmentId: input.establishmentId,
            code: input.code,
            name: input.name,
            modalityType: input.modalityType,
            aeTitle: input.aeTitle ?? null,
          },
        });
      }),
  }),

  order: router({
    list: tenantProcedure
      .input(imagingOrderListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.imagingOrder.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
            ...(input.status && { status: input.status }),
            ...(input.priority && { priority: input.priority }),
            ...(input.modalityType && { modalityType: input.modalityType }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.encounterId && { encounterId: input.encounterId }),
            ...(input.establishmentId && {
              establishmentId: input.establishmentId,
            }),
            ...((input.fromDate || input.toDate) && {
              createdAt: {
                ...(input.fromDate && { gte: input.fromDate }),
                ...(input.toDate && { lte: input.toDate }),
              },
            }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            orderingProvider: { select: { id: true, fullName: true } },
            modality: { select: { id: true, code: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.imagingOrder.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          include: { report: true },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    create: tenantProcedure
      .input(imagingOrderCreateInput)
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
        return ctx.prisma.imagingOrder.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            establishmentId: input.establishmentId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            modalityId: input.modalityId ?? null,
            modalityType: input.modalityType,
            orderingProviderId: ctx.user.id,
            studyDescription: input.studyDescription,
            bodySite: input.bodySite ?? null,
            clinicalIndication: input.clinicalIndication,
            priority: input.priority,
            scheduledAt: input.scheduledAt ?? null,
            notes: input.notes ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    updateStatus: tenantProcedure
      .input(imagingOrderUpdateStatusInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.imagingOrder.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          data: {
            status: input.status,
            ...(input.accessionNumber && { accessionNumber: input.accessionNumber }),
            ...(input.status === "ACQUIRED" && { acquiredAt: new Date() }),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      }),

    cancel: tenantProcedure
      .input(imagingOrderCancelInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.imagingOrder.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["ORDERED", "SCHEDULED"] },
            deletedAt: null,
          },
          data: {
            status: "CANCELLED",
            notes: input.reason,
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden no existe o ya fue adquirida.",
          });
        }
        return { ok: true as const };
      }),
  }),

  report: router({
    create: tenantProcedure
      .input(imagingReportCreateInput)
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.imagingOrder.findFirst({
          where: {
            id: input.orderId,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["ACQUIRED", "REPORTED"] },
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden no existe o no está en estado reportable.",
          });
        }
        return ctx.prisma.imagingReport.upsert({
          where: { orderId: input.orderId },
          create: {
            orderId: input.orderId,
            radiologistId: ctx.user.id,
            findings: input.findings,
            impression: input.impression,
            recommendation: input.recommendation ?? null,
          },
          update: {
            findings: input.findings,
            impression: input.impression,
            recommendation: input.recommendation ?? null,
            amendedAt: new Date(),
          },
        });
      }),

    sign: tenantProcedure
      .input(imagingReportSignInput)
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.imagingOrder.findFirst({
          where: {
            id: input.orderId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        const updated = await ctx.prisma.imagingReport.updateMany({
          where: { orderId: input.orderId, signedAt: null },
          data: { signedAt: new Date() },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Reporte no existe o ya está firmado.",
          });
        }
        await ctx.prisma.imagingOrder.updateMany({
          where: { id: input.orderId, organizationId: ctx.tenant.organizationId },
          data: { status: "REPORTED", updatedBy: ctx.user.id },
        });
        return { ok: true as const };
      }),
  }),
});
