import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  triageEvaluationCreateSchema,
  quickIntakeInputSchema,
  recordVitalsInputSchema,
  setAssignedLevelInputSchema,
  VITAL_REASONABLE_RANGES,
  type TriageVitalCode,
  type VitalAlert,
} from "@his/contracts";
import { withTenantContext } from "../rls-context";
import { router, tenantProcedure } from "../trpc";

/** Formatea la fecha como yyyyMMdd-HHmmss en UTC para el MRN del NN. */
function formatNnSuffix(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/**
 * Genera un encounter number EMERGENCY: ENC-YYYY-XXXXXX.
 * Replicación local del helper de `encounter.router.ts` (Juliet) para evitar
 * tocar ese archivo durante el sprint.
 */
async function nextEncounterNumber(
  prisma: { encounter: { count: (args: { where: { organizationId: string; admittedAt: { gte: Date } } }) => Promise<number> } },
  organizationId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const start = new Date(`${year}-01-01T00:00:00Z`);
  const count = await prisma.encounter.count({
    where: { organizationId, admittedAt: { gte: start } },
  });
  return `ENC-${year}-${String(count + 1).padStart(6, "0")}`;
}

/**
 * Resuelve la moneda funcional del país del tenant (`CountryCurrency.isFunctional`).
 * Fallback: cualquier currency activa de curso legal en el país.
 */
async function resolveCountryCurrency(
  prisma: PrismaForCurrency,
  countryId: string,
): Promise<string> {
  const fn = await prisma.countryCurrency.findFirst({
    where: { countryId, isFunctional: true },
    select: { currencyId: true },
  });
  if (fn) return fn.currencyId;
  const lt = await prisma.countryCurrency.findFirst({
    where: { countryId, isLegalTender: true },
    select: { currencyId: true },
  });
  if (!lt) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El país del tenant no tiene moneda funcional/legal configurada.",
    });
  }
  return lt.currencyId;
}

interface PrismaForCurrency {
  countryCurrency: {
    findFirst: (args: {
      where: { countryId: string; isFunctional?: boolean; isLegalTender?: boolean };
      select: { currencyId: true };
    }) => Promise<{ currencyId: string } | null>;
  };
}

/** Reglas de alerta para signos vitales (TDR §9.2 / Manchester guidelines). */
function computeServerAlerts(
  vitals: { vitalCode: TriageVitalCode; valueNumeric?: number | null }[],
): VitalAlert[] {
  const alerts: VitalAlert[] = [];
  const num = (code: TriageVitalCode) =>
    vitals.find((v) => v.vitalCode === code)?.valueNumeric ?? null;

  const spo2 = num("SPO2");
  if (spo2 != null) {
    if (spo2 < 90) alerts.push({ vitalCode: "SPO2", severity: "CRITICAL", message: "Hipoxia severa" });
    else if (spo2 < 95) alerts.push({ vitalCode: "SPO2", severity: "WARNING", message: "Hipoxia" });
  }
  const hr = num("HR");
  if (hr != null) {
    if (hr < 50) alerts.push({ vitalCode: "HR", severity: "CRITICAL", message: "Bradicardia" });
    else if (hr > 130) alerts.push({ vitalCode: "HR", severity: "WARNING", message: "Taquicardia" });
  }
  const sys = num("BP_SYS");
  if (sys != null) {
    if (sys < 90) alerts.push({ vitalCode: "BP_SYS", severity: "CRITICAL", message: "Hipotensión / shock" });
    else if (sys > 180) alerts.push({ vitalCode: "BP_SYS", severity: "WARNING", message: "Hipertensión severa" });
  }
  const temp = num("TEMP");
  if (temp != null && temp > 39) {
    alerts.push({ vitalCode: "TEMP", severity: "WARNING", message: "Fiebre alta" });
  }
  const gcs = num("GCS");
  if (gcs != null && gcs < 9) {
    alerts.push({ vitalCode: "GCS", severity: "CRITICAL", message: "Glasgow ≤8 — vía aérea" });
  }
  const pain = num("PAIN");
  if (pain != null && pain >= 7) {
    alerts.push({ vitalCode: "PAIN", severity: "INFO", message: "Dolor severo" });
  }
  return alerts;
}

export const triageRouter = router({
  /** Lista los niveles Manchester configurados en la organización activa. */
  listLevels: tenantProcedure.query(async ({ ctx }) => {
    return ctx.prisma.triageLevel.findMany({
      where: { organizationId: ctx.tenant.organizationId, active: true },
      orderBy: { priority: "asc" },
    });
  }),

  listFlowcharts: tenantProcedure
    .input(z.object({ pediatric: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.prisma.triageFlowchart.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          active: true,
          ...(input?.pediatric !== undefined ? { isPediatric: input.pediatric } : {}),
        },
        orderBy: { name: "asc" },
      });
    }),

  getDiscriminators: tenantProcedure
    .input(z.object({ flowchartId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.triageDiscriminator.findMany({
        where: { flowchartId: input.flowchartId, active: true },
        orderBy: { ordinal: "asc" },
        include: { resultLevel: true },
      });
    }),

  /** Cola de triage: encuentros sin alta y sin evaluación COMPLETED hoy. */
  listPending: tenantProcedure.query(async ({ ctx }) => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    // H3-03 (audit Stream A): expirar evaluaciones huérfanas IN_PROGRESS con
    // startedAt > 2h → CANCELLED. En emergencia masiva las evaluaciones
    // abandonadas saturaban la cola y enmascaraban pacientes no atendidos.
    // El barrido se hace lazy al consultar la cola (sin necesidad de pg_cron).
    const expiryThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await ctx.prisma.triageEvaluation.updateMany({
      where: {
        organizationId: ctx.tenant.organizationId,
        status: "IN_PROGRESS",
        startedAt: { lt: expiryThreshold },
      },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    return ctx.prisma.encounter.findMany({
      where: {
        organizationId: ctx.tenant.organizationId,
        dischargedAt: null,
        admittedAt: { gte: since },
        triages: { none: { status: "COMPLETED" } },
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        triages: {
          orderBy: { startedAt: "desc" },
          take: 1,
          include: { assignedLevel: true },
        },
      },
      orderBy: { admittedAt: "asc" },
    });
  }),

  createEvaluation: tenantProcedure
    .input(triageEvaluationCreateSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenant.establishmentId) {
        throw new Error("Selecciona un establecimiento antes de evaluar.");
      }
      const { vitalSigns, discriminatorHits, ...rest } = input;
      return ctx.prisma.triageEvaluation.create({
        data: {
          ...rest,
          countryId: ctx.tenant.countryId,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId,
          triagistUserId: ctx.user.id,
          status: "COMPLETED",
          completedAt: new Date(),
          createdBy: ctx.user.id,
          vitalSigns: { create: vitalSigns },
          discriminatorHits: { create: discriminatorHits },
        },
        include: { assignedLevel: true, vitalSigns: true, discriminatorHits: true },
      });
    }),

  /**
   * US-3.4 — Cerrar wizard de discriminadores: confirma nivel Manchester.
   *
   * Acciones atómicas (transacción dentro de `withTenantContext`):
   *  1. Carga la `TriageEvaluation` y valida que pertenece al tenant + esté IN_PROGRESS.
   *  2. (Opcional) Crea filas `TriageDiscriminatorHit` con el razonamiento del triagista.
   *  3. UPDATE evaluation: `assignedLevelId`, `status='COMPLETED'`, `completedAt=now()`,
   *     `overrideJustification` si vino, `updatedBy=ctx.user.id`.
   *  4. Retorna la evaluación con relaciones (`assignedLevel`, `discriminatorHits`).
   *
   * Errores:
   *  - NOT_FOUND   — evaluation inexistente o de otro tenant.
   *  - CONFLICT    — evaluation ya `COMPLETED` (transición irreversible).
   */
  setAssignedLevel: tenantProcedure
    .input(setAssignedLevelInputSchema)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const existing = await tx.triageEvaluation.findFirst({
          where: {
            id: input.triageEvaluationId,
            organizationId: ctx.tenant.organizationId,
          },
          select: { id: true, status: true },
        });

        if (!existing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Evaluación de triage no encontrada en la organización activa.",
          });
        }

        if (existing.status === "COMPLETED") {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "La evaluación ya está COMPLETED. La transición de nivel es irreversible.",
          });
        }

        if (input.discriminatorHits.length > 0) {
          await tx.triageDiscriminatorHit.createMany({
            // Prisma model field es `evaluationId` (schema.prisma:1646).
            data: input.discriminatorHits.map((hit) => ({
              evaluationId: input.triageEvaluationId,
              discriminatorId: hit.discriminatorId,
              positive: hit.positive,
              notes: hit.notes ?? null,
            })),
            skipDuplicates: true,
          });
        }

        return tx.triageEvaluation.update({
          where: { id: input.triageEvaluationId },
          data: {
            assignedLevelId: input.assignedLevelId,
            status: "COMPLETED",
            completedAt: new Date(),
            overrideJustification: input.overrideJustification ?? null,
            updatedBy: ctx.user.id,
          },
          include: {
            assignedLevel: true,
            discriminatorHits: true,
          },
        });
      });
    }),

  /**
   * US-6.1 — Recepción rápida en triage.
   *
   * Caminos:
   *  - EXISTING_PATIENT: valida paciente vivo (no soft-deleted) en el tenant.
   *  - NN: crea Patient con `mrn = NN-yyyyMMdd-HHmmss`, `firstName = "NN"`,
   *    `lastName = description` (truncada). `isUnknown = true`,
   *    `unknownLabel = mrn`.
   *
   * Reusa Encounter EMERGENCY abierto (no descargado) si existe; de lo
   * contrario crea uno. Crea SIEMPRE un nuevo `TriageEvaluation` IN_PROGRESS
   * **sin** asignar nivel (eso es US-6.4 con discriminadores). Para no
   * romper el FK requerido `assignedLevelId`, se asigna provisoriamente el
   * nivel de menor prioridad clínica (BLUE/priority=5) — quedará sobre-
   * escrito por el discriminador final. Si el caller necesita reportar el
   * nivel "real" mientras tanto, status sigue IN_PROGRESS.
   */
  quickIntake: tenantProcedure
    .input(quickIntakeInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenant.establishmentId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Selecciona un establecimiento antes de hacer recepción.",
        });
      }

      const orgId = ctx.tenant.organizationId;
      const countryId = ctx.tenant.countryId;
      const estId = ctx.tenant.establishmentId;
      const userId = ctx.user.id;

      // H3-07 — Toda la creación de paciente NN + encounter + triage debe
      // pasar por withTenantContext para que RLS aplique. Antes el flujo
      // hacía `ctx.prisma.patient.create` directo, sin demote a
      // `authenticated`, dejando el filtro tenant solo en el `where` JS.
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // 1. Resolver / crear paciente.
        let patientId: string;
        if (input.mode === "EXISTING_PATIENT") {
          const p = await tx.patient.findFirst({
            where: { id: input.patientId, organizationId: orgId, deletedAt: null },
            select: { id: true, active: true },
          });
          if (!p) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no existe en esta organización." });
          }
          if (!p.active) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Paciente inactivo (posible fallecimiento)." });
          }
          patientId = p.id;
        } else {
          const now = new Date();
          const mrn = `NN-${formatNnSuffix(now)}`;
          const truncated = input.nnFields.description.slice(0, 100).trim() || "Desconocido";
          const created = await tx.patient.create({
            data: {
              organizationId: orgId,
              mrn,
              firstName: "NN",
              lastName: truncated,
              biologicalSexId: input.nnFields.sexAtBirthId,
              birthDateEstimated: input.nnFields.estimatedAge != null,
              birthDate:
                input.nnFields.estimatedAge != null
                  ? new Date(Date.UTC(now.getFullYear() - input.nnFields.estimatedAge, 0, 1, 12, 0, 0))
                  : null,
              isUnknown: true,
              unknownLabel: mrn,
              createdBy: userId,
            },
          });
          patientId = created.id;
        }

        // 2. Reusar o crear Encounter EMERGENCY abierto.
        let encounter = await tx.encounter.findFirst({
          where: {
            organizationId: orgId,
            patientId,
            admissionType: "EMERGENCY",
            dischargedAt: null,
          },
          orderBy: { admittedAt: "desc" },
        });
        if (!encounter) {
          const currencyId = await resolveCountryCurrency(tx, countryId);
          const encounterNumber = await nextEncounterNumber(tx, orgId);
          encounter = await tx.encounter.create({
            data: {
              countryId,
              organizationId: orgId,
              establishmentId: estId,
              patientId,
              admissionType: "EMERGENCY",
              encounterNumber,
              admittedAt: new Date(),
              currencyId,
              exchangeRateToFunc: 1,
              createdBy: userId,
            },
          });
        }

        // 3. Resolver flowchart "general" + nivel placeholder (BLUE).
        const flowchart = await tx.triageFlowchart.findFirst({
          where: { organizationId: orgId, active: true },
          orderBy: { name: "asc" },
          select: { id: true },
        });
        if (!flowchart) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No hay flowchart Manchester activo configurado.",
          });
        }
        const placeholderLevel = await tx.triageLevel.findFirst({
          where: { organizationId: orgId, active: true },
          orderBy: { priority: "desc" }, // priority=5 (BLUE) primero
          select: { id: true },
        });
        if (!placeholderLevel) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Niveles Manchester no seedeados.",
          });
        }

        // 4. Crear TriageEvaluation IN_PROGRESS.
        const triage = await tx.triageEvaluation.create({
          data: {
            countryId,
            organizationId: orgId,
            establishmentId: estId,
            patientId,
            encounterId: encounter.id,
            flowchartId: flowchart.id,
            assignedLevelId: placeholderLevel.id, // placeholder; US-6.4 sobre-escribe.
            status: "IN_PROGRESS",
            startedAt: new Date(),
            triagistUserId: userId,
            createdBy: userId,
          },
          select: { id: true },
        });

        return {
          encounterId: encounter.id,
          triageEvaluationId: triage.id,
          patientId,
        };
      });
    }),

  /**
   * US-6.2 — Captura bulk de signos vitales en una evaluación abierta.
   * Devuelve las alertas computadas (no se persisten — TODO Sprint 6).
   */
  recordVitals: tenantProcedure
    .input(recordVitalsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const evaluation = await ctx.prisma.triageEvaluation.findFirst({
        where: {
          id: input.triageEvaluationId,
          organizationId: ctx.tenant.organizationId,
        },
        select: { id: true, status: true },
      });
      if (!evaluation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Evaluación de triage no existe." });
      }
      if (evaluation.status === "COMPLETED" || evaluation.status === "CANCELLED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "La evaluación está cerrada — no se pueden registrar más signos.",
        });
      }

      // Dedupe en memoria por (vitalCode, takenAt) para no chocar con el unique
      // (evaluationId, vitalCode, measuredAt) del schema.
      const baseTime = new Date();
      const seen = new Set<string>();
      const data = input.vitals.map((v, idx) => {
        const r = VITAL_REASONABLE_RANGES[v.vitalCode];
        let measuredAt = v.takenAt ?? baseTime;
        // Si dos vitales del mismo código llegan con el mismo timestamp,
        // desplazamos +1ms por índice para no violar el UNIQUE.
        const k = `${v.vitalCode}-${measuredAt.toISOString()}`;
        if (seen.has(k)) {
          measuredAt = new Date(measuredAt.getTime() + idx + 1);
        }
        seen.add(`${v.vitalCode}-${measuredAt.toISOString()}`);
        return {
          evaluationId: evaluation.id,
          vitalCode: v.vitalCode,
          valueNumeric: v.valueNumeric ?? null,
          valueText: v.valueText ?? null,
          unit: v.unit ?? r.unit,
          measuredAt,
        };
      });

      const result = await ctx.prisma.triageVitalSign.createMany({
        data,
        skipDuplicates: true,
      });

      const alerts = computeServerAlerts(
        input.vitals.map((v) => ({ vitalCode: v.vitalCode, valueNumeric: v.valueNumeric ?? null })),
      );
      return { inserted: result.count, alerts };
    }),

  /**
   * US-6.1 / US-6.2 — contadores para el dashboard de recepción.
   * Útil para mostrar "X esperando triage", "Y con vitales pendientes".
   */
  dashboardCounts: tenantProcedure.query(async ({ ctx }) => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const [waitingTriage, inProgress, completedToday, withoutVitals] = await Promise.all([
      ctx.prisma.encounter.count({
        where: {
          organizationId: ctx.tenant.organizationId,
          admissionType: "EMERGENCY",
          dischargedAt: null,
          admittedAt: { gte: since },
          triages: { none: {} },
        },
      }),
      ctx.prisma.triageEvaluation.count({
        where: {
          organizationId: ctx.tenant.organizationId,
          status: "IN_PROGRESS",
          startedAt: { gte: since },
        },
      }),
      ctx.prisma.triageEvaluation.count({
        where: {
          organizationId: ctx.tenant.organizationId,
          status: "COMPLETED",
          completedAt: { gte: since },
        },
      }),
      ctx.prisma.triageEvaluation.count({
        where: {
          organizationId: ctx.tenant.organizationId,
          status: "IN_PROGRESS",
          startedAt: { gte: since },
          vitalSigns: { none: {} },
        },
      }),
    ]);

    return { waitingTriage, inProgress, completedToday, withoutVitals };
  }),
});

