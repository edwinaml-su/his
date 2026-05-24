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
 *
 * HH-06 (2026-05-19):
 * - Todos los resolvers tenant-scoped envueltos en withTenantContext para
 *   garantizar demote a rol `authenticated` y aplicación de RLS de Postgres.
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
  type LabCriticalValuePayload,
} from "@his/contracts";
import { emitDomainEvent } from "@his/database";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

/**
 * Beta.15 — convierte Prisma Decimal-or-null a number-or-null para el payload
 * Zod del evento `lab.criticalValue`. Prisma serializa refRangeLow/High como
 * `Decimal` (objeto con `.toNumber()`). El mock de tests respeta esa misma forma.
 */
function decimalToNullableNumber(
  v: { toNumber: () => number } | number | null | undefined,
): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  return v.toNumber();
}

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
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.labOrder.findMany({
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
      });
    }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const o = await tx.labOrder.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId },
            include: {
              items: { include: { test: true, results: true } },
              specimens: true,
            },
          });
          if (!o) throw new TRPCError({ code: "NOT_FOUND" });
          return o;
        });
      }),

    create: tenantProcedure.input(labOrderCreateInput).mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const enc = await tx.encounter.findFirst({
          where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
          select: { id: true, patientId: true },
        });
        if (!enc) throw new TRPCError({ code: "NOT_FOUND", message: "Encuentro no existe en la organización." });
        if (enc.patientId !== input.patientId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "patientId no coincide con encounter." });
        }
        return tx.labOrder.create({
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
      });
    }),
  }),

  specimen: router({
    /**
     * Registra la toma física de la muestra.
     *
     * JCI Standard: IPSG.1 ME 4 — cuando se envía `patientGsrn` (flujo bedside),
     * se verifica que el GSRN coincida con el paciente de la orden Y que el
     * `secondIdentifier` coincida con el MRN o con al menos un PatientIdentifier
     * (DUI / NIT / NIE / pasaporte). Si cualquiera de los dos no coincide, FORBIDDEN.
     */
    collect: tenantProcedure.input(specimenCollectInput).mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const order = await tx.labOrder.findFirst({
          where: { id: input.orderId, organizationId: ctx.tenant.organizationId },
          select: { id: true, patientId: true },
        });
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });

        // JCI Standard: IPSG.1 ME 4 — verificación 2-IDs (solo flujo bedside).
        if (input.patientGsrn !== undefined) {
          if (!input.secondIdentifier) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "IPSG.1: se requiere un segundo identificador junto al GSRN de pulsera.",
            });
          }

          const patient = await tx.patient.findFirst({
            where: { id: order.patientId, organizationId: ctx.tenant.organizationId },
            select: {
              gsrn: true,
              mrn: true,
              identifiers: { select: { value: true } },
            },
          });
          if (!patient) throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });

          // Verificar primer ID: GSRN de pulsera.
          if (patient.gsrn !== input.patientGsrn) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "IPSG.1: el GSRN de la pulsera no coincide con el paciente de la orden.",
            });
          }

          // Verificar segundo ID: MRN o cualquier PatientIdentifier registrado.
          const knownIdentifiers = new Set<string>([
            patient.mrn,
            ...patient.identifiers.map((i) => i.value),
          ]);
          if (!knownIdentifiers.has(input.secondIdentifier)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "IPSG.1: el segundo identificador no coincide con el paciente de la orden.",
            });
          }
        }

        return tx.labSpecimen.create({
          data: {
            orderId: input.orderId,
            type: input.type,
            barcode: input.barcode,
            collectedAt: input.collectedAt ?? new Date(),
            collectedById: ctx.user.id,
            condition: "ACCEPTABLE",
          },
        });
      });
    }),

    reject: tenantProcedure.input(specimenRejectInput).mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const updated = await tx.labSpecimen.updateMany({
          where: {
            id: input.id,
            order: { organizationId: ctx.tenant.organizationId },
          },
          data: { condition: "REJECTED", rejectionReason: input.rejectionReason },
        });
        if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      });
    }),
  }),

  result: router({
    /**
     * Beta.3 — enter con auto-flagging por reference ranges.
     * - Carga el LabTest del item para obtener refRangeLow/refRangeHigh y flag critical.
     * - Si `forceFlagOverride=false` (default) recalcula el flag desde refs.
     * - Si `valueNumeric` provisto y tests con criticalFlag → mapea a CRITICAL_*.
     * - Retorna alerts inline si el flag es crítico.
     *
     * HH-06: withTenantContext provee la transacción y el demote de rol.
     * El outbox de emitDomainEvent ocurre dentro del mismo tx.
     */
    enter: tenantProcedure
      .input(resultEnterWithPatientContextInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const item = await tx.labOrderItem.findFirst({
            where: {
              id: input.orderItemId,
              order: { organizationId: ctx.tenant.organizationId },
            },
            include: {
              test: true,
              // Beta.15: prescriberId es el destinatario canónico del evento
              // `lab.criticalValue` (backlog US.B15.4.2).
              order: { select: { prescriberId: true } },
            },
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

          const isCritical = isCriticalFlag(finalFlag);

          // Beta.15 (US.B15.4.2): si flag final es CRITICAL_LOW/CRITICAL_HIGH
          // y tenemos valueNumeric, emitimos `lab.criticalValue` dentro de la
          // misma transacción (outbox transaccional).
          // Sin valueNumeric el payload Zod no es válido — no se emite.
          const shouldEmit = isCritical && input.valueNumeric != null;

          const result = await tx.labResult.create({
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

          if (shouldEmit) {
            const payload: LabCriticalValuePayload = {
              orderItemId: input.orderItemId,
              resultId: result.id,
              prescriberId: item.order.prescriberId,
              testCode: item.test.code,
              flag: finalFlag as "CRITICAL_LOW" | "CRITICAL_HIGH",
              value: input.valueNumeric as number,
              unit: input.valueUnit ?? item.test.unit ?? undefined,
              referenceRange: {
                low: decimalToNullableNumber(item.test.refRangeLow),
                high: decimalToNullableNumber(item.test.refRangeHigh),
              },
            };
            await emitDomainEvent(tx, {
              organizationId: ctx.tenant.organizationId,
              eventType: "lab.criticalValue",
              aggregateType: "LabResult",
              aggregateId: result.id,
              emittedById: ctx.user.id,
              payload,
            });
          }

          return {
            result,
            finalFlag,
            isCritical,
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
        });
      }),

    /**
     * Beta.3 — validate con 4-eyes + append-only history.
     * Las validaciones anteriores se mantienen en notes (formato auditable).
     */
    validate: tenantProcedure.input(resultValidateInput).mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const result = await tx.labResult.findFirst({
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

        return tx.labResult.update({
          where: { id: input.resultId },
          data: {
            validatedAt,
            validatedById: ctx.user.id,
            notes: newNotes,
          },
        });
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
