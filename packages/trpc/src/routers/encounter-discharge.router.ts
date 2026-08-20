/**
 * US-5.5 — Alta + epicrisis (equipo Lima · Sprint 3).
 *
 * Router dedicado para egresar un encuentro y persistir la epicrisis.
 * Única fuente de verdad para altas — el legacy `encounter.router.discharge`
 * (mutation minimalista sin filtro de tenant, sin liberar cama, sin bloqueo
 * DEATH, sin EPCIS) fue eliminado (remediación R01, sin consumidores UI
 * activos). Reglas de negocio (DoR/DoD US-5.5):
 *
 *   1. Encuentro debe estar abierto.
 *   2. `DEATH` se bloquea: el flujo de defunción lo gestiona otro
 *      equipo (Quito · Sprint 3) sobre `DeathCertificate`.
 *   3. Cierra `BedAssignment` activo y marca cama `DIRTY`.
 *   4. Resuelve diagnóstico CIE-10 → `ClinicalConcept.id`. Si no
 *      existe en el catálogo, deja `primaryDiagnosisId=null` y
 *      preserva código + descripción dentro de la epicrisis JSON
 *      (TODO Sprint 4: catálogo CIE-10 completo seedado).
 *   5. Update `Encounter.dischargedAt`, `dischargeType`,
 *      `primaryDiagnosisId`.
 *   6. Persiste epicrisis estructurada en `audit.AuditLog.afterJson`
 *      como entry `entity='Encounter.epicrisis'`. (TODO Sprint 4:
 *      tabla `Epicrisis` dedicada con firma digital.)
 *
 * Nota: el modelo `Encounter` no tiene columna `notes` (verificado en
 * schema.prisma §1195). Por eso usamos AuditLog como almacén
 * provisional según indica el brief.
 */
import { TRPCError } from "@trpc/server";
import {
  dischargeEncounterInput,
  epicrisisInput,
  type EpicrisisDoc,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";
import { buildPatientMovementEvent } from "../lib/epcis-builder";
import { persistPatientMovementEvent } from "../lib/epcis-patient-persist";
import { resolveLocationGln } from "../lib/gln-resolver";
import { resolveEceEstablecimientoId } from "../lib/ece-hooks";

/**
 * Heurística para identificar el sistema CIE-10 entre los CodeSystem
 * disponibles. Aceptamos varias convenciones de código.
 */
const CIE10_CODES = ["CIE-10", "CIE10", "ICD-10", "ICD10"] as const;

/** Prefijo GS1 de fallback cuando la organización no tiene uno configurado (ADR 0019 D1/D6, mismo valor que encounter.router.ts). */
const FALLBACK_GS1_PREFIX = "7503000";

export const encounterDischargeRouter = router({
  dischargeEncounter: tenantProcedure
    .input(dischargeEncounterInput)
    .mutation(async ({ ctx, input }) => {
      if (input.dischargeType === "DEATH") {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Las altas por defunción se gestionan en el flujo de Defunción (US-5.6, equipo Quito).",
        });
      }

      return ctx.prisma.$transaction(async (tx) => {
        // 1) Encuentro abierto.
        const enc = await tx.encounter.findFirst({
          where: {
            id: input.encounterId,
            organizationId: ctx.tenant.organizationId,
          },
          include: {
            bedAssignments: {
              where: { releasedAt: null },
              take: 1,
            },
            patient: { select: { gsrn: true } },
          },
        });
        if (!enc) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Encuentro no encontrado.",
          });
        }
        if (enc.dischargedAt) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "El encuentro ya tiene egreso registrado.",
          });
        }

        // 2) Cerrar BedAssignment activo + cama DIRTY.
        const active = enc.bedAssignments[0];
        if (active) {
          await tx.bedAssignment.update({
            where: { id: active.id },
            data: { releasedAt: new Date() },
          });
          await tx.bed.update({
            where: { id: active.bedId },
            data: { status: "DIRTY" },
          });
        }

        // 3) Resolver diagnóstico por código sobre ClinicalConcept.
        const concept = await tx.clinicalConcept.findFirst({
          where: {
            code: input.primaryDiagnosisCode,
            active: true,
            codeSystem: {
              code: { in: [...CIE10_CODES] },
            },
          },
          select: { id: true, display: true },
        });

        const dischargedAt = new Date();

        // 4) Update encounter.
        const updated = await tx.encounter.update({
          where: { id: enc.id },
          data: {
            dischargedAt,
            dischargeType: input.dischargeType,
            primaryDiagnosisId: concept?.id ?? null,
            updatedBy: ctx.user.id,
          },
        });

        // 4.epcis) ADR 0019 D7 — PATIENT_DISCHARGE, transaccional estricto.
        // Excepción defensiva: sin GSRN, se omite el evento sin fallar el alta.
        if (!enc.patient.gsrn) {
          console.warn(
            `[EPCIS] paciente sin GSRN — se omite evento PATIENT_DISCHARGE (encounter=${enc.id}).`,
          );
        } else {
          const eceEstablecimientoId = await resolveEceEstablecimientoId(
            tx,
            enc.establishmentId,
          );
          if (!eceEstablecimientoId) {
            console.warn(
              `[EPCIS] ece.establecimiento no resuelto para estab=${enc.establishmentId} — se omite evento PATIENT_DISCHARGE (encounter=${enc.id}).`,
            );
          } else {
            const org = await tx.organization.findUnique({
              where: { id: ctx.tenant.organizationId },
              select: { gs1CompanyPrefix: true },
            });
            const companyPrefixLength = (org?.gs1CompanyPrefix ?? FALLBACK_GS1_PREFIX).length;
            const glnReadPoint = await resolveLocationGln(tx, {
              bedId: active?.bedId ?? null,
              serviceUnitId: enc.serviceUnitId,
            });
            const row = buildPatientMovementEvent({
              type: "PATIENT_DISCHARGE",
              gsrnPaciente: enc.patient.gsrn,
              companyPrefixLength,
              glnReadPoint,
              glnBizLocation: null,
              internalRef: {
                bedId: active?.bedId ?? null,
                serviceUnitId: enc.serviceUnitId,
                establishmentId: enc.establishmentId,
              },
              encounterId: enc.id,
              recordedById: ctx.user.id,
              timestamp: dischargedAt,
              establecimientoId: eceEstablecimientoId,
            });
            await persistPatientMovementEvent(tx, ctx.user.id, eceEstablecimientoId, row);
          }
        }

        // 5) Persistir epicrisis en AuditLog.afterJson (provisional).
        const epicrisis: EpicrisisDoc = {
          version: 1,
          primaryDiagnosis: {
            code: input.primaryDiagnosisCode,
            display: concept?.display ?? input.primaryDiagnosisDesc,
            conceptId: concept?.id ?? null,
          },
          summary: input.summary,
          indicationsHome: input.indicationsHome,
          followUpAppointment: input.followUpAppointment
            ? {
                at: input.followUpAppointment.at.toISOString(),
                notes: input.followUpAppointment.notes,
              }
            : undefined,
          generatedAt: dischargedAt.toISOString(),
          generatedBy: ctx.user.id,
        };

        await tx.auditLog.create({
          data: {
            userId: ctx.user.id,
            organizationId: ctx.tenant.organizationId,
            establishmentId: ctx.tenant.establishmentId ?? null,
            action: "SIGN",
            entity: "Encounter.epicrisis",
            entityId: enc.id,
            afterJson: epicrisis,
          },
        });

        return updated;
      });
    }),

  /**
   * Devuelve la epicrisis estructurada de un encuentro egresado. Si la
   * tabla dedicada aún no existe, reconstruye el documento desde
   * `AuditLog` + datos del encuentro.
   */
  epicrisis: tenantProcedure
    .input(epicrisisInput)
    .query(async ({ ctx, input }) => {
      const enc = await ctx.prisma.encounter.findFirst({
        where: {
          id: input.encounterId,
          organizationId: ctx.tenant.organizationId,
        },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              mrn: true,
              birthDate: true,
            },
          },
        },
      });
      if (!enc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Encuentro no encontrado.",
        });
      }
      if (!enc.dischargedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El encuentro aún no tiene egreso registrado.",
        });
      }

      const auditEntry = await ctx.prisma.auditLog.findFirst({
        where: {
          entity: "Encounter.epicrisis",
          entityId: enc.id,
        },
        orderBy: { occurredAt: "desc" },
      });

      const doc =
        (auditEntry?.afterJson as EpicrisisDoc | null) ?? null;

      return {
        encounter: {
          id: enc.id,
          encounterNumber: enc.encounterNumber,
          admittedAt: enc.admittedAt,
          dischargedAt: enc.dischargedAt,
          dischargeType: enc.dischargeType,
        },
        patient: enc.patient,
        primaryDiagnosis: doc?.primaryDiagnosis ?? null,
        summary: doc?.summary ?? null,
        indicationsHome: doc?.indicationsHome ?? null,
        followUpAppointment: doc?.followUpAppointment ?? null,
      };
    }),
});
