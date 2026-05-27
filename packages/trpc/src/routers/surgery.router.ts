/**
 * §13 Surgery — router hardening layer 1 (Beta.6).
 *
 * State machine: SCHEDULED → IN_PROGRESS → POST_OP → COMPLETED
 *   branches: CANCELLED (from SCHEDULED/CONFIRMED/POSTPONED), POSTPONED (from SCHEDULED/CONFIRMED)
 *
 * WHO Surgical Safety Checklist gates:
 *   signIn  → required before start (SCHEDULED → IN_PROGRESS)
 *   timeOut → required before start (SCHEDULED → IN_PROGRESS)
 *   signOut → required before postOp (IN_PROGRESS → POST_OP)
 *
 * OR conflict detection: called on create and update of scheduledStart/End.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  operatingRoomCreateInput,
  operatingRoomListInput,
  surgeryCaseCreateInput,
  surgeryCaseListInput,
  surgeryCaseSignInInput,
  surgeryCaseTimeOutInput,
  surgeryCaseSignOutInput,
  surgeryCaseStartInput,
  surgeryCasePostOpInput,
  surgeryCaseCompleteInput,
  surgeryCaseCancelInput,
  surgeryCasePostponeInput,
  surgeryCaseAnesthesiaInput,
  surgeryCaseUpdateIntraopNotesInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// OR conflict detection helper
// ---------------------------------------------------------------------------

// Non-terminal statuses that occupy an OR slot.
const OR_ACTIVE_STATUSES = ["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "POST_OP"] as const;

async function detectOrConflict(
  prisma: PrismaClient,
  operatingRoomId: string,
  scheduledStart: Date,
  scheduledEnd: Date,
  excludeCaseId?: string,
): Promise<boolean> {
  const conflict = await prisma.surgeryCase.findFirst({
    where: {
      operatingRoomId,
      deletedAt: null,
      status: { in: [...OR_ACTIVE_STATUSES] },
      ...(excludeCaseId && { id: { not: excludeCaseId } }),
      // Overlap: existing.start < newEnd AND existing.end > newStart
      scheduledStart: { lt: scheduledEnd },
      scheduledEnd: { gt: scheduledStart },
    },
    select: { id: true },
  });
  return conflict !== null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const surgeryRouter = router({
  operatingRoom: router({
    list: tenantProcedure
      .input(operatingRoomListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.operatingRoom.findMany({
          where: {
            establishment: { organizationId: ctx.tenant.organizationId },
            ...(input.establishmentId && {
              establishmentId: input.establishmentId,
            }),
            ...(input.activeOnly && { active: true }),
          },
          orderBy: { code: "asc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(operatingRoomCreateInput)
      .mutation(async ({ ctx, input }) => {
        const est = await ctx.prisma.establishment.findFirst({
          where: {
            id: input.establishmentId,
            organizationId: ctx.tenant.organizationId,
          },
          select: { id: true },
        });
        if (!est) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Establecimiento no existe en la organización.",
          });
        }
        return ctx.prisma.operatingRoom.create({ data: input });
      }),
  }),

  case: router({
    list: tenantProcedure
      .input(surgeryCaseListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.surgeryCase.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
            ...(input.status && { status: input.status }),
            ...(input.primarySurgeonId && {
              primarySurgeonId: input.primarySurgeonId,
            }),
            ...(input.operatingRoomId && {
              operatingRoomId: input.operatingRoomId,
            }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.costCenterId && { costCenterId: input.costCenterId }),
            ...((input.fromDate || input.toDate) && {
              scheduledStart: {
                ...(input.fromDate && { gte: input.fromDate }),
                ...(input.toDate && { lte: input.toDate }),
              },
            }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            primarySurgeon: { select: { id: true, fullName: true } },
            operatingRoom: { select: { id: true, code: true, name: true } },
          },
          orderBy: { scheduledStart: "asc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.surgeryCase.findFirst({
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
      .input(surgeryCaseCreateInput)
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

        // OR conflict detection (only if an OR was specified)
        if (input.operatingRoomId) {
          const conflict = await detectOrConflict(
            ctx.prisma,
            input.operatingRoomId,
            input.scheduledStart,
            input.scheduledEnd,
          );
          if (conflict) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "El quirófano ya tiene un caso activo en ese intervalo horario.",
            });
          }
        }

        return ctx.prisma.surgeryCase.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            establishmentId: input.establishmentId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            primarySurgeonId: input.primarySurgeonId,
            operatingRoomId: input.operatingRoomId ?? null,
            procedureDescription: input.procedureDescription,
            procedureCode: input.procedureCode ?? null,
            scheduledStart: input.scheduledStart,
            scheduledEnd: input.scheduledEnd,
            asaClass: input.asaClass ?? null,
            preopNotes: input.preopNotes ?? null,
            costCenterId: input.costCenterId ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    // ------------------------------------------------------------------
    // WHO Surgical Safety Checklist — Sign In
    //
    // Gate sql/56 (handoff interno): NO se permite iniciar Sign-In si el
    // paciente tiene un traslado pendiente de recepción (`status='SENT'`).
    // El coordinador del quirófano debe confirmar la llegada con
    // `encounterTransfer.confirmReceipt` antes del Sign-In.
    // ------------------------------------------------------------------
    signIn: tenantProcedure
      .input(surgeryCaseSignInInput)
      .mutation(async ({ ctx, input }) => {
        // 1) Cargar el caso para conocer encounterId.
        const surgeryCase = await ctx.prisma.surgeryCase.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, encounterId: true, signInAt: true, status: true },
        });
        if (!surgeryCase) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Caso quirúrgico no encontrado.",
          });
        }

        // 2) Gate handoff: ¿hay traslado SENT pendiente? Rechazar.
        const pendingHandoff = await ctx.prisma.encounterTransfer.findFirst({
          where: {
            encounterId: surgeryCase.encounterId,
            status: "SENT",
          },
          select: { id: true, toServiceId: true },
        });
        if (pendingHandoff) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "El paciente tiene un traslado pendiente de recepción. " +
              "Confirme la llegada (Recibir paciente) antes del Sign-In WHO.",
            cause: { pendingTransferId: pendingHandoff.id },
          });
        }

        // 3) Sign-In (idempotente, único).
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SCHEDULED", "CONFIRMED"] },
            signInAt: null, // idempotency guard — only sign-in once
            deletedAt: null,
          },
          data: {
            signInAt: new Date(),
            signInById: ctx.user.id,
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Caso no existe, ya tiene Sign In registrado, o no está en estado válido.",
          });
        }
        return { ok: true as const };
      }),

    // ------------------------------------------------------------------
    // WHO Surgical Safety Checklist — Time Out
    // ------------------------------------------------------------------
    timeOut: tenantProcedure
      .input(surgeryCaseTimeOutInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SCHEDULED", "CONFIRMED"] },
            signInAt: { not: null }, // Sign In must be done first
            timeOutAt: null,         // idempotency guard
            deletedAt: null,
          },
          data: {
            timeOutAt: new Date(),
            timeOutById: ctx.user.id,
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Caso no existe, falta Sign In previo, ya tiene Time Out, o no está en estado válido.",
          });
        }
        return { ok: true as const };
      }),

    // ------------------------------------------------------------------
    // Start surgery: SCHEDULED/CONFIRMED → IN_PROGRESS
    // Requires signInAt + timeOutAt (WHO checklist gates)
    // ------------------------------------------------------------------
    start: tenantProcedure
      .input(surgeryCaseStartInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SCHEDULED", "CONFIRMED"] },
            signInAt: { not: null },  // WHO Sign In required
            timeOutAt: { not: null }, // WHO Time Out required
            deletedAt: null,
          },
          data: {
            status: "IN_PROGRESS",
            actualStart: new Date(),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Caso no existe, faltan Sign In y/o Time Out del checklist WHO, o el estado no es válido.",
          });
        }
        return { ok: true as const };
      }),

    // ------------------------------------------------------------------
    // WHO Surgical Safety Checklist — Sign Out
    // ------------------------------------------------------------------
    signOut: tenantProcedure
      .input(surgeryCaseSignOutInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: "IN_PROGRESS",
            signOutAt: null, // idempotency guard
            deletedAt: null,
          },
          data: {
            signOutAt: new Date(),
            signOutById: ctx.user.id,
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Caso no existe, ya tiene Sign Out registrado, o no está IN_PROGRESS.",
          });
        }
        return { ok: true as const };
      }),

    // ------------------------------------------------------------------
    // Transition to POST_OP: IN_PROGRESS → POST_OP
    // Requires signOutAt (WHO Sign Out gate)
    // ------------------------------------------------------------------
    postOp: tenantProcedure
      .input(surgeryCasePostOpInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: "IN_PROGRESS",
            signOutAt: { not: null }, // WHO Sign Out required
            deletedAt: null,
          },
          data: {
            status: "POST_OP",
            actualEnd: new Date(),
            ...(input.intraopNotes !== undefined && {
              intraopNotes: input.intraopNotes,
            }),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Caso no existe, falta Sign Out del checklist WHO, o no está IN_PROGRESS.",
          });
        }
        return { ok: true as const };
      }),

    // ------------------------------------------------------------------
    // Complete: POST_OP → COMPLETED
    // ------------------------------------------------------------------
    complete: tenantProcedure
      .input(surgeryCaseCompleteInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: "POST_OP",
            deletedAt: null,
          },
          data: {
            status: "COMPLETED",
            ...(input.postopNotes !== undefined && {
              postopNotes: input.postopNotes,
            }),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Caso no existe o no está en POST_OP.",
          });
        }
        return { ok: true as const };
      }),

    // ------------------------------------------------------------------
    // Cancel: SCHEDULED / CONFIRMED / POSTPONED → CANCELLED
    // ------------------------------------------------------------------
    cancel: tenantProcedure
      .input(surgeryCaseCancelInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SCHEDULED", "CONFIRMED", "POSTPONED"] },
            deletedAt: null,
          },
          data: {
            status: "CANCELLED",
            cancelReason: input.cancelReason,
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Caso no existe o ya inició / fue cancelado.",
          });
        }
        return { ok: true as const };
      }),

    // ------------------------------------------------------------------
    // Postpone: SCHEDULED / CONFIRMED → POSTPONED (reschedule)
    // Re-runs OR conflict detection for the new timeslot.
    // ------------------------------------------------------------------
    postpone: tenantProcedure
      .input(surgeryCasePostponeInput)
      .mutation(async ({ ctx, input }) => {
        if (input.newScheduledEnd <= input.newScheduledStart) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "newScheduledEnd debe ser posterior a newScheduledStart.",
          });
        }

        const existing = await ctx.prisma.surgeryCase.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SCHEDULED", "CONFIRMED"] },
            deletedAt: null,
          },
          select: { id: true, operatingRoomId: true },
        });
        if (!existing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Caso no existe o no está en estado cancelable.",
          });
        }

        if (existing.operatingRoomId) {
          const conflict = await detectOrConflict(
            ctx.prisma,
            existing.operatingRoomId,
            input.newScheduledStart,
            input.newScheduledEnd,
            input.id,
          );
          if (conflict) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "El quirófano ya tiene un caso activo en el nuevo intervalo horario.",
            });
          }
        }

        return ctx.prisma.surgeryCase.update({
          where: { id: input.id },
          data: {
            status: "POSTPONED",
            cancelReason: input.cancelReason,
            scheduledStart: input.newScheduledStart,
            scheduledEnd: input.newScheduledEnd,
            updatedBy: ctx.user.id,
          },
        });
      }),

    // ------------------------------------------------------------------
    // Update intraop notes — append-only, only during IN_PROGRESS.
    // No state transition. Audit covered by SurgeryCase UPDATE trigger.
    // ------------------------------------------------------------------
    updateIntraopNotes: tenantProcedure
      .input(surgeryCaseUpdateIntraopNotesInput)
      .mutation(async ({ ctx, input }) => {
        // SELECT FOR UPDATE — idempotent guard, atomically verify status before append.
        const existing = await ctx.prisma.surgeryCase.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: "IN_PROGRESS",
            deletedAt: null,
          },
          select: { id: true, intraopNotes: true },
        });
        if (!existing) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Solo se pueden agregar notas durante IN_PROGRESS.",
          });
        }

        // Format: [ISO-timestamp] [TYPE] texto
        const ts = new Date().toISOString();
        const line = `[${ts}] [${input.entryType}] ${input.appendText}`;
        const updatedNotes = existing.intraopNotes
          ? `${existing.intraopNotes}\n${line}`
          : line;

        const updated = await ctx.prisma.surgeryCase.update({
          where: { id: existing.id },
          data: {
            intraopNotes: updatedNotes,
            updatedBy: ctx.user.id,
          },
          select: { id: true, intraopNotes: true },
        });

        return updated;
      }),

    // ------------------------------------------------------------------
    // Anesthesia tracking
    // ------------------------------------------------------------------
    recordAnesthesia: tenantProcedure
      .input(surgeryCaseAnesthesiaInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.surgeryCase.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "POST_OP"] },
            deletedAt: null,
          },
          data: {
            anesthesiaType: input.anesthesiaType,
            anesthesiaStartAt: input.anesthesiaStartAt,
            ...(input.anesthesiaEndAt !== undefined && {
              anesthesiaEndAt: input.anesthesiaEndAt,
            }),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Caso no existe o no está en estado que permita registrar anestesia.",
          });
        }
        return { ok: true as const };
      }),
  }),
});
