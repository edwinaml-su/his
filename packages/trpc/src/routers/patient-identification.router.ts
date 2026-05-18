/**
 * Router tRPC: Identificación de paciente mediante pulsera GSRN.
 *
 * US.F2.6.37-40 — Proceso E Bedside: identificación segura por GSRN.
 *
 * Procedures:
 *   lookupByGsrn   — escanear pulsera → devuelve ficha completa (RO, cualquier clínico)
 *   refreshGsrn    — emitir nueva pulsera, revocar anterior (ADMIN/ADMISION)
 *   getHistory     — historial de pulseras del paciente (ADMIN/ADMISION)
 *
 * Seguridad:
 *   - withTenantContext obligatorio en toda query tenant-scoped.
 *   - Audit log en cada lookupByGsrn (acceso a PII — NTEC Art. 55-56).
 *   - refreshGsrn y getHistory requieren rol ADMIN o ADMISION.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Validación GSRN-18: 18 dígitos, dígito verificador GS1 Módulo-10.
// Espeja la función ece.gs1_check_digit_valid() en SQL.
// ---------------------------------------------------------------------------

function gs1CheckDigitValid(code: string): boolean {
  if (!/^\d{18}$/.test(code)) return false;
  const len = code.length;
  let sum = 0;
  for (let i = 0; i < len - 1; i++) {
    const fromRight = len - 1 - i;
    const weight = fromRight % 2 === 1 ? 3 : 1;
    sum += parseInt(code[i]!, 10) * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === parseInt(code[len - 1]!, 10);
}

const gsrnSchema = z
  .string()
  .length(18)
  .regex(/^\d{18}$/, "GSRN-18: 18 dígitos numéricos")
  .refine(gs1CheckDigitValid, "Dígito verificador GS1 Módulo-10 inválido");

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const patientIdentificationRouter = router({
  /**
   * Escanear pulsera GSRN → devuelve ficha completa del paciente.
   *
   * Hard-stops:
   *   GSRN_NO_REGISTRADO — código no existe para este tenant.
   *   PULSERA_INACTIVA   — la pulsera fue revocada.
   *
   * Audita en audit.audit_log (NTEC Art. 55-56).
   */
  lookupByGsrn: tenantProcedure
    .input(z.object({ gsrn: gsrnSchema }))
    .query(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;

      return withTenantContext(prisma, tenant, async (tx) => {
        const history = await tx.gsrnHistory.findFirst({
          where: {
            gsrn: input.gsrn,
            organizationId: tenant.organizationId,
          },
          include: {
            patient: {
              include: {
                allergies: {
                  where: { active: true },
                  select: {
                    id: true,
                    substanceText: true,
                    severity: true,
                    reaction: true,
                    verified: true,
                  },
                },
                encounters: {
                  // Activo = no tiene fecha de alta
                  where: { dischargedAt: null, organizationId: tenant.organizationId },
                  orderBy: { admittedAt: "desc" },
                  take: 1,
                  select: {
                    id: true,
                    encounterNumber: true,
                    admittedAt: true,
                    admissionType: true,
                    primaryDiagnosisId: true,
                  },
                },
              },
            },
          },
        });

        if (!history) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "GSRN_NO_REGISTRADO",
          });
        }

        if (history.status === "REVOKED") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "PULSERA_INACTIVA",
          });
        }

        // Audit acceso a PII — NTEC Art. 55-56
        await tx.$executeRaw`
          INSERT INTO audit.audit_log (
            table_name, record_id, action, changed_by, organization_id, payload
          ) VALUES (
            'Patient',
            ${history.patientId}::uuid,
            ${'LOOKUP_BY_GSRN'},
            ${tenant.userId}::uuid,
            ${tenant.organizationId}::uuid,
            jsonb_build_object(
              'gsrn', ${input.gsrn},
              'purpose', 'PATIENT_IDENTIFICATION'
            )
          )
        `;

        const patient = history.patient;
        const activeEncounter = patient.encounters[0] ?? null;

        return {
          gsrn: history.gsrn,
          gsrnAssignedAt: history.assignedAt,
          patient: {
            id: patient.id,
            mrn: patient.mrn,
            firstName: patient.firstName,
            middleName: patient.middleName ?? null,
            lastName: patient.lastName,
            secondLastName: patient.secondLastName ?? null,
            birthDate: patient.birthDate,
            bloodTypeAbo: patient.bloodTypeAbo ?? null,
            bloodRh: patient.bloodRh ?? null,
            active: patient.active,
          },
          allergies: patient.allergies,
          activeEncounter,
        };
      });
    }),

  /**
   * Emitir nueva pulsera para un paciente (revoca la anterior si existe).
   * Solo ADMIN o ADMISION.
   */
  refreshGsrn: requireRole(["ADMIN", "ADMISION"])
    .input(
      z.object({
        patientId: z.string().uuid(),
        newGsrn: gsrnSchema,
        motivoRevocacion: z.string().min(1).max(200).default("DETERIORO_PULSERA"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;

      return withTenantContext(prisma, tenant, async (tx) => {
        const patient = await tx.patient.findFirst({
          where: { id: input.patientId, organizationId: tenant.organizationId },
          select: { id: true, mrn: true },
        });

        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Paciente no encontrado en esta organización.",
          });
        }

        // Unicidad global del GSRN (estándar GS1)
        const existingGsrn = await tx.gsrnHistory.findUnique({
          where: { gsrn: input.newGsrn },
          select: { id: true },
        });

        if (existingGsrn) {
          throw new TRPCError({ code: "CONFLICT", message: "GSRN_DUPLICADO" });
        }

        const now = new Date();

        // Revocar pulsera activa anterior
        await tx.gsrnHistory.updateMany({
          where: {
            patientId: input.patientId,
            organizationId: tenant.organizationId,
            status: "ACTIVE",
          },
          data: {
            status: "REVOKED",
            revokedAt: now,
            revokedById: tenant.userId,
            motivoRevocacion: input.motivoRevocacion,
          },
        });

        // Emitir nueva pulsera
        const newHistory = await tx.gsrnHistory.create({
          data: {
            patientId: input.patientId,
            organizationId: tenant.organizationId,
            gsrn: input.newGsrn,
            status: "ACTIVE",
            assignedAt: now,
            assignedById: tenant.userId,
          },
        });

        // Mantener Patient.gsrn en sync con la pulsera activa
        await tx.patient.update({
          where: { id: input.patientId },
          data: { gsrn: input.newGsrn, updatedBy: tenant.userId },
        });

        return {
          id: newHistory.id,
          gsrn: newHistory.gsrn,
          assignedAt: newHistory.assignedAt,
          patientId: newHistory.patientId,
        };
      });
    }),

  /**
   * Historial completo de pulseras GSRN de un paciente.
   * Solo ADMIN o ADMISION.
   */
  getHistory: requireRole(["ADMIN", "ADMISION"])
    .input(z.object({ patientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;

      return withTenantContext(prisma, tenant, async (tx) => {
        const patient = await tx.patient.findFirst({
          where: { id: input.patientId, organizationId: tenant.organizationId },
          select: { id: true },
        });

        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Paciente no encontrado en esta organización.",
          });
        }

        return tx.gsrnHistory.findMany({
          where: {
            patientId: input.patientId,
            organizationId: tenant.organizationId,
          },
          orderBy: { assignedAt: "desc" },
          select: {
            id: true,
            gsrn: true,
            status: true,
            assignedAt: true,
            revokedAt: true,
            assignedById: true,
            revokedById: true,
            motivoRevocacion: true,
          },
        });
      });
    }),
});
