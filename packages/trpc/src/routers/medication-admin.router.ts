/**
 * §16 eMAR — router (Beta.8 hardening layer 1 + JCI IPSG.3 layer).
 *
 * Reglas implementadas:
 *   1. BCMA: los 3 scans (patient + drug + provider) deben ser true para ADMINISTERED.
 *   2. Doble-check para alto riesgo: Drug.requiresControlledLog=true o RX_CONTROLLED
 *      requiere secondVerifierId != administeredById.
 *   3. Timing-window +-N min alrededor de scheduledTime. Override con reason auditado.
 *   4. State machine: INSERT acepta todos los estados destino desde SCHEDULED.
 *   5. Cumulative qty: router valida administeredQty + doseAmount <= prescribedQty
 *      (salvo override). El trigger SQL 32_emar_hardening.sql mantiene consistencia DB.
 *   6. JCI IPSG.3 ME 2: LASA pair detection — warning no bloqueante en scan GTIN.
 *   7. JCI IPSG.3 ME 4: double-check independiente para alertLevel high/very_high/critical.
 *   8. JCI IPSG.3 ME 5: bloqueo de dosis máxima pediátrica (tabla ece.pediatric_max_dose).
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
// Constantes IPSG.3
// ---------------------------------------------------------------------------

const DOUBLE_CHECK_ALERT_LEVELS = new Set(["high", "very_high", "critical"]);

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
        // -- JCI Standard: IPSG.1 ME 2 — Verificar 2 identificadores del paciente --
        // Primer ID: GSRN de la pulsera (escaneado físicamente).
        // Segundo ID: DUI o MRN (ingresado/escaneado independientemente).
        // Ambos deben resolverse al mismo patientId para que la administración proceda.
        {
          const { type, value } = input.secondIdentifier;
          const col = type === "DUI" ? '"nationalId"' : '"mrn"';

          // Paciente que coincide con el GSRN de la pulsera
          const byGsrn = await tx.$queryRawUnsafe<{ id: string }[]>(
            `SELECT p.id FROM "Patient" p WHERE p.gsrn = $1 LIMIT 1`,
            input.gsrnPaciente,
          );
          // Paciente que coincide con el segundo identificador
          const bySecond = await tx.$queryRawUnsafe<{ id: string }[]>(
            `SELECT p.id FROM "Patient" p WHERE ${col} = $1 LIMIT 1`,
            value,
          );

          const gsrnPatientId   = byGsrn[0]?.id;
          const secondPatientId = bySecond[0]?.id;

          // Ambos deben existir y apuntar al mismo registro
          if (!gsrnPatientId || !secondPatientId || gsrnPatientId !== secondPatientId) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "IPSG1_TWO_ID_MISMATCH: Los 2 identificadores del paciente no coinciden. " +
                "Se requiere GSRN de pulsera y " + type + " apuntando al mismo paciente (5R: paciente correcto).",
            });
          }
        }

        // Validar que el PrescriptionItem (indicación) pertenece a la organización
        // y está en estado apto para administrar. Incluir drug para LASA + double-check.
        const indication = await tx.prescriptionItem.findFirst({
          where: {
            id: input.indicationId,
            prescription: {
              organizationId: ctx.tenant.organizationId,
              status: { in: ["SIGNED", "PARTIALLY_DISPENSED", "DISPENSED"] },
            },
          },
          select: {
            id: true,
            drug: {
              select: {
                id: true,
                genericName: true,
                alertLevel: true,
              },
            },
          },
        });

        if (!indication) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Indicación no encontrada o la prescripción no está activa.",
          });
        }

        // -- JCI IPSG.3 ME 2 — LASA pair detection --------------------------------
        // Warning no bloqueante: el UI mostrará alerta pero no impedirá continuar.
        type LasaAlertPayload = {
          pairedDrugId:   string;
          pairedDrugName: string;
          razon:          string;
          severidad:      string;
        };
        let lasaAlert: LasaAlertPayload | null = null;

        if (indication.drug) {
          const lasaRows = await tx.$queryRawUnsafe<{
            paired_drug_id:   string;
            paired_drug_name: string;
            razon:            string;
            severidad:        string;
          }[]>(
            `SELECT
               CASE WHEN lp.drug_a_id = $1 THEN lp.drug_b_id ELSE lp.drug_a_id END AS paired_drug_id,
               d."genericName" AS paired_drug_name,
               lp.razon,
               lp.severidad
             FROM ece.lasa_pair lp
             JOIN "Drug" d ON d.id = CASE WHEN lp.drug_a_id = $1 THEN lp.drug_b_id ELSE lp.drug_a_id END
             WHERE (lp.drug_a_id = $1 OR lp.drug_b_id = $1)
               AND lp.activo = true
             LIMIT 1`,
            indication.drug.id,
          );

          if (lasaRows.length > 0 && lasaRows[0]) {
            lasaAlert = {
              pairedDrugId:   lasaRows[0].paired_drug_id,
              pairedDrugName: lasaRows[0].paired_drug_name,
              razon:          lasaRows[0].razon,
              severidad:      lasaRows[0].severidad,
            };
          }
        }

        // -- JCI IPSG.3-H1 (US-21-D4) — LASA acknowledgement bloqueante -----------
        // Si el drug tiene un par LASA activo y el profesional no reconoció el riesgo
        // explícitamente, la administración se rechaza. Esto cierra el gap auditado:
        // "alerta LASA sin trazabilidad en BD" que el surveyor rechaza.
        if (lasaAlert !== null) {
          if (!input.lasaAcknowledged || !input.lasaAcknowledgementReason) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                `IPSG3_LASA_ACK_REQUIRED: El medicamento tiene un par LASA activo ` +
                `("${lasaAlert.pairedDrugName}"). ` +
                `Se requiere lasaAcknowledged=true y lasaAcknowledgementReason (razón clínica ≥10 chars) ` +
                `para proceder con la administración.`,
              cause: {
                code: "IPSG3_LASA_ACK_REQUIRED",
                pairedDrugId:   lasaAlert.pairedDrugId,
                pairedDrugName: lasaAlert.pairedDrugName,
                razon:          lasaAlert.razon,
                severidad:      lasaAlert.severidad,
              },
            });
          }
        }

        // -- JCI IPSG.3 ME 5 — bloqueo de dosis máxima pediátrica -----------------
        // JCI Standard: IPSG.3 ME 5
        // Solo aplica cuando se especifica doseAmount en la administración.
        // noWeightWarning=true indica que no hay peso reciente; el clínico decide continuar.
        let noWeightWarning = false;
        if (input.doseAmount != null && indication.drug) {
          const patientRow = await tx.$queryRawUnsafe<{
            birth_date: Date | null;
          }[]>(
            `SELECT "birthDate" AS birth_date FROM "Patient" WHERE id = $1 LIMIT 1`,
            input.patientId,
          );

          const birthDate = patientRow[0]?.birth_date ?? null;
          if (birthDate) {
            const now = new Date();
            const edadMeses =
              (now.getFullYear() - birthDate.getFullYear()) * 12 +
              (now.getMonth() - birthDate.getMonth());

            // Solo aplica si el paciente tiene menos de 18 años (216 meses)
            if (edadMeses < 216) {
              const viaInput = input.route ?? null;

              const limites = await tx.$queryRawUnsafe<{
                max_dose_mg_per_kg: string | null;
                max_dose_absolute_mg: string | null;
              }[]>(
                `SELECT max_dose_mg_per_kg, max_dose_absolute_mg
                 FROM ece.pediatric_max_dose
                 WHERE drug_id = $1
                   AND $2 >= edad_min_meses
                   AND $2 <= edad_max_meses
                   AND activo = true
                   AND (via IS NULL OR via = $3)
                 ORDER BY via NULLS LAST
                 LIMIT 1`,
                indication.drug.id,
                edadMeses,
                viaInput,
              );

              if (limites.length > 0 && limites[0]) {
                const limite = limites[0];

                // Intentar obtener el último peso del paciente (últimas 24h) desde triage.
                // vitalCode 'WEIGHT' almacena el peso en kg.
                const pesoRows = await tx.$queryRawUnsafe<{
                  value_numeric: string | null;
                }[]>(
                  `SELECT tvs."valueNumeric" AS value_numeric
                   FROM "TriageVitalSign" tvs
                   JOIN "TriageEvaluation" te ON te.id = tvs."evaluationId"
                   WHERE te."patientId" = $1
                     AND tvs."vitalCode" = 'WEIGHT'
                     AND tvs."measuredAt" >= now() - interval '24 hours'
                   ORDER BY tvs."measuredAt" DESC
                   LIMIT 1`,
                  input.patientId,
                );

                const pesoKg = pesoRows[0]?.value_numeric
                  ? parseFloat(pesoRows[0].value_numeric)
                  : null;

                if (pesoKg === null) {
                  // Sin peso reciente: warning, no bloquea — el clínico decide.
                  noWeightWarning = true;
                } else {
                  const doseAmount = input.doseAmount;
                  const dosisCalculada = doseAmount / pesoKg;

                  // Verificar mg/kg/dosis
                  if (limite.max_dose_mg_per_kg !== null) {
                    const maxMgPerKg = parseFloat(limite.max_dose_mg_per_kg);
                    if (dosisCalculada > maxMgPerKg) {
                      throw new TRPCError({
                        code: "PRECONDITION_FAILED",
                        message:
                          `IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED: Dosis calculada ${dosisCalculada.toFixed(3)} mg/kg ` +
                          `supera el límite pediátrico de ${maxMgPerKg} mg/kg para este medicamento.`,
                        cause: {
                          code: "IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED",
                          maxDoseMgPerKg: maxMgPerKg,
                          dosisCalculada,
                        },
                      });
                    }
                  }

                  // Verificar tope absoluto (independiente del peso)
                  if (limite.max_dose_absolute_mg !== null) {
                    const maxAbsoluto = parseFloat(limite.max_dose_absolute_mg);
                    if (doseAmount > maxAbsoluto) {
                      throw new TRPCError({
                        code: "PRECONDITION_FAILED",
                        message:
                          `IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED: Dosis absoluta ${doseAmount} mg ` +
                          `supera el tope absoluto pediátrico de ${maxAbsoluto} mg.`,
                        cause: {
                          code: "IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED",
                          maxDoseAbsoluteMg: maxAbsoluto,
                          dosisCalculada,
                        },
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // -- JCI IPSG.3 ME 4 — double-check para high-alert meds ------------------
        const requiresDoubleCheck =
          indication.drug !== null &&
          indication.drug !== undefined &&
          DOUBLE_CHECK_ALERT_LEVELS.has(indication.drug.alertLevel);

        if (requiresDoubleCheck) {
          if (!input.doubleCheckBy || !input.doubleCheckPin) {
            // Devolver 200 con flag — el UI debe mostrar el modal y reenviar con los datos.
            // No lanzar error todavía para que el frontend pueda capturar el flag.
            return {
              requiresDoubleCheck: true as const,
              lasaAlert,
              administrationId: null,
            };
          }

          if (input.doubleCheckBy === input.nurseId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "IPSG3_DOUBLE_CHECK_SAME_PERSON: El verificador independiente debe ser " +
                "una enfermera distinta a la que administra.",
            });
          }

          // Verificar PIN de la segunda enfermera contra hash almacenado en User.
          // El campo User.pinHash almacena argon2id del PIN institucional.
          const verifier = await tx.$queryRawUnsafe<{ pin_hash: string | null }[]>(
            `SELECT "pinHash" AS pin_hash FROM "User" WHERE id = $1 LIMIT 1`,
            input.doubleCheckBy,
          );

          if (!verifier[0]) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "IPSG3_DOUBLE_CHECK_FAILED: Verificadora no encontrada.",
            });
          }

          // Verificación hash argon2id — comparación timing-safe.
          // Si pinHash es NULL: organización no ha configurado PINs (graceful degradation).
          const storedHash = verifier[0].pin_hash;
          if (storedHash !== null) {
            const { argon2 } = await import("@his/infrastructure");
            const pinOk = await argon2.verify(storedHash, input.doubleCheckPin);
            if (!pinOk) {
              throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "IPSG3_DOUBLE_CHECK_FAILED: PIN de verificación incorrecto.",
              });
            }
          }
        }

        // Hash del PIN para persistencia (nunca texto plano).
        let doubleCheckPinHash: string | null = null;
        if (requiresDoubleCheck && input.doubleCheckPin) {
          const { argon2 } = await import("@his/infrastructure");
          doubleCheckPinHash = await argon2.hash(input.doubleCheckPin);
        }

        // Timestamp y campos LASA ack — solo se persisten cuando el drug es LASA.
        const lasaAckNow = lasaAlert !== null ? new Date() : null;

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
            // JCI IPSG.3 ME 4 — double-check
            doubleCheckBy:  input.doubleCheckBy ?? null,
            doubleCheckAt:  requiresDoubleCheck && input.doubleCheckBy ? new Date() : null,
            doubleCheckPin: doubleCheckPinHash,
            // JCI IPSG.3-H1 (US-21-D4) — LASA ack (null cuando drug no es LASA)
            lasaAckAt:     lasaAckNow,
            lasaAckBy:     lasaAlert !== null ? input.nurseId : null,
            lasaAckReason: lasaAlert !== null ? (input.lasaAcknowledgementReason ?? null) : null,
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
            lasaAlert,
          },
        });

        // JCI IPSG.3-H1 — Emitir evento de audit específico para LASA ack
        // (separado del evento bedside para que el auditor pueda filtrar fácilmente).
        if (lasaAlert !== null && lasaAckNow !== null) {
          await emitDomainEvent(tx, {
            organizationId: ctx.tenant.organizationId,
            eventType:      "jci.ipsg3.lasa_acknowledged",
            aggregateType:  "MedicationAdministration",
            aggregateId:    admin.id,
            emittedById:    input.nurseId,
            payload: {
              medicationAdministrationId: admin.id,
              nurseId:        input.nurseId,
              patientId:      input.patientId,
              drugId:         indication.drug?.id ?? null,
              pairedDrugId:   lasaAlert.pairedDrugId,
              pairedDrugName: lasaAlert.pairedDrugName,
              razon:          lasaAlert.razon,
              severidad:      lasaAlert.severidad,
              reason:         input.lasaAcknowledgementReason ?? null,
              ackedAt:        lasaAckNow.toISOString(),
            },
          });
        }

        return {
          requiresDoubleCheck: false as const,
          lasaAlert,
          administrationId: admin.id,
          // JCI IPSG.3 ME 5 — warning si no había peso reciente al momento de administrar
          noWeightWarning,
        };
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
