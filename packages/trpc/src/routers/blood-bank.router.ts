/**
 * §15 Banco de Sangre / Hemoterapia — router (Beta.16).
 *
 * Procedures:
 *   bloodBank.unit.list           — listar unidades (filtros tipo/componente/estado)
 *   bloodBank.unit.create         — ingresar unidad nueva (LAB_TECHNICIAN | BLOOD_BANK_OFFICER)
 *   bloodBank.unit.discard        — descartar unidad (mismo rol, motivo obligatorio)
 *   bloodBank.request.create      — médico solicita transfusión (PHYSICIAN)
 *   bloodBank.request.cancel      — cancelar solicitud (PHYSICIAN)
 *   bloodBank.crossMatch.perform  — lab realiza prueba cruzada (LAB_TECHNICIAN)
 *   bloodBank.transfusion.start   — enfermero inicia (NURSE)
 *   bloodBank.transfusion.complete — enfermero cierra, captura reacciones (NURSE)
 *   bloodBank.transfusion.recordReaction — registrar reacción adversa (NURSE)
 *
 * Eventos de dominio:
 *   - crossMatch.perform con resultado incompatible/inconcluso → transfusion.crossmatchFailed
 *   - transfusion.recordReaction con severidad alta → transfusion.adverseReaction
 *
 * RLS: TODA query usa withTenantContext.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { emitDomainEvent } from "@his/database";
import { withTenantContext } from "../rls-context";
import { router, tenantProcedure, requireRole } from "../trpc";
import type {
  TransfusionCrossmatchFailedPayload,
  TransfusionAdverseReactionPayload,
} from "@his/contracts/events";

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const LAB_ROLES = ["LAB_TECHNICIAN", "BLOOD_BANK_OFFICER"];
const PHYSICIAN_ROLES = ["PHYSICIAN", "MEDICO"];
const NURSE_ROLES = ["NURSE", "ENFERMERO"];

// ---------------------------------------------------------------------------
// Inputs compartidos
// ---------------------------------------------------------------------------

const bloodTypeSchema = z.enum(["A", "B", "AB", "O"]);
const rhFactorSchema = z.enum(["POSITIVE", "NEGATIVE"]);
const bloodComponentSchema = z.enum(["WB", "RBC", "PLT", "FFP", "CRYO"]);
const bloodUnitStatusSchema = z.enum(["AVAILABLE", "RESERVED", "IN_USE", "TRANSFUSED", "DISCARDED", "EXPIRED"]);
const urgencySchema = z.enum(["ROUTINE", "URGENT", "EMERGENCY"]);
const crossMatchResultSchema = z.enum(["COMPATIBLE", "INCOMPATIBLE", "INCONCLUSIVE"]);
const transfusionRouteSchema = z.enum(["IV_PERIPHERAL", "IV_CENTRAL", "IO"]);
const adverseReactionSeveritySchema = z.enum(["MILD", "MODERATE", "SEVERE", "LIFE_THREATENING"]);

/** Severidades que disparan alerta inmediata de dominio. */
const HIGH_SEVERITY_REACTIONS: Array<z.infer<typeof adverseReactionSeveritySchema>> = [
  "SEVERE",
  "LIFE_THREATENING",
];

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const bloodBankRouter = router({
  unit: router({
    /**
     * Listar unidades con filtros opcionales. Accesible para todos los roles
     * autenticados en el tenant (lectura de inventario).
     */
    list: tenantProcedure
      .input(
        z.object({
          bloodType: bloodTypeSchema.optional(),
          rhFactor: rhFactorSchema.optional(),
          component: bloodComponentSchema.optional(),
          status: bloodUnitStatusSchema.optional(),
          bloodBankId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          return tx.bloodUnit.findMany({
            where: {
              organizationId: ctx.tenant.organizationId,
              ...(input.bloodType && { bloodType: input.bloodType }),
              ...(input.rhFactor && { rhFactor: input.rhFactor }),
              ...(input.component && { component: input.component }),
              ...(input.status && { status: input.status }),
              ...(input.bloodBankId && { bloodBankId: input.bloodBankId }),
            },
            orderBy: { expirationDate: "asc" },
            take: input.limit,
          });
        });
      }),

    /**
     * Ingresar una unidad nueva al inventario.
     * Requiere rol LAB_TECHNICIAN o BLOOD_BANK_OFFICER.
     */
    create: requireRole(LAB_ROLES)
      .input(
        z.object({
          bloodBankId: z.string().uuid(),
          bloodType: bloodTypeSchema,
          rhFactor: rhFactorSchema,
          component: bloodComponentSchema,
          antigens: z.record(z.boolean()).optional(),
          donorCode: z.string().max(40).optional(),
          collectionDate: z.coerce.date(),
          expirationDate: z.coerce.date(),
          volume: z.number().int().positive().optional(),
          notes: z.string().max(1000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // Verificar que el bloodBank pertenezca al tenant
          const bank = await tx.bloodBank.findFirst({
            where: { id: input.bloodBankId, organizationId: ctx.tenant.organizationId },
            select: { id: true },
          });
          if (!bank) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Banco de sangre no encontrado en la organización." });
          }

          return tx.bloodUnit.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              bloodBankId: input.bloodBankId,
              bloodType: input.bloodType,
              rhFactor: input.rhFactor,
              component: input.component,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              antigens: (input.antigens ?? null) as any,
              donorCode: input.donorCode ?? null,
              collectionDate: input.collectionDate,
              expirationDate: input.expirationDate,
              volume: input.volume ?? null,
              notes: input.notes ?? null,
            },
          });
        });
      }),

    /**
     * Descartar una unidad. Marca status=DISCARDED + razón obligatoria.
     * Requiere rol LAB_TECHNICIAN o BLOOD_BANK_OFFICER.
     */
    discard: requireRole(LAB_ROLES)
      .input(
        z.object({
          id: z.string().uuid(),
          discardReason: z.string().trim().min(5).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const unit = await tx.bloodUnit.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId },
            select: { id: true, status: true },
          });
          if (!unit) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Unidad no encontrada." });
          }
          if (unit.status === "DISCARDED" || unit.status === "TRANSFUSED" || unit.status === "EXPIRED") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Unidad con estado ${unit.status} no puede descartarse.`,
            });
          }

          return tx.bloodUnit.update({
            where: { id: unit.id },
            data: {
              status: "DISCARDED",
              discardedAt: new Date(),
              discardReason: input.discardReason,
            },
          });
        });
      }),
  }),

  request: router({
    /**
     * Médico crea solicitud de transfusión para un paciente/encuentro.
     * Requiere rol PHYSICIAN.
     */
    create: requireRole(PHYSICIAN_ROLES)
      .input(
        z.object({
          encounterId: z.string().uuid(),
          patientId: z.string().uuid(),
          urgency: urgencySchema.default("ROUTINE"),
          component: bloodComponentSchema,
          bloodType: bloodTypeSchema.optional(),
          rhFactor: rhFactorSchema.optional(),
          unitsRequested: z.number().int().min(1).max(20).default(1),
          clinicalIndication: z.string().trim().min(10).max(2000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // Verificar encounter en tenant
          const enc = await tx.encounter.findFirst({
            where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
            select: { id: true, patientId: true },
          });
          if (!enc) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Encuentro no encontrado." });
          }
          if (enc.patientId !== input.patientId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "patientId no coincide con el encuentro." });
          }

          return tx.transfusionRequest.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              encounterId: input.encounterId,
              patientId: input.patientId,
              requestedById: ctx.user.id,
              urgency: input.urgency,
              component: input.component,
              bloodType: input.bloodType ?? null,
              rhFactor: input.rhFactor ?? null,
              unitsRequested: input.unitsRequested,
              clinicalIndication: input.clinicalIndication,
            },
          });
        });
      }),

    /**
     * Cancelar solicitud de transfusión.
     * Solo PHYSICIAN y solo si está en estado no-terminal.
     */
    cancel: requireRole(PHYSICIAN_ROLES)
      .input(
        z.object({
          id: z.string().uuid(),
          cancelReason: z.string().trim().min(5).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const updated = await tx.transfusionRequest.updateMany({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              status: { in: ["REQUESTED", "CROSSMATCHING", "APPROVED"] },
            },
            data: {
              status: "CANCELLED",
              cancelledAt: new Date(),
              cancelReason: input.cancelReason,
            },
          });
          if (updated.count === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Solicitud no encontrada o en estado terminal.",
            });
          }
          return { ok: true as const };
        });
      }),
  }),

  crossMatch: router({
    /**
     * Técnico de laboratorio realiza prueba cruzada.
     * Emite evento transfusion.crossmatchFailed si resultado es INCOMPATIBLE o INCONCLUSIVE.
     */
    perform: requireRole(LAB_ROLES)
      .input(
        z.object({
          requestId: z.string().uuid(),
          unitId: z.string().uuid(),
          result: crossMatchResultSchema,
          method: z.string().trim().min(2).max(60),
          notes: z.string().max(1000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // Verificar solicitud en tenant
          const req = await tx.transfusionRequest.findFirst({
            where: {
              id: input.requestId,
              organizationId: ctx.tenant.organizationId,
              status: { in: ["REQUESTED", "CROSSMATCHING"] },
            },
            select: { id: true, requestedById: true, patientId: true },
          });
          if (!req) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Solicitud no encontrada o en estado no válido para crossmatch.",
            });
          }

          // Verificar unidad disponible en tenant
          const unit = await tx.bloodUnit.findFirst({
            where: {
              id: input.unitId,
              organizationId: ctx.tenant.organizationId,
              status: { in: ["AVAILABLE", "RESERVED"] },
            },
            select: { id: true },
          });
          if (!unit) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Unidad no encontrada o no disponible.",
            });
          }

          const crossMatch = await tx.crossMatch.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              requestId: input.requestId,
              unitId: input.unitId,
              technicianId: ctx.user.id,
              result: input.result,
              method: input.method,
              notes: input.notes ?? null,
            },
          });

          // Actualizar estado de la solicitud
          await tx.transfusionRequest.update({
            where: { id: input.requestId },
            data: { status: input.result === "COMPATIBLE" ? "APPROVED" : "CROSSMATCHING" },
          });

          // Emitir evento si resultado no compatible
          if (input.result !== "COMPATIBLE") {
            const payload: TransfusionCrossmatchFailedPayload = {
              requestId: input.requestId,
              unitId: input.unitId,
              crossMatchId: crossMatch.id,
              result: input.result as "INCOMPATIBLE" | "INCONCLUSIVE",
              requestedById: req.requestedById,
              patientId: req.patientId,
            };
            await emitDomainEvent(tx, {
              organizationId: ctx.tenant.organizationId,
              eventType: "transfusion.crossmatchFailed",
              aggregateType: "CrossMatch",
              aggregateId: crossMatch.id,
              emittedById: ctx.user.id,
              payload,
            });
          }

          return crossMatch;
        });
      }),
  }),

  transfusion: router({
    /**
     * Enfermero inicia la transfusión.
     * Requiere que la solicitud esté APPROVED y un CrossMatch COMPATIBLE previo.
     */
    start: requireRole(NURSE_ROLES)
      .input(
        z.object({
          requestId: z.string().uuid(),
          unitId: z.string().uuid(),
          crossMatchId: z.string().uuid(),
          supervisorId: z.string().uuid(),
          route: transfusionRouteSchema,
          vitalSignsPre: z.record(z.unknown()).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // Verificar solicitud APPROVED en tenant
          const req = await tx.transfusionRequest.findFirst({
            where: {
              id: input.requestId,
              organizationId: ctx.tenant.organizationId,
              status: "APPROVED",
            },
            select: { id: true, encounterId: true },
          });
          if (!req) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Solicitud no encontrada o no aprobada.",
            });
          }

          // Verificar crossmatch COMPATIBLE
          const cm = await tx.crossMatch.findFirst({
            where: {
              id: input.crossMatchId,
              organizationId: ctx.tenant.organizationId,
              requestId: input.requestId,
              unitId: input.unitId,
              result: "COMPATIBLE",
            },
            select: { id: true },
          });
          if (!cm) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "CrossMatch COMPATIBLE no encontrado para request/unit especificados.",
            });
          }

          // Marcar unidad como IN_USE
          await tx.bloodUnit.update({
            where: { id: input.unitId },
            data: { status: "IN_USE" },
          });

          const vitalSigns = input.vitalSignsPre
            ? ({ pre: input.vitalSignsPre } as Prisma.InputJsonValue)
            : Prisma.DbNull;

          const transfusion = await tx.transfusion.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              requestId: input.requestId,
              unitId: input.unitId,
              encounterId: req.encounterId,
              crossMatchId: input.crossMatchId,
              nurseId: ctx.user.id,
              supervisorId: input.supervisorId,
              route: input.route,
              status: "STARTED",
              vitalSigns,
            },
          });

          // Avanzar estado de la solicitud a FULFILLED (1:1 por request en esta implementación)
          await tx.transfusionRequest.update({
            where: { id: input.requestId },
            data: { status: "FULFILLED" },
          });

          return transfusion;
        });
      }),

    /**
     * Enfermero cierra la transfusión con signos vitales post y estado final.
     */
    complete: requireRole(NURSE_ROLES)
      .input(
        z.object({
          id: z.string().uuid(),
          vitalSignsPost: z.record(z.unknown()).optional(),
          abortReason: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const transfusion = await tx.transfusion.findFirst({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              nurseId: ctx.user.id,
              status: { in: ["STARTED", "IN_PROGRESS"] },
            },
            select: { id: true, unitId: true, vitalSigns: true },
          });
          if (!transfusion) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Transfusión no encontrada o no le pertenece.",
            });
          }

          const finalStatus = input.abortReason ? "ABORTED" : "COMPLETED";

          // Merge vital signs
          const prevVitals = (transfusion.vitalSigns as Record<string, unknown>) ?? {};
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newVitals: any = input.vitalSignsPost
            ? { ...prevVitals, post: input.vitalSignsPost }
            : prevVitals;

          const updated = await tx.transfusion.update({
            where: { id: transfusion.id },
            data: {
              status: finalStatus,
              completedAt: new Date(),
              vitalSigns: newVitals,
              ...(input.abortReason && { abortReason: input.abortReason }),
            },
          });

          // Marcar unidad como TRANSFUSED o devolver a AVAILABLE si abortada pronto
          await tx.bloodUnit.update({
            where: { id: transfusion.unitId },
            data: { status: finalStatus === "COMPLETED" ? "TRANSFUSED" : "AVAILABLE" },
          });

          return updated;
        });
      }),

    /**
     * Registrar reacción adversa durante o post-transfusión.
     * Si severidad es SEVERE o LIFE_THREATENING → emite evento de dominio.
     */
    recordReaction: requireRole(NURSE_ROLES)
      .input(
        z.object({
          id: z.string().uuid(),
          reactionType: z.string().trim().min(2).max(120),
          severity: adverseReactionSeveritySchema,
          management: z.string().trim().min(2).max(500),
          vitalSignsIntra: z.record(z.unknown()).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const transfusion = await tx.transfusion.findFirst({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
            },
            select: {
              id: true,
              status: true,
              adverseReactions: true,
              vitalSigns: true,
              requestId: true,
              supervisorId: true,
              request: { select: { patientId: true } },
            },
          });
          if (!transfusion) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Transfusión no encontrada." });
          }
          if (transfusion.status === "COMPLETED" || transfusion.status === "ABORTED") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "No se puede registrar reacción en una transfusión finalizada.",
            });
          }

          const newReaction = {
            type: input.reactionType,
            severity: input.severity,
            management: input.management,
            recordedAt: new Date().toISOString(),
            recordedBy: ctx.user.id,
          };

          const prevReactions = Array.isArray(transfusion.adverseReactions)
            ? (transfusion.adverseReactions as unknown[])
            : [];

          const prevVitals = (transfusion.vitalSigns as Record<string, unknown>) ?? {};
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newVitals: any = input.vitalSignsIntra
            ? { ...prevVitals, intra: input.vitalSignsIntra }
            : prevVitals;

          const updated = await tx.transfusion.update({
            where: { id: transfusion.id },
            data: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              adverseReactions: [...prevReactions, newReaction] as any,
              vitalSigns: newVitals,
            },
          });

          // Evento de dominio para reacciones de alta severidad
          if (HIGH_SEVERITY_REACTIONS.includes(input.severity)) {
            const payload: TransfusionAdverseReactionPayload = {
              transfusionId: transfusion.id,
              requestId: transfusion.requestId,
              patientId: transfusion.request.patientId,
              supervisorId: transfusion.supervisorId,
              nurseId: ctx.user.id,
              reactionType: input.reactionType,
              severity: input.severity,
            };
            await emitDomainEvent(tx, {
              organizationId: ctx.tenant.organizationId,
              eventType: "transfusion.adverseReaction",
              aggregateType: "Transfusion",
              aggregateId: transfusion.id,
              emittedById: ctx.user.id,
              payload,
        });
          }

          return updated;
        });
      }),
  }),
});
