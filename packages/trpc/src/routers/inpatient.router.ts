/**
 * §11 Inpatient — router (Wave 7 / Phase 2).
 *
 * Beta.1 hardening (2026-05-13):
 * - State machine validada (ACTIVE → ON_LEAVE → ACTIVE → DISCHARGED|TRANSFERRED_OUT).
 * - Vital signs alerts automáticos basados en umbrales adulto.
 * - Auto-link de cama al admit (BedAssignment con onConflict idempotente).
 * - Kardex append-only (router NO expone update; sólo create).
 * - Procedures adicionales: goOnLeave, returnFromLeave, transferOut.
 *
 * Reglas de transición fina extras (LOS automático, alta vs muerte, escalación
 * de cuidados, infecciones nosocomiales) se cubren en Wave 2.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  inpatientAdmissionCreateInput,
  inpatientAdmissionListInput,
  inpatientAdmissionDischargeInput,
  inpatientAdmissionGoOnLeaveInput,
  inpatientAdmissionReturnFromLeaveInput,
  inpatientAdmissionTransferOutInput,
  inpatientVitalsRecordInput,
  inpatientKardexCreateInput,
  inpatientCarePlanCreateInput,
  inpatientCarePlanUpdateStatusInput,
  canTransitionInpatient,
  isTerminalInpatientStatus,
  evaluateVitalAlerts,
  type InpatientStatusType,
  type InpatientVitalAlert,
  type VitalCriticalPayload,
} from "@his/contracts";
import { emitDomainEvent } from "@his/database";
import { router, tenantProcedure } from "../trpc";

/**
 * Beta.15 — mapping del shape interno de `evaluateVitalAlerts`
 * (`InpatientVitalAlert.field` en camelCase + severity lowercase) al shape
 * del payload Zod del DomainEvent `vital.critical`
 * (`parameter` enum uppercase + severity uppercase).
 *
 * `painScale` se mapea para coherencia, aunque el dispatcher típicamente
 * lo ignora (informativo, no clínicamente crítico).
 */
const VITAL_FIELD_TO_PARAMETER = {
  temperatureC: "TEMP",
  heartRate: "HR",
  respiratoryRate: "RR",
  systolicBp: "BP_SYS",
  diastolicBp: "BP_DIA",
  spo2: "SPO2",
  painScale: "PAIN",
} as const satisfies Record<string, VitalCriticalPayload["alerts"][number]["parameter"]>;

type MappableField = keyof typeof VITAL_FIELD_TO_PARAMETER;

function toPayloadAlert(
  alert: InpatientVitalAlert,
): VitalCriticalPayload["alerts"][number] | null {
  const parameter = VITAL_FIELD_TO_PARAMETER[alert.field as MappableField];
  if (!parameter) return null;
  // Payload solo admite CRITICAL/WARNING — INFO se descarta (no es crítico).
  if (alert.severity === "info") return null;
  return {
    parameter,
    value: alert.value,
    severity: alert.severity === "critical" ? "CRITICAL" : "WARNING",
    message: alert.reason,
  };
}

export const inpatientRouter = router({
  admission: router({
    list: tenantProcedure
      .input(inpatientAdmissionListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.inpatientAdmission.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
            ...(input.status && { status: input.status }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.attendingId && { attendingId: input.attendingId }),
            ...(input.establishmentId && {
              establishmentId: input.establishmentId,
            }),
            ...(input.costCenterId && { costCenterId: input.costCenterId }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            attending: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { admittedAt: "desc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.inpatientAdmission.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    create: tenantProcedure
      .input(inpatientAdmissionCreateInput)
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

        // Beta.1 — validar cama si viene en el input (debe ser misma org + status FREE).
        if (input.bedId) {
          const bed = await ctx.prisma.bed.findFirst({
            where: {
              id: input.bedId,
              organizationId: ctx.tenant.organizationId,
              active: true,
            },
            select: { id: true, status: true, establishmentId: true },
          });
          if (!bed) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Cama no existe en la organización.",
            });
          }
          if (bed.status !== "FREE") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `La cama no está disponible (status=${bed.status}).`,
            });
          }
          if (bed.establishmentId !== input.establishmentId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "La cama pertenece a un establecimiento distinto del de la admisión.",
            });
          }
        }

        // Crear admisión + (opcional) bed assignment en transacción atómica.
        return ctx.prisma.$transaction(async (tx) => {
          const admission = await tx.inpatientAdmission.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              establishmentId: input.establishmentId,
              encounterId: input.encounterId,
              patientId: input.patientId,
              attendingId: input.attendingId,
              reason: input.reason,
              expectedLos: input.expectedLos ?? null,
              notes: input.notes ?? null,
              costCenterId: input.costCenterId ?? null,
              createdBy: ctx.user.id,
            },
          });

          if (input.bedId) {
            await tx.bedAssignment.create({
              data: {
                encounterId: input.encounterId,
                bedId: input.bedId,
                reason: input.bedAssignmentReason ?? "Admit a hospitalización.",
                createdBy: ctx.user.id,
              },
            });
            await tx.bed.update({
              where: { id: input.bedId },
              data: { status: "OCCUPIED" },
            });
          }

          return admission;
        });
      }),

    /**
     * Beta.1 — Transición ACTIVE → DISCHARGED. Libera cama si la admisión tenía
     * BedAssignment activa.
     */
    discharge: tenantProcedure
      .input(inpatientAdmissionDischargeInput)
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.$transaction(async (tx) => {
          const adm = await tx.inpatientAdmission.findFirst({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              deletedAt: null,
            },
            select: { id: true, status: true, encounterId: true },
          });
          if (!adm) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Admisión no existe en la organización.",
            });
          }
          if (!canTransitionInpatient(adm.status as InpatientStatusType, "DISCHARGED")) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Transición inválida: ${adm.status} → DISCHARGED.`,
            });
          }

          await tx.inpatientAdmission.update({
            where: { id: adm.id },
            data: {
              status: "DISCHARGED",
              dischargedAt: new Date(),
              ...(input.notes && { notes: input.notes }),
              updatedBy: ctx.user.id,
            },
          });

          await releaseActiveBeds(tx, adm.encounterId);

          return { ok: true as const };
        });
      }),

    /** Beta.1 — Transición ACTIVE → ON_LEAVE (permiso pase domiciliario). */
    goOnLeave: tenantProcedure
      .input(inpatientAdmissionGoOnLeaveInput)
      .mutation(async ({ ctx, input }) => {
        const adm = await ctx.prisma.inpatientAdmission.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, status: true, notes: true },
        });
        if (!adm) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Admisión no existe en la organización.",
          });
        }
        if (!canTransitionInpatient(adm.status as InpatientStatusType, "ON_LEAVE")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Transición inválida: ${adm.status} → ON_LEAVE.`,
          });
        }
        await ctx.prisma.inpatientAdmission.update({
          where: { id: adm.id },
          data: {
            status: "ON_LEAVE",
            notes: appendNoteLine(adm.notes, `[ON_LEAVE] ${input.reason}`),
            updatedBy: ctx.user.id,
          },
        });
        return { ok: true as const };
      }),

    /** Beta.1 — Transición ON_LEAVE → ACTIVE. */
    returnFromLeave: tenantProcedure
      .input(inpatientAdmissionReturnFromLeaveInput)
      .mutation(async ({ ctx, input }) => {
        const adm = await ctx.prisma.inpatientAdmission.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, status: true, notes: true },
        });
        if (!adm) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Admisión no existe en la organización.",
          });
        }
        if (!canTransitionInpatient(adm.status as InpatientStatusType, "ACTIVE")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Transición inválida: ${adm.status} → ACTIVE.`,
          });
        }
        await ctx.prisma.inpatientAdmission.update({
          where: { id: adm.id },
          data: {
            status: "ACTIVE",
            notes: appendNoteLine(
              adm.notes,
              `[RETURN] ${input.notes ?? "Retorno de permiso."}`,
            ),
            updatedBy: ctx.user.id,
          },
        });
        return { ok: true as const };
      }),

    /** Beta.1 — Transición ACTIVE → TRANSFERRED_OUT (a otra organización). */
    transferOut: tenantProcedure
      .input(inpatientAdmissionTransferOutInput)
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.$transaction(async (tx) => {
          const adm = await tx.inpatientAdmission.findFirst({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              deletedAt: null,
            },
            select: { id: true, status: true, notes: true, encounterId: true },
          });
          if (!adm) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Admisión no existe en la organización.",
            });
          }
          if (
            !canTransitionInpatient(
              adm.status as InpatientStatusType,
              "TRANSFERRED_OUT",
            )
          ) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Transición inválida: ${adm.status} → TRANSFERRED_OUT.`,
            });
          }
          await tx.inpatientAdmission.update({
            where: { id: adm.id },
            data: {
              status: "TRANSFERRED_OUT",
              dischargedAt: new Date(),
              notes: appendNoteLine(
                adm.notes,
                `[TRANSFER_OUT to ${input.destinationName}] ${input.reason}${
                  input.notes ? ` — ${input.notes}` : ""
                }`,
              ),
              updatedBy: ctx.user.id,
            },
          });

          await releaseActiveBeds(tx, adm.encounterId);

          return { ok: true as const };
        });
      }),
  }),

  vitals: router({
    /**
     * Beta.1 — registro de vitales con generación automática de alertas
     * basadas en umbrales adulto. Las alertas se devuelven al cliente
     * inline.
     *
     * Beta.15 (US.B15.4.1) — si alguna alerta es CRITICAL, se emite un
     * `DomainEvent vital.critical` en la misma transacción que el create
     * (outbox transaccional). El dispatcher resuelve al médico tratante.
     */
    record: tenantProcedure
      .input(inpatientVitalsRecordInput)
      .mutation(async ({ ctx, input }) => {
        const adm = await ctx.prisma.inpatientAdmission.findFirst({
          where: {
            id: input.admissionId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, status: true, patientId: true },
        });
        if (!adm) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Admisión no existe en la organización.",
          });
        }
        if (isTerminalInpatientStatus(adm.status as InpatientStatusType)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `No se pueden registrar vitales en admisión ${adm.status}.`,
          });
        }
        const alerts = evaluateVitalAlerts({
          temperatureC: input.temperatureC ?? null,
          heartRate: input.heartRate ?? null,
          respiratoryRate: input.respiratoryRate ?? null,
          systolicBp: input.systolicBp ?? null,
          diastolicBp: input.diastolicBp ?? null,
          spo2: input.spo2 ?? null,
          painScale: input.painScale ?? null,
        });
        const hasCritical = alerts.some((a) => a.severity === "critical");

        const vitals = await ctx.prisma.$transaction(async (tx) => {
          const created = await tx.inpatientVitals.create({
            data: {
              admissionId: input.admissionId,
              recordedById: ctx.user.id,
              temperatureC: input.temperatureC ?? null,
              heartRate: input.heartRate ?? null,
              respiratoryRate: input.respiratoryRate ?? null,
              systolicBp: input.systolicBp ?? null,
              diastolicBp: input.diastolicBp ?? null,
              spo2: input.spo2 ?? null,
              painScale: input.painScale ?? null,
              notes: input.notes ?? null,
            },
          });
          if (hasCritical) {
            const payloadAlerts = alerts
              .map(toPayloadAlert)
              .filter((a): a is NonNullable<typeof a> => a !== null);
            // Defensa: si el mapeo no produce alerts (shouldn't, ya validamos
            // hasCritical), no emitimos — el payload Zod exige min(1).
            if (payloadAlerts.length > 0) {
              await emitDomainEvent(tx, {
                organizationId: ctx.tenant.organizationId,
                eventType: "vital.critical",
                aggregateType: "InpatientVitals",
                aggregateId: created.id,
                emittedById: ctx.user.id,
                payload: {
                  source: "InpatientVitals",
                  admissionId: adm.id,
                  patientId: adm.patientId,
                  sourceRowId: created.id,
                  alerts: payloadAlerts,
                } satisfies VitalCriticalPayload,
              });
            }
          }
          return created;
        });

        return { vitals, alerts };
      }),

    listByAdmission: tenantProcedure
      .input(z.object({ admissionId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }))
      .query(async ({ ctx, input }) => {
        return ctx.prisma.inpatientVitals.findMany({
          where: {
            admissionId: input.admissionId,
            admission: { organizationId: ctx.tenant.organizationId },
          },
          orderBy: { recordedAt: "desc" },
          take: input.limit,
        });
      }),
  }),

  kardex: router({
    /**
     * Beta.1 — el router SÓLO admite create. NO se exponen update ni delete.
     * Esto enforza el principio append-only documentado en TDR §11.3.
     * Errores de redacción se corrigen con una nueva entrada que referencie
     * la previa en texto libre (Wave 2: campo amendOfId formal).
     */
    create: tenantProcedure
      .input(inpatientKardexCreateInput)
      .mutation(async ({ ctx, input }) => {
        const adm = await ctx.prisma.inpatientAdmission.findFirst({
          where: {
            id: input.admissionId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, status: true },
        });
        if (!adm) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Admisión no existe en la organización.",
          });
        }
        if (isTerminalInpatientStatus(adm.status as InpatientStatusType)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `No se pueden agregar entradas de kardex en admisión ${adm.status}.`,
          });
        }
        return ctx.prisma.inpatientKardex.create({
          data: {
            admissionId: input.admissionId,
            recordedById: ctx.user.id,
            category: input.category,
            entry: input.entry,
            shift: input.shift ?? null,
          },
        });
      }),
  }),

  carePlan: router({
    create: tenantProcedure
      .input(inpatientCarePlanCreateInput)
      .mutation(async ({ ctx, input }) => {
        const adm = await ctx.prisma.inpatientAdmission.findFirst({
          where: {
            id: input.admissionId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, status: true },
        });
        if (!adm) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Admisión no existe en la organización.",
          });
        }
        if (isTerminalInpatientStatus(adm.status as InpatientStatusType)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `No se pueden crear planes en admisión ${adm.status}.`,
          });
        }
        return ctx.prisma.inpatientCarePlan.create({
          data: {
            admissionId: input.admissionId,
            title: input.title,
            goal: input.goal ?? null,
            interventions: input.interventions ?? null,
            createdById: ctx.user.id,
          },
        });
      }),

    updateStatus: tenantProcedure
      .input(inpatientCarePlanUpdateStatusInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.inpatientCarePlan.updateMany({
          where: {
            id: input.id,
            admission: { organizationId: ctx.tenant.organizationId },
          },
          data: {
            status: input.status,
            ...(input.status === "COMPLETED" && { completedAt: new Date() }),
          },
        });
        if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      }),
  }),
});

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

interface BedReleaseTx {
  bedAssignment: {
    findMany: (args: unknown) => Promise<Array<{ id: string; bedId: string }>>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  bed: { update: (args: unknown) => Promise<unknown> };
}

/**
 * Beta.1 — libera (releasedAt = now) todas las bed assignments activas del
 * encuentro y vuelve la cama a status FREE. Idempotente.
 */
async function releaseActiveBeds(
  tx: unknown,
  encounterId: string,
): Promise<void> {
  const txTyped = tx as BedReleaseTx;
  const active = await txTyped.bedAssignment.findMany({
    where: { encounterId, releasedAt: null },
  });
  if (active.length === 0) return;
  const now = new Date();
  await txTyped.bedAssignment.updateMany({
    where: { encounterId, releasedAt: null },
    data: { releasedAt: now },
  });
  for (const a of active) {
    await txTyped.bed.update({
      where: { id: a.bedId },
      data: { status: "FREE" },
    });
  }
}

/** Append-only de notas. Conserva contenido previo y agrega línea con timestamp. */
function appendNoteLine(prev: string | null, line: string): string {
  const ts = new Date().toISOString();
  const newLine = `[${ts}] ${line}`;
  return prev && prev.length > 0 ? `${prev}\n${newLine}` : newLine;
}
