/**
 * §25 Insurer Agreements — router (Wave 8 / Beta.14 hardening layer 1).
 *
 * Cambios b14:
 *   - State machine PENDING -> APPROVED | DENIED | EXPIRED (REQUESTED treated as PENDING).
 *   - approve: APPROVED requires validUntil; sets to validTo on model.
 *   - deny: DENIED requires denialReason (enforced at schema + DB trigger).
 *   - checkCoverage: reads coveredProcedures JSONB from InsurancePlan.
 *   - getExpiringAuthorizations: APPROVED records with validTo < now+N days.
 *   - Audit trail: append-only enforced by DB trigger (38_insurance_hardening.sql).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  insurerCreateInput,
  insurerListInput,
  insurancePlanCreateInput,
  insurancePlanListInput,
  patientCoverageCreateInput,
  patientCoverageListInput,
  patientCoverageDeactivateInput,
  authorizationRequestCreateInput,
  authorizationRequestListInput,
  authorizationApproveInput,
  authorizationDenyInput,
  checkCoverageInput,
  getExpiringAuthorizationsInput,
  coveredProcedureEntry,
  type CoveredProcedureEntry,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

// b14: states that are treated as "open" for transitions.
const OPEN_STATES = ["PENDING", "REQUESTED"] as const;

/**
 * Parse and validate coveredProcedures JSON from the DB.
 * Returns an empty array on null/invalid to avoid crashing callers.
 */
function parseCoveredProcedures(raw: unknown): CoveredProcedureEntry[] {
  if (!raw || !Array.isArray(raw)) return [];
  const result: CoveredProcedureEntry[] = [];
  for (const entry of raw) {
    const parsed = coveredProcedureEntry.safeParse(entry);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
}

/**
 * b14: isProcedureCovered — pure helper (no DB access).
 * Returns covered flag + maxCoverage from the parsed JSONB array.
 */
function isProcedureCovered(
  procedures: CoveredProcedureEntry[],
  procedureCode: string,
): { covered: boolean; maxCoverage: number | null } {
  const match = procedures.find(
    (p) => p.code.toUpperCase() === procedureCode.toUpperCase(),
  );
  if (!match) return { covered: false, maxCoverage: null };
  return { covered: true, maxCoverage: match.maxCoverage ?? null };
}

export const insuranceRouter = router({
  insurer: router({
    /**
     * Lista aseguradoras: catálogo global (organizationId null) + tenant-private.
     * Compone con AND para evitar que el OR de `search` sobreescriba el OR del
     * filtro de tenancy (lección Wave 6).
     */
    list: tenantProcedure
      .input(insurerListInput)
      .query(async ({ ctx, input }) => {
        const tenancyOr = [
          { organizationId: null },
          { organizationId: ctx.tenant.organizationId },
        ];
        const filters: object[] = [{ OR: tenancyOr }];
        if (input.activeOnly) filters.push({ active: true });
        if (input.kind) filters.push({ kind: input.kind });
        if (input.search) {
          filters.push({
            OR: [
              { code: { contains: input.search, mode: "insensitive" as const } },
              { name: { contains: input.search, mode: "insensitive" as const } },
              { taxId: { contains: input.search, mode: "insensitive" as const } },
            ],
          });
        }
        return ctx.prisma.insurer.findMany({
          where: { AND: filters },
          orderBy: { name: "asc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(insurerCreateInput)
      .mutation(async ({ ctx, input }) => {
        // organizationId null = catálogo global (sólo service_role debería poder).
        // Si no viene, se asigna al tenant.
        const orgId =
          input.organizationId === null
            ? null
            : (input.organizationId ?? ctx.tenant.organizationId);
        return ctx.prisma.insurer.create({
          data: {
            organizationId: orgId,
            code: input.code,
            name: input.name,
            taxId: input.taxId ?? null,
            kind: input.kind,
            contactPhone: input.contactPhone ?? null,
            contactEmail: input.contactEmail ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),
  }),

  plan: router({
    list: tenantProcedure
      .input(insurancePlanListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.insurancePlan.findMany({
          where: {
            // El plan hereda tenancy del insurer; si insurer es global, el plan también.
            insurer: {
              OR: [
                { organizationId: null },
                { organizationId: ctx.tenant.organizationId },
              ],
            },
            ...(input.insurerId && { insurerId: input.insurerId }),
            ...(input.activeOnly && { active: true }),
          },
          include: { insurer: { select: { id: true, code: true, name: true } } },
          orderBy: { name: "asc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(insurancePlanCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Verifica que el insurer sea visible para el tenant.
        const insurer = await ctx.prisma.insurer.findFirst({
          where: {
            id: input.insurerId,
            OR: [
              { organizationId: null },
              { organizationId: ctx.tenant.organizationId },
            ],
          },
          select: { id: true },
        });
        if (!insurer) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Aseguradora no visible para el tenant.",
          });
        }
        return ctx.prisma.insurancePlan.create({
          data: {
            insurerId: input.insurerId,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            copayPct: input.copayPct ?? null,
            // Store as JSON if provided; Prisma accepts plain JS array for Json fields.
            coveredProcedures: input.coveredProcedures ?? null,
          },
        });
      }),
  }),

  coverage: router({
    list: tenantProcedure
      .input(patientCoverageListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.patientCoverage.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.planId && { planId: input.planId }),
            ...(input.activeOnly && { active: true }),
          },
          include: {
            patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
            plan: {
              select: {
                id: true,
                code: true,
                name: true,
                insurer: { select: { id: true, code: true, name: true } },
              },
            },
          },
          orderBy: { validFrom: "desc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(patientCoverageCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Verifica que el paciente pertenezca al tenant.
        const patient = await ctx.prisma.patient.findFirst({
          where: { id: input.patientId, organizationId: ctx.tenant.organizationId },
          select: { id: true },
        });
        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Paciente no existe en la organización.",
          });
        }
        // Plan visible para tenant (vía insurer.organizationId null|tenant).
        const plan = await ctx.prisma.insurancePlan.findFirst({
          where: {
            id: input.planId,
            insurer: {
              OR: [
                { organizationId: null },
                { organizationId: ctx.tenant.organizationId },
              ],
            },
          },
          select: { id: true },
        });
        if (!plan) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Plan de aseguradora no visible para el tenant.",
          });
        }
        return ctx.prisma.patientCoverage.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            patientId: input.patientId,
            planId: input.planId,
            policyNumber: input.policyNumber,
            validFrom: input.validFrom,
            validTo: input.validTo ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    deactivate: tenantProcedure
      .input(patientCoverageDeactivateInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.patientCoverage.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            active: true,
          },
          data: { active: false, updatedBy: ctx.user.id },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Cobertura no existe o ya está inactiva.",
          });
        }
        return { ok: true as const };
      }),
  }),

  authorization: router({
    list: tenantProcedure
      .input(authorizationRequestListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.authorizationRequest.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.coverageId && { coverageId: input.coverageId }),
            ...(input.encounterId && { encounterId: input.encounterId }),
            ...(input.status && { status: input.status }),
            ...((input.fromDate || input.toDate) && {
              requestedAt: {
                ...(input.fromDate && { gte: input.fromDate }),
                ...(input.toDate && { lte: input.toDate }),
              },
            }),
          },
          include: {
            coverage: {
              select: {
                id: true,
                policyNumber: true,
                plan: { select: { id: true, code: true, name: true } },
              },
            },
          },
          orderBy: { requestedAt: "desc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.authorizationRequest.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    create: tenantProcedure
      .input(authorizationRequestCreateInput)
      .mutation(async ({ ctx, input }) => {
        const cov = await ctx.prisma.patientCoverage.findFirst({
          where: {
            id: input.coverageId,
            organizationId: ctx.tenant.organizationId,
            active: true,
          },
          select: { id: true },
        });
        if (!cov) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Cobertura activa no existe en la organización.",
          });
        }
        if (input.encounterId) {
          const enc = await ctx.prisma.encounter.findFirst({
            where: {
              id: input.encounterId,
              organizationId: ctx.tenant.organizationId,
            },
            select: { id: true },
          });
          if (!enc) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Encuentro no existe en la organización.",
            });
          }
        }
        // b14: new records use PENDING as the canonical start state.
        return ctx.prisma.authorizationRequest.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            coverageId: input.coverageId,
            encounterId: input.encounterId ?? null,
            serviceCode: input.serviceCode,
            serviceDesc: input.serviceDesc,
            requestedById: ctx.user.id,
            status: "PENDING",
          },
        });
      }),

    approve: tenantProcedure
      .input(authorizationApproveInput)
      .mutation(async ({ ctx, input }) => {
        // b14: validUntil is required for APPROVED (not PARTIAL) to enforce state machine.
        const isPartial = input.partial;
        const validUntil = input.validUntil ?? input.validTo ?? null;

        if (!isPartial && !validUntil) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "APPROVED requiere validUntil para indicar vigencia de la autorización.",
          });
        }

        // b14: state machine allows transition from PENDING or REQUESTED (legacy).
        const updated = await ctx.prisma.authorizationRequest.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: [...OPEN_STATES] },
          },
          data: {
            status: isPartial ? "PARTIAL" : "APPROVED",
            externalRef: input.externalRef,
            approvedAmount: input.approvedAmount ?? null,
            validFrom: input.validFrom ?? null,
            validTo: validUntil,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Solicitud no existe o no está en estado PENDING/REQUESTED.",
          });
        }
        return { ok: true as const };
      }),

    deny: tenantProcedure
      .input(authorizationDenyInput)
      .mutation(async ({ ctx, input }) => {
        // b14: denialReason is required (enforced by schema + DB trigger).
        // state machine allows transition from PENDING or REQUESTED (legacy).
        const updated = await ctx.prisma.authorizationRequest.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: [...OPEN_STATES] },
          },
          data: {
            status: "DENIED",
            denialReason: input.denialReason,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Solicitud no existe o no está en estado PENDING/REQUESTED.",
          });
        }
        return { ok: true as const };
      }),

    /**
     * b14: Returns APPROVED authorizations expiring within daysAhead days.
     * Used by front-end alerts and background jobs to proactively flag renewals.
     */
    getExpiring: tenantProcedure
      .input(getExpiringAuthorizationsInput)
      .query(async ({ ctx, input }) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + input.daysAhead);

        return ctx.prisma.authorizationRequest.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            status: "APPROVED",
            validTo: {
              not: null,
              lte: cutoff,
              gte: new Date(), // exclude already expired
            },
          },
          include: {
            coverage: {
              select: {
                id: true,
                policyNumber: true,
                patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
                plan: { select: { id: true, code: true, name: true } },
              },
            },
          },
          orderBy: { validTo: "asc" },
          take: input.limit,
        });
      }),
  }),

  /**
   * b14: Plan-procedure coverage check.
   * Reads coveredProcedures JSONB from InsurancePlan and returns boolean + maxCoverage.
   */
  checkCoverage: tenantProcedure
    .input(checkCoverageInput)
    .query(async ({ ctx, input }) => {
      const plan = await ctx.prisma.insurancePlan.findFirst({
        where: {
          id: input.planId,
          active: true,
          insurer: {
            OR: [
              { organizationId: null },
              { organizationId: ctx.tenant.organizationId },
            ],
          },
        },
        select: { id: true, coveredProcedures: true },
      });

      if (!plan) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Plan no existe o no es visible para el tenant.",
        });
      }

      const procedures = parseCoveredProcedures(plan.coveredProcedures);
      const { covered, maxCoverage } = isProcedureCovered(procedures, input.procedureCode);

      return {
        covered,
        maxCoverage,
        procedureCode: input.procedureCode,
        planId: input.planId,
      };
    }),
});
