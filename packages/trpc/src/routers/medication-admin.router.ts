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
  recordBedsideAdminInput,
  cancelAdminInput,
  listByPatientInput,
  kardexStatsInput,
  detectAllergyMismatch,
  type AllergyMismatchPayload,
} from "@his/contracts";
import { emitDomainEvent } from "@his/database";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

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
      // Beta.15: include `drug.id` + name fields + `prescription.patientId/
      // prescriberId` para el wiring de allergy.mismatch. PatientAllergy se
      // carga en query separada (no hay relación nominal Prescription→Patient).
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
              id: true,
              atcCode: true,
              genericName: true,
              brandName: true,
              requiresControlledLog: true,
              dispensingClass: true,
            },
          },
          prescription: {
            select: {
              patientId: true,
              prescriberId: true,
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

      // -- Beta.15 (US.B15.4.3b) — detectar allergy.mismatch en estados
      // que representan administración real. SCHEDULED/HELD/REFUSED/MISSED
      // son planificación o no-administración: no emiten. Decisión §5.4
      // (vinculante 2026-05-14): NO bloquea — sólo emite + notifica.
      const isAdministrationAttempt =
        targetStatus === "ADMINISTERED" ||
        targetStatus === "GIVEN" ||
        targetStatus === "DOCUMENTED_LATE";

      let allergyHits: ReturnType<typeof detectAllergyMismatch> = [];
      if (isAdministrationAttempt) {
        const allergies = await ctx.prisma.patientAllergy.findMany({
          where: {
            patientId: item.prescription.patientId,
            active: true,
          },
          select: {
            id: true,
            substanceText: true,
            severity: true,
            substanceConceptId: true,
          },
        });

        if (allergies.length > 0) {
          // Resolver ATC code de cada allergy via ClinicalConcept (sólo cuando
          // el codeSystem es ATC). Una sola query batched.
          const conceptIds = allergies
            .map((a) => a.substanceConceptId)
            .filter((id): id is string => id !== null && id !== undefined);
          const atcByConceptId = new Map<string, string>();
          if (conceptIds.length > 0) {
            const concepts = await ctx.prisma.clinicalConcept.findMany({
              where: {
                id: { in: conceptIds },
                codeSystem: { code: "ATC" },
              },
              select: { id: true, code: true },
            });
            for (const c of concepts) atcByConceptId.set(c.id, c.code);
          }

          allergyHits = detectAllergyMismatch(
            allergies.map((a) => ({
              id: a.id,
              substanceText: a.substanceText,
              allergenAtcCode:
                a.substanceConceptId !== null && a.substanceConceptId !== undefined
                  ? (atcByConceptId.get(a.substanceConceptId) ?? null)
                  : null,
              severity: a.severity,
            })),
            {
              id: item.drug.id,
              atcCode: item.drug.atcCode,
              genericName: item.drug.genericName,
              brandName: item.drug.brandName,
            },
          );
        }
      }

      // -- Persistir + emit DomainEvent (outbox transaccional) --
      // Si no hay hits, el create se ejecuta sin transacción extra para evitar
      // overhead (mismo path que pre-Beta.15).
      if (allergyHits.length === 0) {
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
      }

      // Con hits: create + un emit por match dentro de la misma tx.
      const patientId = item.prescription.patientId;
      const prescriberId = item.prescription.prescriberId;
      return ctx.prisma.$transaction(async (tx) => {
        const created = await tx.medicationAdministration.create({
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

        for (const hit of allergyHits) {
          const payload: AllergyMismatchPayload = {
            medicationAdministrationId: created.id,
            patientId,
            allergyId: hit.allergyId,
            drugId: item.drug.id,
            prescriberId: prescriberId ?? null,
          };
          await emitDomainEvent(tx, {
            organizationId: ctx.tenant.organizationId,
            eventType: "allergy.mismatch",
            aggregateType: "MedicationAdministration",
            aggregateId: created.id,
            emittedById: ctx.user.id,
            payload,
          });
        }
        return created;
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

  /**
   * `recordBedsideAdmin` -- crea MedicationAdministration desde un scan bedside exitoso.
   * US.F2.6.30: vínculo bidireccional bedside scan → eMAR.
   * Captura campos GS1 (GTIN, lote, serie, GSRN) en los campos BCMA opcionales.
   */
  recordBedsideAdmin: tenantProcedure
    .input(recordBedsideAdminInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Validar que el PrescriptionItem (indicación) pertenece a la organización
        // y está en estado apto para administrar.
        const indication = await tx.prescriptionItem.findFirst({
          where: {
            id: input.indicationId,
            prescription: {
              organizationId: ctx.tenant.organizationId,
              status: { in: ["SIGNED", "PARTIALLY_DISPENSED", "DISPENSED"] },
            },
          },
          select: { id: true },
        });

        if (!indication) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Indicación no encontrada o la prescripción no está activa.",
          });
        }

        const admin = await tx.medicationAdministration.create({
          data: {
            organizationId:       ctx.tenant.organizationId,
            prescriptionItemId:   indication.id,
            administeredById:     input.nurseId,
            status:               "ADMINISTERED",
            administeredAt:       new Date(),
            // BCMA scan flags — todos true porque vienen del flujo bedside
            patientBarcodeScanned:   true,
            drugBarcodeScanned:      true,
            providerBadgeScanned:    true,
            patientWristbandScanned: true,
            scannedAt:               new Date(),
            // Campos GS1 bedside
            bedsideValidationId: input.validationId ?? null,
            gtinScanned:         input.gtin,
            loteScanned:         input.lote,
            serieScanned:        input.serie ?? null,
            gsrnPaciente:        input.gsrnPaciente ?? null,
            gsrnEnfermera:       input.gsrnEnfermera ?? null,
            glnUbicacion:        input.glnUbicacion ?? null,
            route:               input.route ?? null,
            site:                input.site ?? null,
            notes:               input.notes ?? null,
          },
        });

        // Emitir evento de dominio para outbox/notificaciones
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType:      "medication.administered.bedside",
          aggregateType:  "MedicationAdministration",
          aggregateId:    admin.id,
          emittedById:    input.nurseId,
          payload: {
            patientId:   input.patientId,
            gtin:        input.gtin,
            lote:        input.lote,
            administeredAt: admin.administeredAt.toISOString(),
          },
        });

        return admin;
      });
    }),

  /**
   * `cancelAdmin` -- cancela una administración con motivo obligatorio.
   * US.F2.6.31-33: enfermería puede cancelar con razón; notifica al médico prescriptor.
   */
  cancelAdmin: tenantProcedure
    .input(cancelAdminInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const existing = await tx.medicationAdministration.findFirst({
          where: {
            id:             input.adminId,
            organizationId: ctx.tenant.organizationId,
          },
          include: {
            prescriptionItem: {
              include: {
                prescription: { select: { prescriberId: true, patientId: true } },
              },
            },
          },
        });

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        if (existing.status === "CANCELED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La administración ya fue cancelada.",
          });
        }

        const canceled = await tx.medicationAdministration.update({
          where: { id: input.adminId },
          data: {
            status:       "CANCELED",
            cancelReason: input.cancelReason,
            canceledAt:   new Date(),
            canceledById: ctx.user.id,
          },
        });

        // Notificar al médico prescriptor si hay dosis cancelada
        const prescriberId = existing.prescriptionItem?.prescription?.prescriberId;
        if (prescriberId) {
          await emitDomainEvent(tx, {
            organizationId: ctx.tenant.organizationId,
            eventType:      "medication.administration.canceled",
            aggregateType:  "MedicationAdministration",
            aggregateId:    canceled.id,
            emittedById:    ctx.user.id,
            payload: {
              cancelReason:  input.cancelReason,
              canceledById:  ctx.user.id,
              prescriberId,
              patientId:     existing.prescriptionItem?.prescription?.patientId,
            },
          });
        }

        return canceled;
      });
    }),

  /**
   * `listByPatient` -- historial kardex por paciente.
   * US.F2.6.31: lista de medicamentos pendientes/administrados por paciente.
   * Requiere join prescriptionItem → prescription → patientId.
   */
  listByPatient: tenantProcedure
    .input(listByPatientInput)
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.medicationAdministration.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            prescriptionItem: {
              prescription: { patientId: input.patientId },
            },
            ...(input.status && { status: input.status }),
            ...((input.fromDate || input.toDate) && {
              administeredAt: {
                ...(input.fromDate && { gte: input.fromDate }),
                ...(input.toDate  && { lte: input.toDate  }),
              },
            }),
          },
          include: {
            administeredBy: { select: { id: true, fullName: true } },
            canceledBy:     { select: { id: true, fullName: true } },
            prescriptionItem: {
              include: {
                drug: {
                  select: { id: true, genericName: true, brandName: true, atcCode: true },
                },
              },
            },
          },
          orderBy: { administeredAt: "desc" },
          take:    input.limit,
        });
      });
    }),

  /**
   * `kardexStats` -- agregados BI para reportes de administración.
   * US.F2.6.32-33: % BCMA, % cancelaciones, top medicamentos.
   */
  kardexStats: tenantProcedure
    .input(kardexStatsInput)
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const [total, withBcma, canceled, topMeds] = await Promise.all([
          tx.medicationAdministration.count({
            where: {
              organizationId: ctx.tenant.organizationId,
              administeredAt: { gte: input.fromDate, lte: input.toDate },
            },
          }),
          tx.medicationAdministration.count({
            where: {
              organizationId: ctx.tenant.organizationId,
              administeredAt: { gte: input.fromDate, lte: input.toDate },
              gtinScanned:    { not: null },
            },
          }),
          tx.medicationAdministration.groupBy({
            by:    ["cancelReason"],
            where: {
              organizationId: ctx.tenant.organizationId,
              administeredAt: { gte: input.fromDate, lte: input.toDate },
              status:         "CANCELED",
            },
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
          }),
          tx.medicationAdministration.groupBy({
            by:    ["prescriptionItemId"],
            where: {
              organizationId: ctx.tenant.organizationId,
              administeredAt: { gte: input.fromDate, lte: input.toDate },
              status:         { in: ["ADMINISTERED", "GIVEN"] },
            },
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            take: 10,
          }),
        ]);

        return {
          total,
          bcmaCount:         withBcma,
          bcmaPct:           total > 0 ? Math.round((withBcma / total) * 100) : 0,
          canceledByReason:  canceled.map((r) => ({
            reason: r.cancelReason ?? "SIN_MOTIVO",
            count:  r._count.id,
          })),
          topPrescriptionItemIds: topMeds.map((r) => ({
            prescriptionItemId: r.prescriptionItemId,
            count:              r._count.id,
          })),
        };
      });
    }),
});
