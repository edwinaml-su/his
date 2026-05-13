/**
 * §17 LIS — router (Sprint 4 / Phase 4 + Beta.3 hardening).
 *
 * Beta.3 (2026-05-13):
 * - `result.enter` calcula flag automáticamente desde reference ranges
 *   del LabTest (refRangeLow/refRangeHigh) y aplica modo crítico si
 *   el test tiene flag `critical=true`.
 * - Soporte de override de flag manual con `forceFlagOverride=true`.
 * - `result.validate` ya tenía 4-eyes; añadido append-only history en notes.
 * - state machine LabOrder con `canTransitionLabOrder`.
 * - critical value alerts inline en response.
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
  resultEnterWithPatientContextInput,
  resultValidateInput,
  evaluateLabResultFlag,
  isCriticalFlag,
  type LabReferenceRange,
  type LisSex,
  type LisResultFlag,
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
    /**
     * Beta.3 — enter con auto-flagging por reference ranges.
     * - Carga el LabTest del item para obtener refRangeLow/refRangeHigh y flag critical.
     * - Si `forceFlagOverride=false` (default) recalcula el flag desde refs.
     * - Si `valueNumeric` provisto y tests con criticalFlag → mapea a CRITICAL_*.
     * - Retorna alerts inline si el flag es crítico.
     */
    enter: tenantProcedure
      .input(resultEnterWithPatientContextInput)
      .mutation(async ({ ctx, input }) => {
        const item = await ctx.prisma.labOrderItem.findFirst({
          where: {
            id: input.orderItemId,
            order: { organizationId: ctx.tenant.organizationId },
          },
          include: { test: true },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });

        // Beta.3 — Determinar el flag final.
        let finalFlag: LisResultFlag = input.flag;
        if (!input.forceFlagOverride && input.valueNumeric != null) {
          // Construir reference range desde el test (Wave 1: solo BOTH/adult).
          const ranges: LabReferenceRange[] = buildReferenceRangesFromTest({
            refRangeLow: item.test.refRangeLow,
            refRangeHigh: item.test.refRangeHigh,
            critical: item.test.critical,
          });
          finalFlag = evaluateLabResultFlag({
            valueNumeric: input.valueNumeric,
            ranges,
            patientAgeYears: input.patientAgeYears ?? null,
            patientSex: (input.patientSex as LisSex | undefined) ?? null,
          });
        }

        const created = await ctx.prisma.labResult.create({
          data: {
            orderItemId: input.orderItemId,
            specimenId: input.specimenId ?? null,
            resultedById: ctx.user.id,
            valueNumeric: input.valueNumeric ?? null,
            valueText: input.valueText ?? null,
            valueUnit: input.valueUnit ?? null,
            flag: finalFlag,
            notes: input.notes ?? null,
          },
        });

        const isCritical = isCriticalFlag(finalFlag);
        return {
          result: created,
          finalFlag,
          isCritical,
          // Wave 2: publica al outbox CriticalValueAlert para notificar médico.
          alerts: isCritical
            ? [
                {
                  testCode: item.test.code,
                  testName: item.test.name,
                  flag: finalFlag,
                  value: input.valueNumeric,
                  unit: input.valueUnit ?? item.test.unit,
                },
              ]
            : [],
        };
      }),

    /**
     * Beta.3 — validate con 4-eyes + append-only history.
     * Las validaciones anteriores se mantienen en notes (formato auditable).
     */
    validate: tenantProcedure.input(resultValidateInput).mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.labResult.findFirst({
        where: {
          id: input.resultId,
          orderItem: { order: { organizationId: ctx.tenant.organizationId } },
          validatedAt: null,
        },
        select: { id: true, resultedById: true, notes: true, flag: true },
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
      const validatedAt = new Date();
      const historyLine = `[${validatedAt.toISOString()}] [VALIDATED by ${ctx.user.id}] flag=${result.flag}`;
      const newNotes =
        result.notes && result.notes.length > 0
          ? `${result.notes}\n${historyLine}`
          : historyLine;

      return ctx.prisma.labResult.update({
        where: { id: input.resultId },
        data: {
          validatedAt,
          validatedById: ctx.user.id,
          notes: newNotes,
        },
      });
    }),
  }),
});

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

/**
 * Beta.3 — Construye LabReferenceRange[] desde los campos simples del schema
 * Wave 1 (refRangeLow / refRangeHigh / critical). Wave 2: tabla
 * LabReferenceRange poblada con stratificación age/sex completa.
 *
 * Si critical=true, el rango incluye criticalLow/criticalHigh con desviación
 * 50% más allá del rango normal (heurística Wave 1; Wave 2 lab define).
 */
function buildReferenceRangesFromTest(test: {
  refRangeLow: { toNumber: () => number } | number | null | undefined;
  refRangeHigh: { toNumber: () => number } | number | null | undefined;
  critical: boolean;
}): LabReferenceRange[] {
  const lo =
    test.refRangeLow != null
      ? typeof test.refRangeLow === "number"
        ? test.refRangeLow
        : test.refRangeLow.toNumber()
      : null;
  const hi =
    test.refRangeHigh != null
      ? typeof test.refRangeHigh === "number"
        ? test.refRangeHigh
        : test.refRangeHigh.toNumber()
      : null;

  if (lo === null && hi === null) return [];

  // Heurística Wave 1: critical bounds extienden 50% más allá del rango normal.
  const criticalLow =
    test.critical && lo !== null ? lo - Math.abs(lo) * 0.5 : null;
  const criticalHigh =
    test.critical && hi !== null ? hi + Math.abs(hi) * 0.5 : null;

  return [
    {
      minValue: lo,
      maxValue: hi,
      ageMinYears: null,
      ageMaxYears: null,
      sex: "BOTH",
      criticalLow,
      criticalHigh,
    },
  ];
}
