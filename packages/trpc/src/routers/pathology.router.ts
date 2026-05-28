/**
 * §16 Patología / Anatomía Patológica — router (Beta.17).
 *
 * State machines:
 *   PathologyOrder:   REQUESTED → COLLECTING → IN_PROCESS → REPORTED | CANCELLED
 *   PathologySpecimen: RECEIVED → GROSSING → PROCESSED → REPORTED | ARCHIVED | DISCARDED
 *   PathologyReport:  DRAFT → PRELIMINARY → FINAL (immutable post-sign) | AMENDED
 *
 * Eventos de dominio:
 *   pathology.reportSigned   — al firmar (sign); destinatario: médico solicitante.
 *   pathology.criticalFinding — al firmar con criticalFinding=true; destinatarios:
 *                               médico solicitante + serviceHeadId (opcional).
 *
 * ADR 0004: PathologyReport.status=FINAL es inmutable. AMENDED crea nueva fila
 *   con amendedFromId apuntando al reporte original.
 *
 * RLS: withTenantContext en TODA operación que toca tablas tenant-scoped.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { emitDomainEvent } from "@his/database";
import { argon2 } from "@his/infrastructure";
import { router, requireRole, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";
import type {
  PathologyReportSignedPayload,
  PathologyCriticalFindingPayload,
} from "@his/contracts";

// ---------------------------------------------------------------------------
// Schemas de input Zod
// ---------------------------------------------------------------------------

const uuidInput = z.string().uuid();

const orderCreateInput = z.object({
  encounterId: uuidInput,
  patientId: uuidInput,
  studyType: z.enum([
    "HISTOPATHOLOGY",
    "CYTOLOGY",
    "BIOPSY",
    "IMMUNOHISTOCHEMISTRY",
    "AUTOPSY",
  ]),
  clinicalIndication: z.string().max(2000).optional(),
  suspectedDiagnosis: z.string().max(500).optional(),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]).default("ROUTINE"),
});

const orderListInput = z.object({
  patientId: uuidInput.optional(),
  encounterId: uuidInput.optional(),
  status: z
    .enum(["REQUESTED", "COLLECTING", "IN_PROCESS", "REPORTED", "CANCELLED"])
    .optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const specimenReceiveInput = z.object({
  orderId: uuidInput,
  anatomicSite: z.string().min(1).max(300),
  snomedCode: z.string().max(20).optional(),
  collectionMethod: z.string().max(100).optional(),
  fixative: z.enum(["FORMALIN", "FRESH", "FROZEN", "OTHER"]).default("FORMALIN"),
  blockCount: z.number().int().min(0).default(0),
  slideCount: z.number().int().min(0).default(0),
});

const specimenGrossInput = z.object({
  specimenId: uuidInput,
  description: z.string().min(1),
  dimensions: z.string().max(100).optional(),
  weightGrams: z.number().positive().optional(),
  color: z.string().max(100).optional(),
  photoUrls: z.array(z.string().url()).default([]),
});

const specimenMicroInput = z.object({
  specimenId: uuidInput,
  description: z.string().min(1),
  stains: z.array(z.string().min(1).max(40)).min(1),
});

const reportDraftInput = z.object({
  orderId: uuidInput,
  primaryDiagnosis: z.string().min(1),
  secondaryDiagnoses: z.array(z.string()).default([]),
  diagnosisCodes: z.array(z.string().max(20)).default([]),
  tnmStaging: z.string().max(50).optional(),
  tumorGrade: z.string().max(20).optional(),
  criticalFinding: z.boolean().default(false),
});

const reportSignInput = z.object({
  reportId: uuidInput,
  /** PIN argon2id del patólogo — requerido para firma legal (TDR §8.16). */
  pin: z.string().min(4).max(8),
  /** Permite emitir criticalFinding a un jefe de servicio adicional. */
  serviceHeadId: uuidInput.optional(),
});

const reportAmendInput = z.object({
  originalReportId: uuidInput,
  amendmentReason: z.string().min(1),
  primaryDiagnosis: z.string().min(1),
  secondaryDiagnoses: z.array(z.string()).default([]),
  diagnosisCodes: z.array(z.string().max(20)).default([]),
  tnmStaging: z.string().max(50).optional(),
  tumorGrade: z.string().max(20).optional(),
  criticalFinding: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Helpers internos — firma electrónica argon2id
// ---------------------------------------------------------------------------

/** Tipo mínimo de transacción Prisma que soporta raw SQL. */
type RawTx = {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
};

const LOCKOUT_MAX = 5;

/**
 * Verifica el PIN argon2id del patólogo contra `ece.firma_electronica`.
 * Replica el patrón de `solicitud-estudio.router.ts` (misma tabla de firma).
 * Lanza TRPCError si:
 *   - No existe personal_salud vinculado al his_user_id.
 *   - No hay firma electrónica configurada.
 *   - La firma está bloqueada por intentos fallidos.
 *   - El PIN es incorrecto (incrementa failed_attempts, puede bloquear).
 */
async function verifyPinOrThrow(
  tx: RawTx,
  hisUserId: string,
  pin: string,
): Promise<void> {
  interface PersonalRow { id: string }
  interface FirmaRow {
    id: string;
    pin_hash: string;
    failed_attempts: number;
    locked_until: Date | null;
  }

  const personalRows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<PersonalRow[]>)`
    SELECT id::text
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid AND activo = true
    LIMIT 1
  `;
  const personal = personalRows[0] ?? null;
  if (!personal) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se encontró un profesional de salud asociado a su cuenta.",
    });
  }

  const firmaRows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<FirmaRow[]>)`
    SELECT id::text, pin_hash, failed_attempts, locked_until
    FROM ece.firma_electronica
    WHERE personal_id = ${personal.id}::uuid AND revoked_at IS NULL
    LIMIT 1
  `;
  const firma = firmaRows[0] ?? null;
  if (!firma) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Firma electrónica no configurada.",
    });
  }

  if (firma.locked_until !== null && new Date(firma.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(firma.locked_until).getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada. Inténtelo en ${mins} min.`,
    });
  }

  const valid = await argon2.verify(firma.pin_hash, pin);
  if (!valid) {
    await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
      UPDATE ece.firma_electronica
      SET failed_attempts = failed_attempts + 1
      WHERE id = ${firma.id}::uuid
    `;
    const remaining = LOCKOUT_MAX - (firma.failed_attempts + 1);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        remaining > 0
          ? `PIN incorrecto. Intentos restantes: ${remaining}.`
          : "PIN incorrecto. La firma quedará bloqueada.",
    });
  }

  // Reset del contador de intentos fallidos en verificación exitosa.
  await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
    UPDATE ece.firma_electronica SET failed_attempts = 0 WHERE id = ${firma.id}::uuid
  `;
}

// ---------------------------------------------------------------------------
// Helpers de validación de state machine
// ---------------------------------------------------------------------------

const ORDER_CANCEL_ALLOWED: string[] = ["REQUESTED", "COLLECTING"];

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const pathologyRouter = router({
  order: router({
    /**
     * Lista solicitudes de patología del tenant.
     * Accesible para cualquier usuario autenticado con tenant (lectura).
     */
    list: tenantProcedure.input(orderListInput).query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.pathologyOrder.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.encounterId && { encounterId: input.encounterId }),
            ...(input.status && { status: input.status }),
          },
          include: {
            specimens: { select: { id: true, anatomicSite: true, status: true } },
            report: { select: { id: true, status: true, criticalFinding: true } },
          },
          orderBy: { requestedAt: "desc" },
          take: input.limit,
        });
      });
    }),

    /**
     * Crea solicitud de estudio. Solo PHYSICIAN puede solicitar.
     */
    create: requireRole(["PHYSICIAN", "ADMIN_ORG"])
      .input(orderCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // Verifica que el encuentro pertenezca al tenant y al paciente declarado.
          const enc = await tx.encounter.findFirst({
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
              message: "patientId no coincide con el encounter.",
            });
          }

          return tx.pathologyOrder.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              encounterId: input.encounterId,
              patientId: input.patientId,
              requestingPhysicianId: ctx.user.id,
              studyType: input.studyType,
              clinicalIndication: input.clinicalIndication ?? null,
              suspectedDiagnosis: input.suspectedDiagnosis ?? null,
              priority: input.priority,
              status: "REQUESTED",
            },
          });
        });
      }),

    /**
     * Cancela una solicitud. Solo se puede cancelar en estado REQUESTED o COLLECTING.
     */
    cancel: requireRole(["PHYSICIAN", "ADMIN_ORG"])
      .input(z.object({ id: uuidInput }))
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const order = await tx.pathologyOrder.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId },
            select: { id: true, status: true },
          });
          if (!order) throw new TRPCError({ code: "NOT_FOUND" });
          if (!ORDER_CANCEL_ALLOWED.includes(order.status)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `No se puede cancelar una orden en estado ${order.status}.`,
            });
          }
          return tx.pathologyOrder.update({
            where: { id: input.id },
            data: { status: "CANCELLED" },
          });
        });
      }),
  }),

  specimen: router({
    /**
     * Recepción del espécimen en el laboratorio de patología.
     * Rol: técnico de laboratorio o patólogo.
     * Transiciona la orden a IN_PROCESS (si aún no estaba).
     */
    receive: requireRole(["PATHOLOGY_TECHNICIAN", "LAB_TECHNICIAN", "PATHOLOGIST"])
      .input(specimenReceiveInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const order = await tx.pathologyOrder.findFirst({
            where: { id: input.orderId, organizationId: ctx.tenant.organizationId },
            select: { id: true, status: true },
          });
          if (!order) throw new TRPCError({ code: "NOT_FOUND" });
          if (order.status === "CANCELLED") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "No se puede recibir espécimen de una orden cancelada.",
            });
          }

          const [specimen] = await Promise.all([
            tx.pathologySpecimen.create({
              data: {
                orderId: input.orderId,
                anatomicSite: input.anatomicSite,
                snomedCode: input.snomedCode ?? null,
                collectionMethod: input.collectionMethod ?? null,
                fixative: input.fixative,
                blockCount: input.blockCount,
                slideCount: input.slideCount,
                receivedById: ctx.user.id,
                status: "RECEIVED",
              },
            }),
            // Transiciona la orden a IN_PROCESS si aún está en estado previo.
            order.status !== "IN_PROCESS"
              ? tx.pathologyOrder.update({
                  where: { id: input.orderId },
                  data: { status: "IN_PROCESS" },
                })
              : Promise.resolve(null),
          ]);

          return specimen;
        });
      }),

    /**
     * Descripción macroscópica del espécimen. Solo PATHOLOGIST.
     * Transiciona el espécimen a GROSSING.
     */
    gross: requireRole(["PATHOLOGIST"])
      .input(specimenGrossInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // Verifica que el espécimen sea de la organización actual.
          const specimen = await tx.pathologySpecimen.findFirst({
            where: {
              id: input.specimenId,
              order: { organizationId: ctx.tenant.organizationId },
            },
            select: { id: true, status: true },
          });
          if (!specimen) throw new TRPCError({ code: "NOT_FOUND" });

          const [macro] = await Promise.all([
            tx.pathologyMacroDescription.create({
              data: {
                specimenId: input.specimenId,
                pathologistId: ctx.user.id,
                description: input.description,
                dimensions: input.dimensions ?? null,
                weightGrams: input.weightGrams ?? null,
                color: input.color ?? null,
                photoUrls: input.photoUrls,
              },
            }),
            specimen.status === "RECEIVED"
              ? tx.pathologySpecimen.update({
                  where: { id: input.specimenId },
                  data: { status: "GROSSING" },
                })
              : Promise.resolve(null),
          ]);

          return macro;
        });
      }),

    /**
     * Descripción microscópica del espécimen. Solo PATHOLOGIST.
     * Transiciona el espécimen a PROCESSED.
     */
    micro: requireRole(["PATHOLOGIST"])
      .input(specimenMicroInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const specimen = await tx.pathologySpecimen.findFirst({
            where: {
              id: input.specimenId,
              order: { organizationId: ctx.tenant.organizationId },
            },
            select: { id: true, status: true },
          });
          if (!specimen) throw new TRPCError({ code: "NOT_FOUND" });

          const [micro] = await Promise.all([
            tx.pathologyMicroDescription.create({
              data: {
                specimenId: input.specimenId,
                pathologistId: ctx.user.id,
                description: input.description,
                stains: input.stains,
              },
            }),
            ["RECEIVED", "GROSSING"].includes(specimen.status)
              ? tx.pathologySpecimen.update({
                  where: { id: input.specimenId },
                  data: { status: "PROCESSED" },
                })
              : Promise.resolve(null),
          ]);

          return micro;
        });
      }),
  }),

  report: router({
    /**
     * Crea borrador del reporte de patología. Solo PATHOLOGIST.
     * Solo puede existir 1 reporte DRAFT/PRELIMINARY por orden.
     */
    draft: requireRole(["PATHOLOGIST"])
      .input(reportDraftInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const order = await tx.pathologyOrder.findFirst({
            where: { id: input.orderId, organizationId: ctx.tenant.organizationId },
            select: { id: true, status: true },
          });
          if (!order) throw new TRPCError({ code: "NOT_FOUND" });
          if (order.status === "CANCELLED") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "No se puede crear reporte para una orden cancelada.",
            });
          }

          // Verifica que no exista ya un reporte activo (DRAFT o PRELIMINARY).
          const existing = await tx.pathologyReport.findFirst({
            where: {
              orderId: input.orderId,
              status: { in: ["DRAFT", "PRELIMINARY"] },
            },
            select: { id: true },
          });
          if (existing) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Ya existe un reporte DRAFT o PRELIMINARY para esta orden.",
            });
          }

          return tx.pathologyReport.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              orderId: input.orderId,
              pathologistId: ctx.user.id,
              primaryDiagnosis: input.primaryDiagnosis,
              secondaryDiagnoses: input.secondaryDiagnoses,
              diagnosisCodes: input.diagnosisCodes,
              tnmStaging: input.tnmStaging ?? null,
              tumorGrade: input.tumorGrade ?? null,
              criticalFinding: input.criticalFinding,
              status: "DRAFT",
            },
          });
        });
      }),

    /**
     * Firma final del reporte (DRAFT/PRELIMINARY → FINAL).
     * Dispara eventos:
     *   - pathology.reportSigned (siempre)
     *   - pathology.criticalFinding (si criticalFinding=true)
     * Post-firma el reporte es inmutable (trigger SQL 46).
     */
    sign: requireRole(["PATHOLOGIST"])
      .input(reportSignInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // HH-18 (audit Stream H): firma de reporte patológico requiere PIN
          // argon2id del patólogo (TDR §8.16 — firma electrónica en documentos médicos).
          await verifyPinOrThrow(tx as unknown as RawTx, ctx.user.id, input.pin);

          const report = await tx.pathologyReport.findFirst({
            where: {
              id: input.reportId,
              organizationId: ctx.tenant.organizationId,
              status: { in: ["DRAFT", "PRELIMINARY"] },
            },
            include: {
              order: {
                select: {
                  id: true,
                  requestingPhysicianId: true,
                  patientId: true,
                },
              },
            },
          });
          if (!report) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Reporte no encontrado o ya se encuentra en estado FINAL/AMENDED.",
            });
          }

          const signedAt = new Date();

          // Actualiza el reporte a FINAL con signedAt.
          // El trigger `trg_pathology_report_immutable` permitirá este UPDATE
          // porque OLD.status != FINAL aún.
          const signed = await tx.pathologyReport.update({
            where: { id: input.reportId },
            data: {
              status: "FINAL",
              pathologistId: ctx.user.id,
              signedAt,
            },
          });

          // Transiciona la orden a REPORTED.
          await tx.pathologyOrder.update({
            where: { id: report.orderId },
            data: { status: "REPORTED" },
          });

          // Emite pathology.reportSigned (médico solicitante).
          const signedPayload: PathologyReportSignedPayload = {
            reportId: signed.id,
            orderId: report.orderId,
            requestingPhysicianId: report.order.requestingPhysicianId,
            pathologistId: ctx.user.id,
            primaryDiagnosis: signed.primaryDiagnosis,
          };
          await emitDomainEvent(tx, {
            organizationId: ctx.tenant.organizationId,
            eventType: "pathology.reportSigned",
            aggregateType: "PathologyReport",
            aggregateId: signed.id,
            emittedById: ctx.user.id,
            payload: signedPayload,
          });

          // Emite pathology.criticalFinding si aplica.
          if (signed.criticalFinding) {
            const criticalPayload: PathologyCriticalFindingPayload = {
              reportId: signed.id,
              orderId: report.orderId,
              requestingPhysicianId: report.order.requestingPhysicianId,
              ...(input.serviceHeadId && { serviceHeadId: input.serviceHeadId }),
              primaryDiagnosis: signed.primaryDiagnosis,
            };
            await emitDomainEvent(tx, {
              organizationId: ctx.tenant.organizationId,
              eventType: "pathology.criticalFinding",
              aggregateType: "PathologyReport",
              aggregateId: signed.id,
              emittedById: ctx.user.id,
              payload: criticalPayload,
            });
          }

          return signed;
        });
      }),

    /**
     * Enmienda un reporte FINAL (ADR 0004 — no se modifica el original).
     * Crea nueva fila con status=AMENDED y amendedFromId apuntando al original.
     * El reporte original permanece FINAL e inmutable.
     */
    amend: requireRole(["PATHOLOGIST"])
      .input(reportAmendInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const original = await tx.pathologyReport.findFirst({
            where: {
              id: input.originalReportId,
              organizationId: ctx.tenant.organizationId,
              status: "FINAL",
            },
            select: {
              id: true,
              orderId: true,
              order: { select: { requestingPhysicianId: true } },
            },
          });
          if (!original) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Reporte FINAL no encontrado. Solo se pueden enmendar reportes firmados.",
            });
          }

          return tx.pathologyReport.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              orderId: original.orderId,
              pathologistId: ctx.user.id,
              primaryDiagnosis: input.primaryDiagnosis,
              secondaryDiagnoses: input.secondaryDiagnoses,
              diagnosisCodes: input.diagnosisCodes,
              tnmStaging: input.tnmStaging ?? null,
              tumorGrade: input.tumorGrade ?? null,
              criticalFinding: input.criticalFinding,
              status: "AMENDED",
              amendmentReason: input.amendmentReason,
              amendedFromId: original.id,
            },
          });
        });
      }),

    /**
     * Obtiene un reporte con su orden y especímenes asociados.
     */
    get: tenantProcedure
      .input(z.object({ id: uuidInput }))
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const report = await tx.pathologyReport.findFirst({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
            },
            include: {
              order: {
                include: {
                  specimens: {
                    include: {
                      macroDescription: true,
                      microDescription: true,
                    },
                  },
                },
              },
              amendedFrom: { select: { id: true, status: true, signedAt: true } },
              amendments: { select: { id: true, status: true, createdAt: true } },
            },
          });
          if (!report) throw new TRPCError({ code: "NOT_FOUND" });
          return report;
        });
      }),
  }),
});
