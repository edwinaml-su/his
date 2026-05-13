/**
 * §16 eMAR — router (Beta.8 hardening layer 1).
 *
 * Reglas implementadas:
 *   1. BCMA: los 3 scans (patient + drug + provider) deben ser true para ADMINISTERED.
 *   2. Doble-check para alto riesgo: Drug.requiresControlledLog=true o RX_CONTROLLED
 *      requiere secondVerifierId != administeredById.
 *   3. Timing-window +-N min alrededor de scheduledTime. Override con reason auditado.
 *   4. State machine: INSERT acepta todos los estados destino desde SCHEDULED.
 *   5. Cumulative qty: router valida administeredQty + doseAmount <= prescribedQty
 *      (salvo override). El trigger SQL 32_emar_hardening.sql mantiene consistencia DB.
 */
import { TRPCError } from "@trpc/server";
import {
  medicationAdministrationRecordInput,
  medicationAdministrationListInput,
  medicationAdministrationGetInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Retorna true si la administracion esta dentro de la ventana de tiempo. */
export function isWithinTimingWindow(
  scheduledTime: Date,
  now: Date,
  windowMinutes: number,
): boolean {
  const diffMs = Math.abs(now.getTime() - scheduledTime.getTime());
  return diffMs <= windowMinutes * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const medicationAdminRouter = router({
  /**
   * `record` -- registra una administracion de medicamento.
   * Aplica las 5 reglas de hardening layer 1.
   */
  record: tenantProcedure
    .input(medicationAdministrationRecordInput)
    .mutation(async ({ ctx, input }) => {
      // -- Cargar PrescriptionItem + Drug + cumulative qty --
      const item = await ctx.prisma.prescriptionItem.findFirst({
        where: {
          id: input.prescriptionItemId,
          prescription: {
            organizationId: ctx.tenant.organizationId,
            status: { in: ["SIGNED", "PARTIALLY_DISPENSED", "DISPENSED"] },
          },
        },
        select: {
          id: true,
          prescribedQty: true,
          administeredQty: true,
          drug: {
            select: {
              requiresControlledLog: true,
              dispensingClass: true,
            },
          },
        },
      });

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Item de prescripcion no existe en la organizacion o no esta firmado.",
        });
      }

      const targetStatus = input.status;

      // -- Regla 1: BCMA -- los 3 scans requeridos para ADMINISTERED --
      if (targetStatus === "ADMINISTERED") {
        const bcmaOk =
          input.patientBarcodeScanned &&
          input.drugBarcodeScanned &&
          input.providerBadgeScanned;

        if (!bcmaOk) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "BCMA incompleto: se requieren los 3 scans (paciente, medicamento, proveedor) " +
              "para registrar una administracion.",
          });
        }
      }

      // -- Regla 2: Doble-check para alto riesgo --
      const isHighRisk =
        item.drug.requiresControlledLog ||
        item.drug.dispensingClass === "RX_CONTROLLED";

      if (isHighRisk && targetStatus === "ADMINISTERED") {
        if (!input.secondVerifierId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Medicamento de alto riesgo requiere secondVerifierId para administrar.",
          });
        }
        if (input.secondVerifierId === ctx.user.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "El segundo verificador debe ser un usuario distinto al que administra.",
          });
        }
      }

      // -- Regla 3: Timing-window --
      if (input.scheduledTime && targetStatus === "ADMINISTERED") {
        const now = new Date();
        const inWindow = isWithinTimingWindow(
          input.scheduledTime,
          now,
          input.timingWindowMinutes,
        );

        if (!inWindow && !input.overrideReason) {
          const windowMin = input.timingWindowMinutes;
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              `Administracion fuera de la ventana de +-${windowMin} minutos del horario programado. ` +
              "Proporcione overrideReason para registrar con override auditado.",
          });
        }
      }

      // -- Regla 5: Cumulative qty --
      if (targetStatus === "ADMINISTERED" && input.doseAmount != null) {
        const prescribed = Number(item.prescribedQty);
        const administered = Number(item.administeredQty);

        if (prescribed > 0 && administered + input.doseAmount > prescribed) {
          if (!input.overrideReason) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                `La cantidad acumulada (${administered + input.doseAmount}) excede la prescrita (${prescribed}). ` +
                "Proporcione overrideReason para continuar.",
            });
          }
        }
      }

      // -- Persistir --
      return ctx.prisma.medicationAdministration.create({
        data: {
          organizationId: ctx.tenant.organizationId,
          prescriptionItemId: input.prescriptionItemId,
          administeredById: ctx.user.id,
          secondVerifierId: input.secondVerifierId ?? null,
          status: targetStatus,
          doseAmount: input.doseAmount ?? null,
          doseUnit: input.doseUnit ?? null,
          route: input.route ?? null,
          site: input.site ?? null,
          patientBarcodeScanned: input.patientBarcodeScanned,
          drugBarcodeScanned: input.drugBarcodeScanned,
          providerBadgeScanned: input.providerBadgeScanned,
          scannedAt: input.scannedAt ?? null,
          barcodeScannedAt: input.barcodeScannedAt ?? null,
          patientWristbandScanned: input.patientWristbandScanned,
          doubleCheckById: input.doubleCheckById ?? null,
          scheduledTime: input.scheduledTime ?? null,
          timingWindowMinutes: input.timingWindowMinutes,
          overrideReason: input.overrideReason ?? null,
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
