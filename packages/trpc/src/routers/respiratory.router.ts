/**
 * §21 Respiratory — router skeleton (Wave 8 / Phase 2 entry).
 *
 * Cobertura mínima:
 *   - RespiratoryOrder workflow create → complete | cancel.
 *   - VentilatorSession asociada a la orden.
 *   - MedicalGasUsage (auditoría de consumo).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  respiratoryOrderCreateInput,
  respiratoryOrderListInput,
  respiratoryOrderCompleteInput,
  respiratoryOrderCancelInput,
  ventilatorSessionCreateInput,
  ventilatorSessionEndInput,
  ventilatorSessionListInput,
  medicalGasUsageCreateInput,
  medicalGasUsageListInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const respiratoryRouter = router({
  order: router({
    list: tenantProcedure
      .input(respiratoryOrderListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.respiratoryOrder.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.encounterId && { encounterId: input.encounterId }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.status && { status: input.status }),
            ...(input.type && { type: input.type }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            prescriber: { select: { id: true, fullName: true } },
          },
          orderBy: { startedAt: "desc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.respiratoryOrder.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    create: tenantProcedure
      .input(respiratoryOrderCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Encounter del tenant + patient coincide.
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
        return ctx.prisma.respiratoryOrder.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            prescriberId: input.prescriberId,
            type: input.type,
            flowRate: input.flowRate ?? null,
            fio2: input.fio2 ?? null,
            notes: input.notes ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    complete: tenantProcedure
      .input(respiratoryOrderCompleteInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.respiratoryOrder.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["ACTIVE", "ON_HOLD"] },
          },
          data: {
            status: "COMPLETED",
            endedAt: new Date(),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden no existe o ya está cerrada.",
          });
        }
        return { ok: true as const };
      }),

    cancel: tenantProcedure
      .input(respiratoryOrderCancelInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.respiratoryOrder.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["ACTIVE", "ON_HOLD"] },
          },
          data: {
            status: "CANCELLED",
            endedAt: new Date(),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden no existe o ya está cerrada.",
          });
        }
        return { ok: true as const };
      }),
  }),

  ventilator: router({
    list: tenantProcedure
      .input(ventilatorSessionListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.ventilatorSession.findMany({
          where: {
            order: { organizationId: ctx.tenant.organizationId },
            ...(input.orderId && { orderId: input.orderId }),
          },
          orderBy: { startedAt: "desc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(ventilatorSessionCreateInput)
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.respiratoryOrder.findFirst({
          where: {
            id: input.orderId,
            organizationId: ctx.tenant.organizationId,
            type: "MECHANICAL_VENT",
            status: "ACTIVE",
          },
          select: { id: true },
        });
        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden de ventilación mecánica activa no encontrada.",
          });
        }
        return ctx.prisma.ventilatorSession.create({
          data: {
            orderId: input.orderId,
            mode: input.mode,
            tidalVolume: input.tidalVolume ?? null,
            rrSet: input.rrSet ?? null,
            peep: input.peep ?? null,
            fio2: input.fio2 ?? null,
            notes: input.notes ?? null,
          },
        });
      }),

    end: tenantProcedure
      .input(ventilatorSessionEndInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.ventilatorSession.updateMany({
          where: {
            id: input.id,
            order: { organizationId: ctx.tenant.organizationId },
            endedAt: null,
          },
          data: { endedAt: new Date() },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sesión no existe o ya finalizada.",
          });
        }
        return { ok: true as const };
      }),
  }),

  gas: router({
    list: tenantProcedure
      .input(medicalGasUsageListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.medicalGasUsage.findMany({
          where: {
            order: { organizationId: ctx.tenant.organizationId },
            ...(input.orderId && { orderId: input.orderId }),
            ...(input.gasType && { gasType: input.gasType }),
            ...((input.fromDate || input.toDate) && {
              measuredAt: {
                ...(input.fromDate && { gte: input.fromDate }),
                ...(input.toDate && { lte: input.toDate }),
              },
            }),
          },
          orderBy: { measuredAt: "desc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(medicalGasUsageCreateInput)
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.respiratoryOrder.findFirst({
          where: {
            id: input.orderId,
            organizationId: ctx.tenant.organizationId,
          },
          select: { id: true },
        });
        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden respiratoria no existe en la organización.",
          });
        }
        return ctx.prisma.medicalGasUsage.create({
          data: {
            orderId: input.orderId,
            gasType: input.gasType,
            volumeLiters: input.volumeLiters,
            recordedById: ctx.user.id,
            notes: input.notes ?? null,
          },
        });
      }),
  }),
});
