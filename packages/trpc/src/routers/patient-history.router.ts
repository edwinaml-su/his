/**
 * US-4.8 — Antecedentes clínicos (familiares, personales, gineco-obstétricos,
 * pediátricos).
 *
 * Estrategia de almacenamiento (MVP, sin migración):
 *  - Cada `update` crea una entrada en `audit.AuditLog` con:
 *      entity     = "PatientHistory"
 *      entityId   = patientId
 *      action     = UPDATE
 *      afterJson  = { op: "PATIENT_HISTORY_UPDATED", history: <PatientHistory> }
 *  - El `get` lee el último log de ese (entity, entityId) — eso es el snapshot vigente.
 *  - Toda la historia de cambios queda automáticamente versionada (append-only).
 *
 * Limitaciones conocidas:
 *  - O(N) por paciente cuando el paciente tiene MUCHAS actualizaciones; en MVP
 *    el número de updates por paciente es bajo (<50). Sprint 4 introducirá tabla
 *    `PatientMedicalHistory` denormalizada para acceso O(1) y deja audit log como
 *    histórico.
 *  - No hay validación cross-field automática (ej: gpac.P + gpac.A + gpac.C ≤ G).
 *    El front muestra warnings pero no bloquea el save.
 *
 * Las alergias siguen viviendo en `PatientAllergy` (estructura tipada). El bloque
 * `personal.allergyRefs` es solo array de IDs — sin duplicación.
 */
import { TRPCError } from "@trpc/server";
import {
  patientHistoryGetInput,
  patientHistoryUpdateInput,
  patientHistorySchema,
  PATIENT_HISTORY_ENTITY,
  PATIENT_HISTORY_OP,
  type PatientHistory,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

/** Default vacío para pacientes sin historia previa. */
function emptyHistory(): PatientHistory {
  return {
    familial: {
      diabetes: false,
      hypertension: false,
      cancer: { present: false, detail: null },
      heartDisease: false,
      mentalIllness: false,
      other: null,
    },
    personal: {
      chronicConditions: [],
      surgeries: [],
      allergyRefs: [],
      medications: [],
      habits: { tobacco: false, alcohol: false, drugs: false, detail: null },
    },
    gyneco: null,
    pediatric: null,
  };
}

export const patientHistoryRouter = router({
  // ===========================================================================
  // get — reconstruye el último snapshot desde audit log.
  // ===========================================================================
  get: tenantProcedure.input(patientHistoryGetInput).query(async ({ ctx, input }) => {
    const orgId = ctx.tenant.organizationId;

    // Verifica acceso al paciente (tenant scoping).
    const patient = await ctx.prisma.patient.findFirst({
      where: { id: input.patientId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
    }

    const last = await ctx.prisma.auditLog.findFirst({
      where: {
        entity: PATIENT_HISTORY_ENTITY,
        entityId: input.patientId,
        organizationId: orgId,
      },
      orderBy: { occurredAt: "desc" },
      select: { afterJson: true, occurredAt: true, userId: true },
    });

    if (!last?.afterJson) {
      return {
        patientId: input.patientId,
        history: emptyHistory(),
        updatedAt: null,
        updatedBy: null,
      };
    }

    // afterJson es JSON — validamos shape antes de devolver. Si la estructura
    // ha evolucionado (ej. nueva columna en futuro), el schema parser hará
    // best-effort con defaults.
    const raw = (last.afterJson as { history?: unknown }).history;
    const parsed = patientHistorySchema.safeParse(raw);
    if (!parsed.success) {
      // Devolvemos vacío + flag para que el front muestre el log como diagnóstico.
      return {
        patientId: input.patientId,
        history: emptyHistory(),
        updatedAt: last.occurredAt,
        updatedBy: last.userId,
        parseError: parsed.error.flatten(),
      };
    }

    return {
      patientId: input.patientId,
      history: parsed.data,
      updatedAt: last.occurredAt,
      updatedBy: last.userId,
    };
  }),

  // ===========================================================================
  // update — graba un nuevo snapshot completo (audit append).
  // ===========================================================================
  update: tenantProcedure
    .input(patientHistoryUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      const patient = await ctx.prisma.patient.findFirst({
        where: { id: input.patientId, organizationId: orgId, deletedAt: null },
        include: { biologicalSex: true },
      });
      if (!patient) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
      }

      // Validación contextual: gineco solo aplica a pacientes con sexo biológico F.
      if (input.history.gyneco && patient.biologicalSex?.code !== "F") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Antecedentes ginecobstétricos solo aplican a pacientes con sexo biológico femenino.",
        });
      }

      // Lectura del snapshot anterior (para beforeJson en audit).
      const prev = await ctx.prisma.auditLog.findFirst({
        where: {
          entity: PATIENT_HISTORY_ENTITY,
          entityId: input.patientId,
          organizationId: orgId,
        },
        orderBy: { occurredAt: "desc" },
        select: { afterJson: true },
      });

      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.id,
          organizationId: orgId,
          establishmentId: ctx.tenant.establishmentId ?? null,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          action: "UPDATE",
          entity: PATIENT_HISTORY_ENTITY,
          entityId: input.patientId,
          beforeJson: prev?.afterJson ?? null,
          afterJson: {
            op: PATIENT_HISTORY_OP,
            history: input.history,
          },
        },
      });

      return { ok: true as const, patientId: input.patientId };
    }),
});
