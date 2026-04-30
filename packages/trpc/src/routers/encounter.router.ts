import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  admitSchema,
  transferSchema,
  dischargeSchema,
  encounterListSchema,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

/**
 * Genera un número de encuentro legible: ENC-YYYY-XXXXXX.
 * Usa el último secuencial dentro de la organización.
 * TODO(Sprint 2): mover a una secuencia Postgres dedicada para evitar contención.
 */
async function nextEncounterNumber(
  prisma: {
    encounter: { count: (args: { where: { organizationId: string; admittedAt: { gte: Date } } }) => Promise<number> };
  },
  organizationId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const start = new Date(`${year}-01-01T00:00:00Z`);
  const count = await prisma.encounter.count({
    where: { organizationId, admittedAt: { gte: start } },
  });
  return `ENC-${year}-${String(count + 1).padStart(6, "0")}`;
}

export const encounterRouter = router({
  admit: tenantProcedure.input(admitSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.tenant.establishmentId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Selecciona un establecimiento antes de admitir.",
      });
    }
    const encounterNumber = await nextEncounterNumber(
      ctx.prisma,
      ctx.tenant.organizationId,
    );

    return ctx.prisma.encounter.create({
      data: {
        countryId: ctx.tenant.countryId,
        organizationId: ctx.tenant.organizationId,
        establishmentId: ctx.tenant.establishmentId,
        serviceUnitId: input.serviceUnitId,
        patientId: input.patientId,
        patientTypeId: input.patientTypeId,
        patientCategoryId: input.patientCategoryId,
        admissionType: input.admissionType,
        admittedAt: input.admittedAt ?? new Date(),
        encounterNumber,
        currencyId: input.currencyId,
        // TODO(Sprint 2): resolver tipo de cambio real desde ExchangeRate.
        exchangeRateToFunc: 1,
        createdBy: ctx.user.id,
      },
    });
  }),

  transfer: tenantProcedure.input(transferSchema).mutation(async ({ ctx, input }) => {
    return ctx.prisma.encounterTransfer.create({
      data: {
        encounterId: input.encounterId,
        fromServiceId: input.fromServiceId,
        toServiceId: input.toServiceId,
        fromBedId: input.fromBedId,
        toBedId: input.toBedId,
        reason: input.reason,
        createdBy: ctx.user.id,
      },
    });
  }),

  discharge: tenantProcedure.input(dischargeSchema).mutation(async ({ ctx, input }) => {
    return ctx.prisma.encounter.update({
      where: { id: input.encounterId },
      data: {
        dischargeType: input.dischargeType,
        dischargedAt: input.dischargedAt ?? new Date(),
        primaryDiagnosisId: input.primaryDiagnosisId,
        updatedBy: ctx.user.id,
      },
    });
  }),

  list: tenantProcedure.input(encounterListSchema).query(async ({ ctx, input }) => {
    const where = {
      organizationId: ctx.tenant.organizationId,
      ...(input.patientId ? { patientId: input.patientId } : {}),
      ...(input.status === "OPEN" ? { dischargedAt: null } : {}),
      ...(input.status === "CLOSED" ? { dischargedAt: { not: null } } : {}),
    };
    const [items, total] = await Promise.all([
      ctx.prisma.encounter.findMany({
        where,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        orderBy: { admittedAt: "desc" },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          serviceUnit: true,
        },
      }),
      ctx.prisma.encounter.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }),

  /** Censo de pacientes hospitalizados en este momento. */
  getCensus: tenantProcedure
    .input(z.object({ serviceUnitId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.prisma.encounter.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          dischargedAt: null,
          ...(input?.serviceUnitId ? { serviceUnitId: input.serviceUnitId } : {}),
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          serviceUnit: true,
          bedAssignments: {
            where: { releasedAt: null },
            include: { bed: true },
            take: 1,
          },
        },
        orderBy: { admittedAt: "asc" },
      });
    }),
});
