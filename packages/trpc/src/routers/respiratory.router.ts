/**
 * §21 Respiratory — router (Wave 8 / Beta.12 hardening layer 1).
 *
 * Beta.12 additions:
 *   - State machine enforcement for VentilatorSession (ACTIVE→WEANING→EXTUBATED…).
 *   - Ventilator parameter range validation at the router boundary.
 *   - order.renew: extends expiresAt by 24 h.
 *   - order.getExpired: returns orders past expiresAt without renewal.
 *   - MedicalGasUsage: create-only (no update/delete mutations exposed; DB trigger enforces append-only).
 *   - ventilator.transition: explicit state-machine transition mutation.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  respiratoryOrderCreateInput,
  respiratoryOrderListInput,
  respiratoryOrderCompleteInput,
  respiratoryOrderCancelInput,
  respiratoryOrderRenewInput,
  getExpiredOrdersInput,
  ventilatorSessionCreateInput,
  ventilatorSessionEndInput,
  ventilatorSessionListInput,
  ventilatorSessionTransitionInput,
  medicalGasUsageCreateInput,
  medicalGasUsageListInput,
  PEEP_MIN,
  PEEP_MAX,
  FIO2_MIN,
  FIO2_MAX,
  RR_MIN,
  RR_MAX,
  VT_ABS_MIN,
  VT_ABS_MAX,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

// ---------------------------------------------------------------------------
// State machine transition table
// ---------------------------------------------------------------------------

type VentilatorStatus = "ACTIVE" | "WEANING" | "EXTUBATED" | "ESCALATED" | "FAILED_EXTUBATION";

const ALLOWED_TRANSITIONS: Record<VentilatorStatus, VentilatorStatus[]> = {
  ACTIVE: ["WEANING"],
  WEANING: ["EXTUBATED", "ESCALATED", "FAILED_EXTUBATION"],
  ESCALATED: ["ACTIVE"],
  EXTUBATED: [],
  FAILED_EXTUBATION: [],
};

function assertTransitionAllowed(from: VentilatorStatus, to: VentilatorStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Transición inválida: ${from} → ${to}. Permitidas: ${ALLOWED_TRANSITIONS[from].join(", ") || "ninguna"}.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Vent-parameter range guard (used on create; fio2 stored as fraction 0.21–1.0)
// ---------------------------------------------------------------------------

function assertVentParamsInRange(params: {
  peep?: number | null;
  fio2?: number | null;
  rrSet?: number | null;
  tidalVolume?: number | null;
}): void {
  if (params.peep !== undefined && params.peep !== null) {
    if (params.peep < PEEP_MIN || params.peep > PEEP_MAX) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `PEEP ${params.peep} cmH2O fuera de rango seguro (${PEEP_MIN}–${PEEP_MAX}).`,
      });
    }
  }
  if (params.fio2 !== undefined && params.fio2 !== null) {
    if (params.fio2 < FIO2_MIN || params.fio2 > FIO2_MAX) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `FiO2 ${params.fio2} fuera de rango seguro (${FIO2_MIN}–${FIO2_MAX}).`,
      });
    }
  }
  if (params.rrSet !== undefined && params.rrSet !== null) {
    if (params.rrSet < RR_MIN || params.rrSet > RR_MAX) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `RR ${params.rrSet} resp/min fuera de rango seguro (${RR_MIN}–${RR_MAX}).`,
      });
    }
  }
  if (params.tidalVolume !== undefined && params.tidalVolume !== null) {
    if (params.tidalVolume < VT_ABS_MIN || params.tidalVolume > VT_ABS_MAX) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Vt ${params.tidalVolume} mL fuera de rango seguro (${VT_ABS_MIN}–${VT_ABS_MAX} mL).`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Order expiry helper
// ---------------------------------------------------------------------------

function buildExpiredWhereClause(organizationId: string, asOf: Date): object {
  return {
    organizationId,
    status: "ACTIVE",
    expiresAt: { lt: asOf },
    OR: [{ renewedAt: null }, { renewedAt: { lt: asOf } }],
  };
}

const ORDER_DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 h

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

        const now = new Date();
        const expiresAt = input.expiresAt ?? new Date(now.getTime() + ORDER_DEFAULT_DURATION_MS);

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
            startedAt: now,
            expiresAt,
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

    /** Beta.12 — renew: sets renewedAt = now() and expiresAt = now() + 24 h. */
    renew: tenantProcedure
      .input(respiratoryOrderRenewInput)
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const updated = await ctx.prisma.respiratoryOrder.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: "ACTIVE",
          },
          data: {
            renewedAt: now,
            expiresAt: new Date(now.getTime() + ORDER_DEFAULT_DURATION_MS),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden activa no encontrada.",
          });
        }
        return { ok: true as const };
      }),

    /** Beta.12 — returns ACTIVE orders past expiresAt without renewal. */
    getExpired: tenantProcedure
      .input(getExpiredOrdersInput)
      .query(async ({ ctx, input }) => {
        const asOf = input.asOf ?? new Date();
        return ctx.prisma.respiratoryOrder.findMany({
          where: buildExpiredWhereClause(
            input.organizationId ?? ctx.tenant.organizationId,
            asOf,
          ),
          orderBy: { expiresAt: "asc" },
          take: input.limit,
        });
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
            ...(input.statusSM && { statusSM: input.statusSM }),
          },
          orderBy: { startedAt: "desc" },
          take: input.limit,
        });
      }),

    /**
     * Beta.12: validates vent params within safe medical ranges before persisting.
     */
    create: tenantProcedure
      .input(ventilatorSessionCreateInput)
      .mutation(async ({ ctx, input }) => {
        assertVentParamsInRange({
          peep: input.peep,
          fio2: input.fio2,
          rrSet: input.rrSet,
          tidalVolume: input.tidalVolume,
        });

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
            patientWeightKg: input.patientWeightKg ?? null,
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

    /** Beta.12 — advance state machine with graph validation. */
    transition: tenantProcedure
      .input(ventilatorSessionTransitionInput)
      .mutation(async ({ ctx, input }) => {
        const session = await ctx.prisma.ventilatorSession.findFirst({
          where: {
            id: input.id,
            order: { organizationId: ctx.tenant.organizationId },
          },
          select: { id: true, statusSM: true, endedAt: true },
        });

        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sesión de ventilación no encontrada." });
        }
        if (session.endedAt !== null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No se puede transicionar una sesión ya finalizada.",
          });
        }

        assertTransitionAllowed(session.statusSM as VentilatorStatus, input.to as VentilatorStatus);

        return ctx.prisma.ventilatorSession.update({
          where: { id: input.id },
          data: {
            statusSM: input.to,
            notes: input.notes ?? undefined,
          },
        });
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

    /**
     * Append-only create; no update/delete mutations exposed.
     * DB trigger (36_respiratory_hardening.sql) also blocks UPDATE/DELETE.
     */
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
