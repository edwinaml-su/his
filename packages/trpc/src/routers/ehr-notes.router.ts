/**
 * §14 EHR Clinical Notes — router (Beta.5 hardening layer 1).
 *
 * Business rules:
 *  1. Inmutabilidad post-firma: router blocks mutation on signed notes (DB trigger backs this up).
 *  2. Addendum chain: original MUST be signed.
 *  3. CIE-10 binding: conceptId must be ICD10.
 *  4. editHistory append-only: pre-firma changes tracked in Json column (max 50).
 *  5. DISCHARGE_SUMMARY: only if Encounter.dischargedAt IS NOT NULL.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@his/database";
import {
  clinicalNoteCreateInput,
  clinicalNoteSignInput,
  clinicalNoteAddendumInput,
  clinicalNoteListInput,
  encounterDiagnosisCreateInput,
  encounterDiagnosisListInput,
  encounterDiagnosisResolveInput,
  type EditHistoryEntry,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

const EDIT_HISTORY_MAX = 50;

function buildEditHistory(existing: unknown, entry: EditHistoryEntry): EditHistoryEntry[] {
  const prev: EditHistoryEntry[] = Array.isArray(existing) ? (existing as EditHistoryEntry[]) : [];
  const next = [...prev, entry];
  return next.length > EDIT_HISTORY_MAX ? next.slice(next.length - EDIT_HISTORY_MAX) : next;
}

export const ehrNotesRouter = router({
  note: router({
    list: tenantProcedure.input(clinicalNoteListInput).query(async ({ ctx, input }) => {
      return ctx.prisma.clinicalNote.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          ...(input.encounterId && { encounterId: input.encounterId }),
          ...(input.authorId && { authorId: input.authorId }),
          ...(input.noteType && { noteType: input.noteType }),
          ...(input.fromDate || input.toDate
            ? {
                authoredAt: {
                  ...(input.fromDate && { gte: input.fromDate }),
                  ...(input.toDate && { lte: input.toDate }),
                },
              }
            : {}),
        },
        orderBy: { authoredAt: "desc" },
        take: input.limit,
      });
    }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const n = await ctx.prisma.clinicalNote.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          include: { attachments: true, addenda: { orderBy: { authoredAt: "asc" } } },
        });
        if (!n) throw new TRPCError({ code: "NOT_FOUND" });
        return n;
      }),

    create: tenantProcedure.input(clinicalNoteCreateInput).mutation(async ({ ctx, input }) => {
      const enc = await ctx.prisma.encounter.findFirst({
        where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
        select: { id: true, dischargedAt: true },
      });
      if (!enc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Encuentro no existe en la organizacion." });
      }
      if (input.noteType === "DISCHARGE_SUMMARY" && enc.dischargedAt === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "DISCHARGE_SUMMARY solo puede crearse si el encuentro tiene dischargedAt registrado.",
        });
      }
      const historyEntry: EditHistoryEntry = { at: new Date().toISOString(), by: ctx.user.id, action: "create" };
      return ctx.prisma.clinicalNote.create({
        data: {
          organizationId: ctx.tenant.organizationId,
          encounterId: input.encounterId,
          authorId: ctx.user.id,
          noteType: input.noteType,
          specialtyId: input.specialtyId ?? null,
          subjective: input.subjective ?? null,
          objective: input.objective ?? null,
          assessment: input.assessment ?? null,
          plan: input.plan ?? null,
          editHistory: [historyEntry] as unknown as Prisma.InputJsonValue,
        },
      });
    }),

    sign: tenantProcedure.input(clinicalNoteSignInput).mutation(async ({ ctx, input }) => {
      const note = await ctx.prisma.clinicalNote.findFirst({
        where: { id: input.id, organizationId: ctx.tenant.organizationId, signedAt: null },
        select: { id: true, authorId: true },
      });
      if (!note) throw new TRPCError({ code: "NOT_FOUND", message: "Nota no existe o ya esta firmada." });
      if (note.authorId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Solo el autor de la nota puede firmarla." });
      return ctx.prisma.clinicalNote.update({ where: { id: input.id }, data: { signedAt: new Date() } });
    }),

    addendum: tenantProcedure.input(clinicalNoteAddendumInput).mutation(async ({ ctx, input }) => {
      const original = await ctx.prisma.clinicalNote.findFirst({
        where: { id: input.addendumOfId, organizationId: ctx.tenant.organizationId, signedAt: { not: null } },
        select: { id: true, encounterId: true },
      });
      if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Nota original no existe o no esta firmada." });
      const historyEntry: EditHistoryEntry = { at: new Date().toISOString(), by: ctx.user.id, action: "create" };
      return ctx.prisma.clinicalNote.create({
        data: {
          organizationId: ctx.tenant.organizationId,
          encounterId: original.encounterId,
          authorId: ctx.user.id,
          noteType: input.noteType,
          addendumOfId: input.addendumOfId,
          subjective: input.subjective ?? null,
          objective: input.objective ?? null,
          assessment: input.assessment ?? null,
          plan: input.plan ?? null,
          editHistory: [historyEntry] as unknown as Prisma.InputJsonValue,
        },
      });
    }),

    update: tenantProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          subjective: z.string().trim().max(8000).optional(),
          objective: z.string().trim().max(8000).optional(),
          assessment: z.string().trim().max(8000).optional(),
          plan: z.string().trim().max(8000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const note = await ctx.prisma.clinicalNote.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId, signedAt: null },
          select: { id: true, authorId: true, editHistory: true, subjective: true, objective: true, assessment: true, plan: true },
        });
        if (!note) throw new TRPCError({ code: "NOT_FOUND", message: "Nota no existe, ya esta firmada o no pertenece a la organizacion." });
        if (note.authorId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Solo el autor puede editar la nota." });
        const CONTENT_FIELDS = ["subjective", "objective", "assessment", "plan"] as const;
        const diff: Record<string, string | null> = {};
        for (const field of CONTENT_FIELDS) {
          if (input[field] !== undefined && input[field] !== note[field]) {
            diff[field] = note[field] ?? null;
          }
        }
        const entry: EditHistoryEntry = { at: new Date().toISOString(), by: ctx.user.id, action: "update", diff };
        const newHistory = buildEditHistory(note.editHistory, entry);
        const { id: _id, ...updateFields } = input;
        return ctx.prisma.clinicalNote.update({
          where: { id: input.id },
          data: { ...updateFields, editHistory: newHistory as unknown as Prisma.InputJsonValue },
        });
      }),
  }),

  diagnosis: router({
    list: tenantProcedure.input(encounterDiagnosisListInput).query(async ({ ctx, input }) => {
      const enc = await ctx.prisma.encounter.findFirst({
        where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
        select: { id: true },
      });
      if (!enc) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.encounterDiagnosis.findMany({
        where: { encounterId: input.encounterId, ...(input.type && { type: input.type }) },
        orderBy: { diagnosedAt: "desc" },
      });
    }),

    create: tenantProcedure.input(encounterDiagnosisCreateInput).mutation(async ({ ctx, input }) => {
      const enc = await ctx.prisma.encounter.findFirst({
        where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
        select: { id: true },
      });
      if (!enc) throw new TRPCError({ code: "NOT_FOUND" });
      const concept = await ctx.prisma.clinicalConcept.findFirst({
        where: { id: input.conceptId, codeSystem: { code: "ICD10" } },
        select: { id: true },
      });
      if (!concept) throw new TRPCError({ code: "BAD_REQUEST", message: "El concepto indicado no existe o no pertenece al sistema ICD10." });
      return ctx.prisma.encounterDiagnosis.create({
        data: {
          encounterId: input.encounterId,
          conceptId: input.conceptId,
          type: input.type,
          diagnosedById: ctx.user.id,
          notes: input.notes ?? null,
        },
      });
    }),

    resolve: tenantProcedure.input(encounterDiagnosisResolveInput).mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.encounterDiagnosis.updateMany({
        where: { id: input.id, encounter: { organizationId: ctx.tenant.organizationId }, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
      if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),
  }),
});