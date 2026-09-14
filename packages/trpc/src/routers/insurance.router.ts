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
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  insurerCreateInput,
  insurerListInput,
  insurancePlanCreateInput,
  insurancePlanListInput,
  patientCoverageCreateInput,
  patientCoverageUpdateInput,
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
  // CC-0028
  insurancePlanCoverageUpsertInput,
  patientCoverageOverrideUpsertInput,
  coverageRuleCreateInput,
  coverageRuleListInput,
  coverageRuleDeactivateInput,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// b14: states that are treated as "open" for transitions.
const OPEN_STATES = ["PENDING", "REQUESTED"] as const;

// CC-0028 — config de planes/reglas de cobertura: mismo par de roles que
// patient-account.router (ADMIN/ACCOUNTANT) para las escrituras financieras.
const writerProc = requireRole(["ADMIN", "ACCOUNTANT"]);

// CC-0028 — registro de póliza de paciente (coverage.create): mismo set que
// invoice.router (ADMIN/ACCOUNTANT/BILLING) — a diferencia de la config de
// planes/reglas, el alta de una póliza en admisión es trabajo de facturación
// del día a día, no configuración financiera de catálogo.
const coverageWriterProc = requireRole(["ADMIN", "ACCOUNTANT", "BILLING"]);

/**
 * CC-0028 — "ServicePriceList" no tiene modelo Prisma (CC-0015, sql/133 —
 * mismo motivo que "ServiceCategory"): valida por raw SQL que el
 * `priceListId` recibido (InsurancePlan/PatientCoverage) pertenece al
 * tenant antes de guardarlo como FK lógica, para no repetir el gap
 * preexistente de `TipoCuenta.priceListId` (sin validar tenancy) en las
 * dos columnas nuevas de este CC.
 */
async function assertPriceListVisible(
  tx: { $queryRawUnsafe: <T>(query: string, ...values: unknown[]) => Promise<T> },
  priceListId: string,
  organizationId: string,
): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "ServicePriceList" WHERE id = $1::uuid AND "organizationId" = $2::uuid`,
    priceListId,
    organizationId,
  );
  if (rows.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Lista de precios no existe en la organización.",
    });
  }
}

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

/**
 * R02 (auditoría RLS externa) — decisión (a) para TODO este router:
 * `Insurer`/`InsurancePlan`/`PatientCoverage`/`AuthorizationRequest` (más
 * `Patient`/`Encounter`, leídas para validar FKs) tienen policies completas
 * (`insurer_tenant_select/_modify`, `insurance_plan_inherit_insurer`,
 * `patient_coverage_tenant_select/_modify`,
 * `authorization_request_tenant_select/_modify`) matcheando
 * `organizationId = current_org_id()` (o `IS NULL` para catálogo global), y
 * `authenticated` tiene grants completos en las 6 tablas (verificado en prod
 * 2026-08-22). Se envuelve cada procedure individualmente en
 * `withTenantContext` (no un solo wrapper de router) para no tocar la firma
 * pública del router.
 *
 * Nota — `insurer.create` con `organizationId: null` (catálogo global): el
 * comentario original ya señalaba "sólo service_role debería poder" pero
 * nada lo exigía en JS. `insurer_tenant_modify` (WITH CHECK
 * `organizationId = current_org_id()`) no tiene excepción para NULL — con el
 * rol demotado, un tenant intentando crear un insurer global ahora recibe un
 * error de RLS real en vez de que el INSERT silenciosamente tenga éxito. Es
 * un cambio de comportamiento intencional que cierra el gap que el propio
 * comentario ya documentaba.
 */
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
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.insurer.findMany({
            where: { AND: filters },
            orderBy: { name: "asc" },
            take: input.limit,
          }),
        );
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
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.insurer.create({
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
          }),
        );
      }),
  }),

  plan: router({
    list: tenantProcedure
      .input(insurancePlanListInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.insurancePlan.findMany({
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
          }),
        );
      }),

    // CC-0028: sube a writerProc (ADMIN/ACCOUNTANT) porque este create ahora
    // acepta priceListId — mismo gate que planCoverage/coverageOverride/rule.
    create: writerProc
      .input(insurancePlanCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // Verifica que el insurer sea visible para el tenant.
          const insurer = await tx.insurer.findFirst({
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
          if (input.priceListId) {
            await assertPriceListVisible(tx, input.priceListId, ctx.tenant.organizationId);
          }
          return tx.insurancePlan.create({
            data: {
              insurerId: input.insurerId,
              code: input.code,
              name: input.name,
              description: input.description ?? null,
              copayPct: input.copayPct ?? null,
              // Store as JSON if provided; Prisma requires Prisma.DbNull para NULL en columna Json?.
              coveredProcedures: input.coveredProcedures ?? Prisma.DbNull,
              // CC-0028
              priceListId: input.priceListId ?? null,
              sequence: input.sequence,
            },
          });
        });
      }),
  }),

  coverage: router({
    /**
     * CC-0028c — lista transversal para el mantenimiento admin
     * (/insurance/polizas): además de patientId/planId/activeOnly, agrega
     * insurerId (vía plan.insurerId), vigentesA (validFrom<=X y (validTo
     * null o >=X)) y search (policyNumber o nombre/MRN del paciente).
     * Usa el patrón `AND: filters` (no spreads sueltos) para que el OR
     * interno de `search`/`vigentesA` no se mezcle con la tenancy —
     * lección Wave 6, ya aplicada en insurer.list de este mismo router.
     */
    list: tenantProcedure
      .input(patientCoverageListInput)
      .query(async ({ ctx, input }) => {
        const filters: object[] = [{ organizationId: ctx.tenant.organizationId }];
        if (input.patientId) filters.push({ patientId: input.patientId });
        if (input.planId) filters.push({ planId: input.planId });
        if (input.insurerId) filters.push({ plan: { insurerId: input.insurerId } });
        if (input.activeOnly) filters.push({ active: true });
        if (input.vigentesA) {
          filters.push({
            validFrom: { lte: input.vigentesA },
            OR: [{ validTo: null }, { validTo: { gte: input.vigentesA } }],
          });
        }
        if (input.search) {
          const s = input.search;
          filters.push({
            OR: [
              { policyNumber: { contains: s, mode: "insensitive" as const } },
              { patient: { firstName: { contains: s, mode: "insensitive" as const } } },
              { patient: { lastName: { contains: s, mode: "insensitive" as const } } },
              { patient: { secondLastName: { contains: s, mode: "insensitive" as const } } },
              { patient: { mrn: { contains: s, mode: "insensitive" as const } } },
            ],
          });
        }
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.patientCoverage.findMany({
            where: { AND: filters },
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
            skip: input.offset,
          }),
        );
      }),

    // CC-0028: sube a coverageWriterProc porque este create ahora acepta
    // carnet/contratante/priceListId (antes: cualquier tenantProcedure).
    create: coverageWriterProc
      .input(patientCoverageCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // Verifica que el paciente pertenezca al tenant.
          const patient = await tx.patient.findFirst({
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
          const plan = await tx.insurancePlan.findFirst({
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
          if (input.priceListId) {
            await assertPriceListVisible(tx, input.priceListId, ctx.tenant.organizationId);
          }
          return tx.patientCoverage.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              patientId: input.patientId,
              planId: input.planId,
              policyNumber: input.policyNumber,
              // CC-0028
              carnet: input.carnet ?? null,
              contratante: input.contratante ?? null,
              priceListId: input.priceListId ?? null,
              validFrom: input.validFrom,
              validTo: input.validTo ?? null,
              createdBy: ctx.user.id,
            },
          });
        });
      }),

    /**
     * CC-0028c — edición de una póliza existente (mantenimiento admin).
     * `patientCoverageUpdateInput` no incluye `patientId` a propósito: una
     * póliza no se transfiere de paciente — se desactiva (`deactivate`) y se
     * crea una nueva con `create`. `validFrom`/`validTo` se validan contra
     * los valores YA guardados cuando el caller sólo envía uno de los dos
     * (mismo criterio que el `.refine` de `patientCoverageCreateInput`, pero
     * aquí no puede vivir en el schema porque el update es parcial).
     */
    update: coverageWriterProc
      .input(patientCoverageUpdateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const existing = await tx.patientCoverage.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId },
            select: { validFrom: true, validTo: true },
          });
          if (!existing) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Póliza no existe en la organización.",
            });
          }

          if (input.planId) {
            const plan = await tx.insurancePlan.findFirst({
              where: {
                id: input.planId,
                insurer: {
                  OR: [{ organizationId: null }, { organizationId: ctx.tenant.organizationId }],
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
          }
          if (input.priceListId) {
            await assertPriceListVisible(tx, input.priceListId, ctx.tenant.organizationId);
          }

          const effectiveFrom = input.validFrom ?? existing.validFrom;
          // undefined = no tocar (usa la existente); null = borrar la fecha
          // fin (sin vencimiento) — por eso NO se usa `??` aquí.
          const effectiveTo = input.validTo === undefined ? existing.validTo : input.validTo;
          if (effectiveTo && effectiveTo <= effectiveFrom) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "validTo debe ser posterior a validFrom",
            });
          }

          return tx.patientCoverage.update({
            where: { id: input.id },
            data: {
              planId: input.planId,
              policyNumber: input.policyNumber,
              carnet: input.carnet,
              contratante: input.contratante,
              priceListId: input.priceListId,
              validFrom: input.validFrom,
              validTo: input.validTo,
              updatedBy: ctx.user.id,
            },
          });
        });
      }),

    // CC-0028c (pre-pr-review): mismo gate que create/update — desactivar una
    // póliza es acción financiera, no de cualquier rol del tenant.
    deactivate: coverageWriterProc
      .input(patientCoverageDeactivateInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.patientCoverage.updateMany({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              active: true,
            },
            data: { active: false, updatedBy: ctx.user.id },
          }),
        );
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
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.authorizationRequest.findMany({
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
          }),
        );
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.authorizationRequest.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId },
          }),
        );
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    create: tenantProcedure
      .input(authorizationRequestCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const cov = await tx.patientCoverage.findFirst({
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
            const enc = await tx.encounter.findFirst({
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
          return tx.authorizationRequest.create({
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
        const updated = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.authorizationRequest.updateMany({
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
          }),
        );
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
        const updated = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.authorizationRequest.updateMany({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              status: { in: [...OPEN_STATES] },
            },
            data: {
              status: "DENIED",
              denialReason: input.denialReason,
            },
          }),
        );
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

        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.authorizationRequest.findMany({
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
          }),
        );
      }),
  }),

  /**
   * CC-0028 — config de cobertura por ámbito del plan (InsurancePlanCoverage).
   * `upsert` reemplaza la fila del ámbito si ya existe (unique [planId, ambito]).
   */
  planCoverage: router({
    list: tenantProcedure
      .input(z.object({ planId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.insurancePlanCoverage.findMany({
            where: { planId: input.planId },
            orderBy: { ambito: "asc" },
          }),
        );
      }),

    upsert: writerProc
      .input(insurancePlanCoverageUpsertInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const plan = await tx.insurancePlan.findFirst({
            where: {
              id: input.planId,
              insurer: {
                OR: [{ organizationId: null }, { organizationId: ctx.tenant.organizationId }],
              },
            },
            select: { id: true },
          });
          if (!plan) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Plan no visible para el tenant." });
          }
          return tx.insurancePlanCoverage.upsert({
            where: { planId_ambito: { planId: input.planId, ambito: input.ambito } },
            create: {
              planId: input.planId,
              ambito: input.ambito,
              coverageType: input.coverageType,
              insuredPercentage: input.insuredPercentage ?? null,
              copayAmount: input.copayAmount ?? null,
              coverageLimit: input.coverageLimit ?? null,
            },
            update: {
              coverageType: input.coverageType,
              insuredPercentage: input.insuredPercentage ?? null,
              copayAmount: input.copayAmount ?? null,
              coverageLimit: input.coverageLimit ?? null,
              active: true,
            },
          });
        });
      }),
  }),

  /**
   * CC-0028 — override de PatientCoverageOverride sobre la config del plan,
   * a nivel de una póliza específica.
   */
  coverageOverride: router({
    list: tenantProcedure
      .input(z.object({ coverageId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.patientCoverageOverride.findMany({
            where: { coverageId: input.coverageId },
            orderBy: { ambito: "asc" },
          }),
        );
      }),

    upsert: writerProc
      .input(patientCoverageOverrideUpsertInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const coverage = await tx.patientCoverage.findFirst({
            where: { id: input.coverageId, organizationId: ctx.tenant.organizationId },
            select: { id: true },
          });
          if (!coverage) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Póliza no existe en la organización." });
          }
          return tx.patientCoverageOverride.upsert({
            where: { coverageId_ambito: { coverageId: input.coverageId, ambito: input.ambito } },
            create: {
              coverageId: input.coverageId,
              ambito: input.ambito,
              coverageType: input.coverageType,
              insuredPercentage: input.insuredPercentage ?? null,
              copayAmount: input.copayAmount ?? null,
              coverageLimit: input.coverageLimit ?? null,
            },
            update: {
              coverageType: input.coverageType,
              insuredPercentage: input.insuredPercentage ?? null,
              copayAmount: input.copayAmount ?? null,
              coverageLimit: input.coverageLimit ?? null,
              active: true,
            },
          });
        });
      }),
  }),

  /**
   * CC-0028 — "Patient Share Rules" (CoverageRule): % o monto cubierto por
   * código o categoría, a nivel de plan XOR de una póliza específica.
   */
  rule: router({
    list: tenantProcedure
      .input(coverageRuleListInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.coverageRule.findMany({
            where: {
              organizationId: ctx.tenant.organizationId,
              ...(input.planId && { planId: input.planId }),
              ...(input.coverageId && { coverageId: input.coverageId }),
              ...(input.activeOnly && { active: true }),
            },
            orderBy: [{ sequence: "desc" }, { createdAt: "desc" }],
            take: input.limit,
          }),
        );
      }),

    create: writerProc
      .input(coverageRuleCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          if (input.planId) {
            const plan = await tx.insurancePlan.findFirst({
              where: {
                id: input.planId,
                insurer: {
                  OR: [{ organizationId: null }, { organizationId: ctx.tenant.organizationId }],
                },
              },
              select: { id: true },
            });
            if (!plan) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Plan no visible para el tenant." });
            }
          }
          if (input.coverageId) {
            const coverage = await tx.patientCoverage.findFirst({
              where: { id: input.coverageId, organizationId: ctx.tenant.organizationId },
              select: { id: true },
            });
            if (!coverage) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Póliza no existe en la organización." });
            }
          }
          return tx.coverageRule.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              planId: input.planId ?? null,
              coverageId: input.coverageId ?? null,
              ruleOn: input.ruleOn,
              serviceCategoryId: input.serviceCategoryId ?? null,
              code: input.code ?? null,
              ruleType: input.ruleType,
              percentage: input.percentage ?? null,
              amount: input.amount ?? null,
              fullCover: input.fullCover,
              sequence: input.sequence,
              createdBy: ctx.user.id,
            },
          });
        });
      }),

    deactivate: writerProc
      .input(coverageRuleDeactivateInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.coverageRule.updateMany({
            where: { id: input.id, organizationId: ctx.tenant.organizationId, active: true },
            data: { active: false, updatedBy: ctx.user.id },
          }),
        );
        if (updated.count === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Regla no existe o ya está inactiva." });
        }
        return { ok: true as const };
      }),
  }),

  /**
   * b14: Plan-procedure coverage check.
   * Reads coveredProcedures JSONB from InsurancePlan and returns boolean + maxCoverage.
   */
  checkCoverage: tenantProcedure
    .input(checkCoverageInput)
    .query(async ({ ctx, input }) => {
      const plan = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
        tx.insurancePlan.findFirst({
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
        }),
      );

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
