/**
 * §14 EHR Clinical Notes — router skeleton (Sprint 4 / Phase 4 entry).
 *
 * Cobertura: notes SOAP create/sign/addendum/list + diagnoses CRUD.
 * Inmutabilidad post-firma enforced (sign no permite re-sign; addendum
 * crea note nueva linked vía addendumOfId).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  clinicalNoteCreateInput,
  clinicalNoteSignInput,
  clinicalNoteAddendumInput,
  clinicalNoteListInput,
  encounterDiagnosisCreateInput,
  encounterDiagnosisListInput,
  encounterDiagnosisResolveInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

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

    create: tenantProcedure
      .input(clinicalNoteCreateInput)
      .mutation(async ({ ctx, input }) => {
        const enc = await ctx.prisma.encounter.findFirst({
          where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
          select: { id: true },
        });
        if (!enc) throw new TRPCError({ code: "NOT_FOUND", message: "Encuentro no existe en la organización." });
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
          },
        });
      }),

    sign: tenantProcedure
      .input(clinicalNoteSignInput)
      .mutation(async ({ ctx, input }) => {
        const note = await ctx.prisma.clinicalNote.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            signedAt: null,
          },
          select: { id: true, authorId: true },
        });
        if (!note) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Nota no existe o ya está firmada." });
        }
        if (note.authorId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Sólo el autor de la nota puede firmarla.",
          });
        }
        return ctx.prisma.clinicalNote.update({
          where: { id: input.id },
          data: { signedAt: new Date() },
        });
      }),

    addendum: tenantProcedure
      .input(clinicalNoteAddendumInput)
      .mutation(async ({ ctx, input }) => {
        const original = await ctx.prisma.clinicalNote.findFirst({
          where: {
            id: input.addendumOfId,
            organizationId: ctx.tenant.organizationId,
            signedAt: { not: null },
          },
          select: { id: true, encounterId: true },
        });
        if (!original) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Nota original no existe o no está firmada.",
          });
        }
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
          },
        });
      }),
  }),

  diagnosis: router({
    list: tenantProcedure
      .input(encounterDiagnosisListInput)
      .query(async ({ ctx, input }) => {
        // Verifica que el encounter pertenezca al tenant.
        const enc = await ctx.prisma.encounter.findFirst({
          where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
          select: { id: true },
        });
        if (!enc) throw new TRPCError({ code: "NOT_FOUND" });
        return ctx.prisma.encounterDiagnosis.findMany({
          where: {
            encounterId: input.encounterId,
            ...(input.type && { type: input.type }),
          },
          orderBy: { diagnosedAt: "desc" },
        });
      }),

    create: tenantProcedure
      .input(encounterDiagnosisCreateInput)
      .mutation(async ({ ctx, input }) => {
        const enc = await ctx.prisma.encounter.findFirst({
          where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
          select: { id: true },
        });
        if (!enc) throw new TRPCError({ code: "NOT_FOUND" });
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

    resolve: tenantProcedure
      .input(encounterDiagnosisResolveInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.encounterDiagnosis.updateMany({
          where: {
            id: input.id,
            encounter: { organizationId: ctx.tenant.organizationId },
            resolvedAt: null,
          },
          data: { resolvedAt: new Date() },
        });
        if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true as const };
      }),
  }),
});
