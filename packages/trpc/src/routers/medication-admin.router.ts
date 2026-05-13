/**
 * §16 eMAR — router skeleton (Wave 7 / Phase 2 entry).
 *
 * Cobertura mínima: registro de administración por PrescriptionItem firmado.
 * Validación BCMA (barcode-matching), reglas HMR (high-risk meds),
 * y refusal workflow con razones tipificadas van en iteraciones siguientes.
 */
import { TRPCError } from "@trpc/server";
import {
  medicationAdministrationRecordInput,
  medicationAdministrationListInput,
  medicationAdministrationGetInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const medicationAdminRouter = router({
  record: tenantProcedure
    .input(medicationAdministrationRecordInput)
    .mutation(async ({ ctx, input }) => {
      // Verifica que el PrescriptionItem pertenezca a una prescription SIGNED
      // (o PARTIALLY_DISPENSED) del tenant.
      const item = await ctx.prisma.prescriptionItem.findFirst({
        where: {
          id: input.prescriptionItemId,
          prescription: {
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SIGNED", "PARTIALLY_DISPENSED", "DISPENSED"] },
          },
        },
        select: { id: true },
      });
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Item de prescripción no existe en la organización o no está firmado.",
        });
      }
      return ctx.prisma.medicationAdministration.create({
        data: {
          organizationId: ctx.tenant.organizationId,
          prescriptionItemId: input.prescriptionItemId,
          administeredById: ctx.user.id,
          status: input.status,
          doseAmount: input.doseAmount ?? null,
          doseUnit: input.doseUnit ?? null,
          route: input.route ?? null,
          site: input.site ?? null,
          barcodeScannedAt: input.barcodeScannedAt ?? null,
          patientWristbandScanned: input.patientWristbandScanned,
          doubleCheckById: input.doubleCheckById ?? null,
          notes: input.notes ?? null,
        },
      });
    }),

  list: tenantProcedure
    .input(medicationAdministrationListInput)
    .query(async ({ ctx, input }) => {
      return ctx.prisma.medicationAdministration.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          ...(input.prescriptionItemId && {
            prescriptionItemId: input.prescriptionItemId,
          }),
          ...(input.administeredById && {
            administeredById: input.administeredById,
          }),
          ...(input.status && { status: input.status }),
          ...((input.fromDate || input.toDate) && {
            administeredAt: {
              ...(input.fromDate && { gte: input.fromDate }),
              ...(input.toDate && { lte: input.toDate }),
            },
          }),
        },
        include: {
          administeredBy: { select: { id: true, fullName: true } },
          prescriptionItem: {
            include: { drug: { select: { id: true, genericName: true } } },
          },
        },
        orderBy: { administeredAt: "desc" },
        take: input.limit,
      });
    }),

  get: tenantProcedure
    .input(medicationAdministrationGetInput)
    .query(async ({ ctx, input }) => {
      const item = await ctx.prisma.medicationAdministration.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.tenant.organizationId,
        },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      return item;
    }),
});
