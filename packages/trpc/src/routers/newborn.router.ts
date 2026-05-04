/**
 * US-4.6 — Vínculo recién-nacido ↔ madre (MPI Antecedentes).
 *
 * Procedimientos:
 *  - linkMother(newbornId, motherId): vincula RN existente a una madre.
 *  - unlinkMother(newbornId): rompe el vínculo (motherPatientId = null).
 *  - createNewborn(input): crea Patient + setea motherPatientId atómicamente.
 *
 * Reutiliza `Patient.motherPatientId` ya existente en schema.prisma — no migra.
 *
 * Validaciones críticas (ver newborn.ts schemas):
 *  - newborn edad < 28 días.
 *  - mother existe, biologicalSex.code == "F", no-self-link.
 *  - mother con cap NEWBORN_MAX_CHILDREN_PER_MOTHER hijos neonatos vivos
 *    (protege contra binding accidental; multi-births reales se modelarán Sprint 4).
 *
 * Auditoría: `auditLog.create` con `entity = "Patient"` y `afterJson.op` describiendo
 * la operación (LINK_MOTHER / UNLINK_MOTHER / CREATE_NEWBORN). Sigue el mismo patrón
 * que patient.router.ts → mergePatients.
 */
import { TRPCError } from "@trpc/server";
import {
  linkNewbornMotherInput,
  unlinkNewbornMotherInput,
  createNewbornInput,
  NEWBORN_MAX_AGE_DAYS,
  NEWBORN_MAX_CHILDREN_PER_MOTHER,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

const MS_PER_DAY = 86400000;

function ageInDays(birthDate: Date | null): number | null {
  if (!birthDate) return null;
  return Math.floor((Date.now() - birthDate.getTime()) / MS_PER_DAY);
}

/**
 * Genera un MRN simple por organización. MVP: prefijo "RN-" + epoch ms en base36.
 * Único dentro de (organizationId, mrn) por constraint del schema. Sprint 4:
 * reemplazar con secuencia configurable por organización.
 */
function generateNewbornMrn(): string {
  return `RN-${Date.now().toString(36).toUpperCase()}`;
}

export const newbornRouter = router({
  // ===========================================================================
  // Vincular RN existente con una madre existente.
  // ===========================================================================
  linkMother: tenantProcedure
    .input(linkNewbornMotherInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      if (input.newbornId === input.motherId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El recién-nacido y la madre no pueden ser la misma persona.",
        });
      }

      const [newborn, mother] = await Promise.all([
        ctx.prisma.patient.findFirst({
          where: { id: input.newbornId, organizationId: orgId, deletedAt: null },
          include: { biologicalSex: true },
        }),
        ctx.prisma.patient.findFirst({
          where: { id: input.motherId, organizationId: orgId, deletedAt: null },
          include: { biologicalSex: true },
        }),
      ]);
      if (!newborn) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recién-nacido no encontrado." });
      }
      if (!mother) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Madre no encontrada." });
      }

      // Edad RN < 28 días.
      const ageDays = ageInDays(newborn.birthDate);
      if (ageDays === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El paciente no tiene fecha de nacimiento; no puede declararse neonato.",
        });
      }
      if (ageDays > NEWBORN_MAX_AGE_DAYS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Edad ${ageDays} días excede el límite neonatal (${NEWBORN_MAX_AGE_DAYS}). Use vínculo no-neonatal en Sprint 4.`,
        });
      }

      // Madre con biologicalSex.code === "F".
      if (mother.biologicalSex?.code !== "F") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La madre debe tener sexo biológico femenino.",
        });
      }

      // Cap de hijos neonatos vivos vinculados.
      const recentCutoff = new Date(Date.now() - NEWBORN_MAX_AGE_DAYS * MS_PER_DAY);
      const currentChildren = await ctx.prisma.patient.count({
        where: {
          motherPatientId: mother.id,
          deletedAt: null,
          birthDate: { gte: recentCutoff },
        },
      });
      if (currentChildren >= NEWBORN_MAX_CHILDREN_PER_MOTHER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `La madre ya tiene ${currentChildren} RN vinculados (cap MVP=${NEWBORN_MAX_CHILDREN_PER_MOTHER}). TODO Sprint 4 multi-births.`,
        });
      }

      // Update + audit.
      const before = { motherPatientId: newborn.motherPatientId };
      const updated = await ctx.prisma.$transaction(async (tx) => {
        const u = await tx.patient.update({
          where: { id: newborn.id },
          data: { motherPatientId: mother.id, updatedBy: ctx.user.id },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.user.id,
            organizationId: orgId,
            establishmentId: ctx.tenant.establishmentId ?? null,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
            action: "UPDATE",
            entity: "Patient",
            entityId: newborn.id,
            beforeJson: before,
            afterJson: {
              op: "LINK_NEWBORN_MOTHER",
              newbornId: newborn.id,
              motherId: mother.id,
              ageDays,
            },
          },
        });
        return u;
      });

      return { ok: true as const, newbornId: updated.id, motherId: mother.id };
    }),

  // ===========================================================================
  // Romper el vínculo madre↔RN.
  // ===========================================================================
  unlinkMother: tenantProcedure
    .input(unlinkNewbornMotherInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const newborn = await ctx.prisma.patient.findFirst({
        where: { id: input.newbornId, organizationId: orgId, deletedAt: null },
      });
      if (!newborn) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recién-nacido no encontrado." });
      }
      if (!newborn.motherPatientId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El paciente no tiene madre vinculada.",
        });
      }

      const before = { motherPatientId: newborn.motherPatientId };
      await ctx.prisma.$transaction(async (tx) => {
        await tx.patient.update({
          where: { id: newborn.id },
          data: { motherPatientId: null, updatedBy: ctx.user.id },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.user.id,
            organizationId: orgId,
            establishmentId: ctx.tenant.establishmentId ?? null,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
            action: "UPDATE",
            entity: "Patient",
            entityId: newborn.id,
            beforeJson: before,
            afterJson: {
              op: "UNLINK_NEWBORN_MOTHER",
              newbornId: newborn.id,
              previousMotherId: before.motherPatientId,
            },
          },
        });
      });

      return { ok: true as const, newbornId: newborn.id };
    }),

  // ===========================================================================
  // Crear paciente RN + vincular madre en una transacción.
  // ===========================================================================
  createNewborn: tenantProcedure
    .input(createNewbornInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      const mother = await ctx.prisma.patient.findFirst({
        where: { id: input.motherId, organizationId: orgId, deletedAt: null },
        include: { biologicalSex: true },
      });
      if (!mother) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Madre no encontrada." });
      }
      if (mother.biologicalSex?.code !== "F") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La madre debe tener sexo biológico femenino.",
        });
      }

      const ageDays = ageInDays(input.birthDate);
      if (ageDays === null || ageDays > NEWBORN_MAX_AGE_DAYS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Fecha de nacimiento debe ser dentro de ${NEWBORN_MAX_AGE_DAYS} días.`,
        });
      }
      if (ageDays < 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha de nacimiento no puede ser futura.",
        });
      }

      // Cap por madre.
      const recentCutoff = new Date(Date.now() - NEWBORN_MAX_AGE_DAYS * MS_PER_DAY);
      const currentChildren = await ctx.prisma.patient.count({
        where: {
          motherPatientId: mother.id,
          deletedAt: null,
          birthDate: { gte: recentCutoff },
        },
      });
      if (currentChildren >= NEWBORN_MAX_CHILDREN_PER_MOTHER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `La madre ya tiene ${currentChildren} RN vinculados (cap MVP=${NEWBORN_MAX_CHILDREN_PER_MOTHER}).`,
        });
      }

      const result = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.patient.create({
          data: {
            organizationId: orgId,
            mrn: generateNewbornMrn(),
            firstName: input.firstName,
            lastName: input.lastName,
            secondLastName: input.secondLastName ?? null,
            birthDate: input.birthDate,
            birthDateEstimated: false,
            biologicalSexId: input.biologicalSexId,
            isUnknown: false,
            motherPatientId: mother.id,
            createdBy: ctx.user.id,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.user.id,
            organizationId: orgId,
            establishmentId: ctx.tenant.establishmentId ?? null,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
            action: "CREATE",
            entity: "Patient",
            entityId: created.id,
            afterJson: {
              op: "CREATE_NEWBORN",
              newbornId: created.id,
              motherId: mother.id,
              perinatal: {
                weightGrams: input.weightGrams ?? null,
                lengthCm: input.lengthCm ?? null,
                apgar1: input.apgar1 ?? null,
                apgar5: input.apgar5 ?? null,
              },
            },
          },
        });
        return created;
      });

      return { ok: true as const, newbornId: result.id, motherId: mother.id, mrn: result.mrn };
    }),
});
