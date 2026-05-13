/**
 * §18 RIS/PACS — router (Wave 7 / Phase 2).
 * Beta.9 hardening layer 1:
 *   - State machine enforcement (VALID_STATUS_TRANSITIONS)
 *   - DICOM modality code validation on modality.create
 *   - imaging.getOverdueOrders: SLA-breach detection
 *   - report.validate: immutability lock endpoint
 *   - Radiation dose fields on updateStatus
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
  imagingReportValidateInput,
  VALID_STATUS_TRANSITIONS,
  SLA_MINUTES,
  type ImagingOrderStatusType,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const imagingRouter = router({
  modality: router({
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
            dicomCode: input.dicomCode ?? null,
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
        const order = await ctx.prisma.imagingOrder.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, status: true },
        });
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });

        const allowed = VALID_STATUS_TRANSITIONS[order.status as ImagingOrderStatusType];
        if (!allowed.includes(input.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Transición inválida: ${order.status} → ${input.status}.`,
          });
        }

        await ctx.prisma.imagingOrder.update({
          where: { id: input.id },
          data: {
            status: input.status,
            ...(input.accessionNumber && { accessionNumber: input.accessionNumber }),
            ...(input.status === "COMPLETED" && { completedAt: new Date() }),
            ...(input.radiationDoseDap != null && {
              radiationDoseDap: input.radiationDoseDap,
            }),
            ...(input.radiationDoseCtdi != null && {
              radiationDoseCtdi: input.radiationDoseCtdi,
            }),
            updatedBy: ctx.user.id,
          },
        });
        return { ok: true as const };
      }),

    cancel: tenantProcedure
      .input(imagingOrderCancelInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.imagingOrder.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            // Only cancellable before COMPLETED
            status: { in: ["ORDERED", "SCHEDULED", "IN_PROGRESS"] },
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
            message: "Orden no existe, ya fue completada, o ya estaba cancelada.",
          });
        }
        return { ok: true as const };
      }),

    /**
     * Returns orders where orderedAt + sla < now() and status not in
     * terminal states REPORTED / VALIDATED / CANCELLED.
     * SLA is derived from priority: STAT=60min, URGENT=240min, ROUTINE=1440min.
     */
    getOverdueOrders: tenantProcedure
      .input(
        z.object({
          establishmentId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .query(async ({ ctx, input }) => {
        const now = new Date();

        // Fetch active (non-terminal) orders; compute overdue in-process.
        // Trade-off: filtering SLA per-priority in SQL requires raw query or
        // multiple queries. We fetch active orders and filter in JS to keep
        // the code simple and avoid $queryRaw coupling — volume is bounded
        // by active workload per establishment.
        const activeOrders = await ctx.prisma.imagingOrder.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
            status: {
              notIn: ["REPORTED", "VALIDATED", "CANCELLED"],
            },
            ...(input.establishmentId && {
              establishmentId: input.establishmentId,
            }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            orderingProvider: { select: { id: true, fullName: true } },
          },
          orderBy: { orderedAt: "asc" },
          take: input.limit * 4, // over-fetch to account for filtering
        });

        const overdue = activeOrders.filter((o) => {
          const sla = SLA_MINUTES[o.priority as keyof typeof SLA_MINUTES];
          const deadline = new Date(o.orderedAt.getTime() + sla * 60_000);
          return deadline < now;
        });

        return overdue.slice(0, input.limit);
      }),
  }),

  report: router({
    create: tenantProcedure
      .input(imagingReportCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Check report not already validated (immutable)
        const existing = await ctx.prisma.imagingReport.findUnique({
          where: { orderId: input.orderId },
          select: { validatedAt: true },
        });
        if (existing?.validatedAt) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "El reporte ya fue validado y es inmutable.",
          });
        }

        const order = await ctx.prisma.imagingOrder.findFirst({
          where: {
            id: input.orderId,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["COMPLETED", "REPORTED"] },
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden no existe o no está en estado reportable (COMPLETED/REPORTED).",
          });
        }
        const report = await ctx.prisma.imagingReport.upsert({
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
        // Promote order to REPORTED on first report creation
        await ctx.prisma.imagingOrder.updateMany({
          where: {
            id: input.orderId,
            organizationId: ctx.tenant.organizationId,
            status: "COMPLETED",
          },
          data: { status: "REPORTED", updatedBy: ctx.user.id },
        });
        return report;
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
        return { ok: true as const };
      }),

    /**
     * Validates a signed report, promoting the order to VALIDATED.
     * After validation the DB trigger blocks any further UPDATE/DELETE on the report.
     */
    validate: tenantProcedure
      .input(imagingReportValidateInput)
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.imagingOrder.findFirst({
          where: {
            id: input.orderId,
            organizationId: ctx.tenant.organizationId,
            status: "REPORTED",
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden no existe o no está en estado REPORTED.",
          });
        }
        const updated = await ctx.prisma.imagingReport.updateMany({
          where: { orderId: input.orderId, signedAt: { not: null }, validatedAt: null },
          data: { validatedAt: new Date() },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "El reporte debe estar firmado antes de validar, o ya fue validado.",
          });
        }
        await ctx.prisma.imagingOrder.updateMany({
          where: { id: input.orderId, organizationId: ctx.tenant.organizationId },
          data: { status: "VALIDATED", updatedBy: ctx.user.id },
        });
        return { ok: true as const };
      }),
  }),
});
