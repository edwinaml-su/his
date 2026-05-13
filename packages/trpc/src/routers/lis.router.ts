/**
 * §17 LIS — router skeleton (Sprint 4 / Phase 4 entry).
 *
 * Cobertura mínima: panel/test catalog + order create/list +
 * specimen collect/reject + result enter/validate (con regla 4-eyes).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  labPanelListInput,
  labTestListInput,
  labOrderCreateInput,
  labOrderListInput,
  specimenCollectInput,
  specimenRejectInput,
  resultEnterInput,
  resultValidateInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const lisRouter = router({
  panel: router({
    list: tenantProcedure.input(labPanelListInput).query(async ({ ctx, input }) => {
      return ctx.prisma.labPanel.findMany({
        where: {
          OR: [
            { organizationId: null },
            { organizationId: ctx.tenant.organizationId },
          ],
          ...(input.activeOnly && { active: true }),
          ...(input.search && {
            OR: [
              { code: { contains: input.search, mode: "insensitive" } },
              { name: { contains: input.search, mode: "insensitive" } },
            ],
          }),
        },
        orderBy: { name: "asc" },
        take: input.limit,
      });
    }),
  }),

  test: router({
    list: tenantProcedure.input(labTestListInput).query(async ({ ctx, input }) => {
      return ctx.prisma.labTest.findMany({
        where: {
          OR: [
            { organizationId: null },
            { organizationId: ctx.tenant.organizationId },
          ],
          ...(input.panelId && { panelId: input.panelId }),
          ...(input.activeOnly && { active: true }),
          ...(input.search && {
            OR: [
              { code: { contains: input.search, mode: "insensitive" } },
              { name: { contains: input.search, mode: "insensitive" } },
            ],
          }),
        },
        orderBy: { name: "asc" },
        take: input.limit,
      });
    }),
  }),

  order: router({
    list: tenantProcedure.input(labOrderListInput).query(async ({ ctx, input }) => {
      return ctx.prisma.labOrder.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          ...(input.encounterId && { encounterId: input.encounterId }),
          ...(input.patientId && { patientId: input.patientId }),
          ...(input.priority && { priority: input.priority }),
          ...(input.status && { status: input.status }),
          ...(input.fromDate && { orderedAt: { gte: input.fromDate } }),
        },
        include: { items: { include: { test: true } } },
        orderBy: { orderedAt: "desc" },
        take: input.limit,
      });
    }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const o = await ctx.prisma.labOrder.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          include: {
            items: { include: { test: true, results: true } },
            specimens: true,
          },
        });
        if (!o) throw new TRPCError({ code: "NOT_FOUND" });
        return o;
      }),

    create: tenantProcedure.input(labOrderCreateInput).mutation(async ({ ctx, input }) => {
      const enc = await ctx.prisma.encounter.findFirst({
        where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
        select: { id: true, patientId: true },
      });
      if (!enc) throw new TRPCError({ code: "NOT_FOUND", message: "Encuentro no existe en la organización." });
      if (enc.patientId !== input.patientId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "patientId no coincide con encounter." });
      }
      return ctx.prisma.labOrder.create({
        data: {
          organizationId: ctx.tenant.organizationId,
          encounterId: input.encounterId,
          patientId: input.patientId,
          prescriberId: ctx.user.id,
          priority: input.priority,
          status: "ORDERED",
          clinicalIndication: input.clinicalIndication ?? null,
          items: {
            create: input.items.map((i) => ({ testId: i.testId, notes: i.notes ?? null })),
          },
        },
        include: { items: true },
      });
    }),
  }),

  specimen: router({
    collect: tenantProcedure.input(specimenCollectInput).mutation(async ({ ctx, input }) => {
      // Verifica que la orden pertenezca a la tenant.
      const order = await ctx.prisma.labOrder.findFirst({
        where: { id: input.orderId, organizationId: ctx.tenant.organizationId },
        select: { id: true },
      });
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.labSpecimen.create({
        data: {
          orderId: input.orderId,
          type: input.type,
          barcode: input.barcode,
          collectedAt: input.collectedAt ?? new Date(),
          collectedById: ctx.user.id,
          condition: "ACCEPTABLE",
        },
      });
    }),

    reject: tenantProcedure.input(specimenRejectInput).mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.labSpecimen.updateMany({
        where: {
          id: input.id,
          order: { organizationId: ctx.tenant.organizationId },
        },
        data: { condition: "REJECTED", rejectionReason: input.rejectionReason },
      });
      if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),
  }),

  result: router({
    enter: tenantProcedure.input(resultEnterInput).mutation(async ({ ctx, input }) => {
      const item = await ctx.prisma.labOrderItem.findFirst({
        where: {
          id: input.orderItemId,
          order: { organizationId: ctx.tenant.organizationId },
        },
        select: { id: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.labResult.create({
        data: {
          orderItemId: input.orderItemId,
          specimenId: input.specimenId ?? null,
          resultedById: ctx.user.id,
          valueNumeric: input.valueNumeric ?? null,
          valueText: input.valueText ?? null,
          valueUnit: input.valueUnit ?? null,
          flag: input.flag,
          notes: input.notes ?? null,
        },
      });
    }),

    validate: tenantProcedure.input(resultValidateInput).mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.labResult.findFirst({
        where: {
          id: input.resultId,
          orderItem: { order: { organizationId: ctx.tenant.organizationId } },
          validatedAt: null,
        },
        select: { id: true, resultedById: true },
      });
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Resultado no existe o ya validado." });
      }
      // Regla 4-eyes: el que valida debe ser distinto del que ingresó.
      if (result.resultedById === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "El validador debe ser distinto del que ingresó el resultado.",
        });
      }
      return ctx.prisma.labResult.update({
        where: { id: input.resultId },
        data: { validatedAt: new Date(), validatedById: ctx.user.id },
      });
    }),
  }),
});
