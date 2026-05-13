/**
 * §15 Pharmacy — router skeleton (Sprint 4 / Phase 4 entry).
 *
 * Cobertura mínima: drugs catalog + prescription create/sign + dispense.
 * Permission checks por rol (pharmacy.prescribe / pharmacy.dispense) y
 * validaciones de stock van en iteración posterior.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  drugListInput,
  drugCreateInput,
  prescriptionCreateInput,
  prescriptionSignInput,
  prescriptionListInput,
  dispenseCreateInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const pharmacyRouter = router({
  drug: router({
    list: tenantProcedure.input(drugListInput).query(async ({ ctx, input }) => {
      return ctx.prisma.drug.findMany({
        where: {
          OR: [
            { organizationId: null }, // catálogo global
            { organizationId: ctx.tenant.organizationId },
          ],
          ...(input.activeOnly && { active: true }),
          ...(input.dispensingClass && { dispensingClass: input.dispensingClass }),
          ...(input.search && {
            OR: [
              { genericName: { contains: input.search, mode: "insensitive" } },
              { brandName: { contains: input.search, mode: "insensitive" } },
              { atcCode: { contains: input.search, mode: "insensitive" } },
            ],
          }),
        },
        orderBy: { genericName: "asc" },
        take: input.limit,
      });
    }),

    create: tenantProcedure
      .input(drugCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Si organizationId viene null, es catálogo global — sólo service_role
        // debería poder crearlo, pero validación fina se delega a permission check.
        return ctx.prisma.drug.create({
          data: {
            ...input,
            organizationId: input.organizationId ?? ctx.tenant.organizationId,
          },
        });
      }),
  }),

  prescription: router({
    list: tenantProcedure
      .input(prescriptionListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.prescription.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.encounterId && { encounterId: input.encounterId }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.prescriberId && { prescriberId: input.prescriberId }),
            ...(input.fromDate && { prescribedAt: { gte: input.fromDate } }),
          },
          include: { items: { include: { drug: true } } },
          orderBy: { prescribedAt: "desc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const presc = await ctx.prisma.prescription.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          include: { items: { include: { drug: true, dispenses: true } } },
        });
        if (!presc) throw new TRPCError({ code: "NOT_FOUND" });
        return presc;
      }),

    create: tenantProcedure
      .input(prescriptionCreateInput)
      .mutation(async ({ ctx, input }) => {
        const enc = await ctx.prisma.encounter.findFirst({
          where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
          select: { id: true, patientId: true },
        });
        if (!enc) throw new TRPCError({ code: "NOT_FOUND", message: "Encuentro no existe en la organización." });
        if (enc.patientId !== input.patientId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "patientId no coincide con encounter." });
        }
        return ctx.prisma.prescription.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            prescriberId: ctx.user.id,
            notes: input.notes ?? null,
            items: { create: input.items },
          },
          include: { items: true },
        });
      }),

    sign: tenantProcedure
      .input(prescriptionSignInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.prescription.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: "DRAFT",
          },
          data: { status: "SIGNED", signedAt: new Date() },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Receta no existe o no está en DRAFT.",
          });
        }
        return { ok: true as const };
      }),
  }),

  dispense: router({
    create: tenantProcedure
      .input(dispenseCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Verifica que el item pertenezca a una prescription SIGNED de la misma org.
        const item = await ctx.prisma.prescriptionItem.findFirst({
          where: {
            id: input.prescriptionItemId,
            prescription: {
              organizationId: ctx.tenant.organizationId,
              status: { in: ["SIGNED", "PARTIALLY_DISPENSED"] },
            },
          },
        });
        if (!item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Ítem no existe, no firmado, o ya dispensado.",
          });
        }
        return ctx.prisma.medicationDispense.create({
          data: {
            prescriptionItemId: input.prescriptionItemId,
            dispensedById: ctx.user.id,
            quantity: input.quantity,
            batchNumber: input.batchNumber ?? null,
            expiryDate: input.expiryDate ?? null,
            notes: input.notes ?? null,
          },
        });
      }),
  }),
});
