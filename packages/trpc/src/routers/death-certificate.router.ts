/**
 * US-5.6 — Router del certificado médico de defunción digital.
 *
 * Reglas (DoD):
 *   1. El encounter debe existir, estar abierto (`dischargedAt IS NULL`) y
 *      pertenecer al tenant.
 *   2. El paciente NO debe estar soft-deletado (deletedAt IS NULL). Tras
 *      crear el certificado el paciente NO se soft-deleta — la HCE persiste
 *      para auditoría (TDR §5.5 regla 7). El "estado fallecido" se infiere
 *      de la existencia de DeathCertificate.
 *   3. El usuario que firma debe tener rol PHYSICIAN (o ADMIN para casos
 *      excepcionales / break-glass cubierto en otra ruta).
 *   4. Idempotencia parcial: existe `@unique` sobre `patientId` en
 *      DeathCertificate. Un segundo intento devuelve CONFLICT.
 *   5. Transacción atómica:
 *        a) crear DeathCertificate,
 *        b) cerrar encounter (dischargedAt=occurredAt, dischargeType=DEATH),
 *        c) liberar BedAssignment activo y mover bed a DIRTY,
 *        d) escribir audit log con severity=HIGH.
 *
 * Notas:
 *   - El schema Prisma usa `DischargeType.DEATH` (no `DECEASED`). Mantenemos
 *     `DEATH` por consistencia con el enum existente.
 *   - `notifyCivilRegistry` es un stub: setea `notifiedToCivilRegistryAt`
 *     y deja TODO Sprint 6 para integración con servicio del RNPN.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  deathCertificateCreateSchema,
  deathCertificateByPatientSchema,
  deathCertificateListSchema,
  deathCertificateNotifyCivilRegistrySchema,
  deathCertificateGetSchema,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";

const ICD10_SYSTEM_CODES = ["ICD-10", "ICD10", "CIE-10", "CIE10"] as const;

// B-05: requireRole reemplaza comprobación JS hasPhysicianRole/hasAdminRole.
const physicianProc = requireRole(["PHYSICIAN"]);
const physicianOrAdminProc = requireRole(["PHYSICIAN", "ADMIN"]);

export const deathCertificateRouter = router({
  /**
   * Crea el certificado de defunción + cierra encounter + libera cama.
   * B-05: requireRole(["PHYSICIAN"]) — reemplaza comprobación JS manual.
   */
  create: physicianProc
    .input(deathCertificateCreateSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenant.establishmentId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Selecciona un establecimiento antes de certificar.",
        });
      }

      // Coherencia entre causas: si viene código intermedio/directo, exigir su
      // descripción (y viceversa). El schema marca cada par como opcional para
      // simplificar el tipo, pero ambos deben ir juntos.
      if (
        Boolean(input.intermediateCauseCode) !==
        Boolean(input.intermediateCauseDesc)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Causa intermedia: código y descripción deben venir juntos o ambos ausentes.",
        });
      }
      if (
        Boolean(input.directCauseCode) !== Boolean(input.directCauseDesc)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Causa directa: código y descripción deben venir juntos o ambos ausentes.",
        });
      }

      // 2) Encounter abierto + paciente válido.
      const encounter = await ctx.prisma.encounter.findFirst({
        where: {
          id: input.encounterId,
          organizationId: ctx.tenant.organizationId,
        },
        include: {
          patient: { select: { id: true, deletedAt: true } },
          bedAssignments: { where: { releasedAt: null }, take: 1 },
        },
      });
      if (!encounter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Encuentro no encontrado.",
        });
      }
      if (encounter.dischargedAt) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "El encuentro ya está cerrado. No se puede emitir certificado retroactivamente sin justificación administrativa.",
        });
      }
      if (encounter.patient.deletedAt) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "El paciente está marcado como inactivo (deletedAt). Revisa el estado antes de certificar.",
        });
      }
      if (input.occurredAt < encounter.admittedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "La fecha de fallecimiento no puede ser anterior a la admisión.",
        });
      }

      // 3) Idempotencia: ya existe DeathCertificate para el paciente.
      const existing = await ctx.prisma.deathCertificate.findUnique({
        where: { patientId: encounter.patientId },
        select: { id: true },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "El paciente ya tiene un certificado de defunción registrado.",
        });
      }

      // 4) Transacción atómica.
      return ctx.prisma.$transaction(async (tx) => {
        const certificate = await tx.deathCertificate.create({
          data: {
            patientId: encounter.patientId,
            encounterId: encounter.id,
            organizationId: ctx.tenant.organizationId,
            establishmentId: ctx.tenant.establishmentId!,
            occurredAt: input.occurredAt,
            certifiedById: ctx.user.id,
            basicCauseCode: input.basicCauseCode,
            basicCauseDesc: input.basicCauseDesc,
            intermediateCauseCode: input.intermediateCauseCode,
            intermediateCauseDesc: input.intermediateCauseDesc,
            directCauseCode: input.directCauseCode,
            directCauseDesc: input.directCauseDesc,
            contributingCauses: input.contributingCauses,
            manner: input.manner,
            notes: input.notes,
          },
        });

        // Cierre de encounter como DEATH.
        await tx.encounter.update({
          where: { id: encounter.id },
          data: {
            dischargedAt: input.occurredAt,
            dischargeType: "DEATH",
            updatedBy: ctx.user.id,
          },
        });

        // Liberación de cama: el ciclo de limpieza espera DIRTY.
        const activeAssignment = encounter.bedAssignments[0];
        if (activeAssignment) {
          await tx.bedAssignment.update({
            where: { id: activeAssignment.id },
            data: {
              releasedAt: input.occurredAt,
              reason: "Defunción",
            },
          });
          await tx.bed.update({
            where: { id: activeAssignment.bedId },
            data: { status: "DIRTY" },
          });
        }

        // NOTA: NO se hace soft-delete del paciente. La HCE persiste.
        // El "estado fallecido" se deriva de la existencia de DeathCertificate
        // y del encounter cerrado con dischargeType=DEATH.

        // Audit log severity=HIGH (acción crítica e irreversible).
        await tx.auditLog.create({
          data: {
            userId: ctx.user.id,
            organizationId: ctx.tenant.organizationId,
            establishmentId: ctx.tenant.establishmentId ?? null,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
            action: "CREATE",
            entity: "DeathCertificate",
            entityId: certificate.id,
            afterJson: {
              severity: "HIGH",
              op: "DEATH_CERTIFY",
              encounterId: encounter.id,
              patientId: encounter.patientId,
              basicCauseCode: input.basicCauseCode,
              manner: input.manner ?? null,
              occurredAt: input.occurredAt.toISOString(),
            },
            justification:
              "Emisión de certificado médico de defunción (TDR §8.7).",
          },
        });

        return certificate;
      });
    }),

  /** Devuelve el certificado de un paciente (o null si no existe). */
  byPatient: tenantProcedure
    .input(deathCertificateByPatientSchema)
    .query(async ({ ctx, input }) => {
      return ctx.prisma.deathCertificate.findFirst({
        where: {
          patientId: input.patientId,
          organizationId: ctx.tenant.organizationId,
        },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              mrn: true,
            },
          },
        },
      });
    }),

  /** Lectura individual para el visor. */
  get: physicianOrAdminProc
    .input(deathCertificateGetSchema)
    .query(async ({ ctx, input }) => {
      const cert = await ctx.prisma.deathCertificate.findFirst({
        where: {
          id: input.id,
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
          encounter: {
            select: {
              id: true,
              encounterNumber: true,
              admittedAt: true,
            },
          },
        },
      });
      if (!cert) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Certificado no encontrado.",
        });
      }
      return cert;
    }),

  /**
   * Listado paginado de certificados emitidos. Sólo PHYSICIAN o ADMIN.
   */
  list: physicianOrAdminProc
    .input(deathCertificateListSchema)
    .query(async ({ ctx, input }) => {
      const where = {
        organizationId: input.organizationId ?? ctx.tenant.organizationId,
        ...(input.manner ? { manner: input.manner } : {}),
        ...(input.dateFrom || input.dateTo
          ? {
              occurredAt: {
                ...(input.dateFrom ? { gte: input.dateFrom } : {}),
                ...(input.dateTo ? { lte: input.dateTo } : {}),
              },
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.deathCertificate.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: { occurredAt: "desc" },
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                mrn: true,
              },
            },
          },
        }),
        ctx.prisma.deathCertificate.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }),

  /**
   * Búsqueda CIE-10 para autocomplete en el formulario.
   * Busca en ClinicalConcept activos cuyo CodeSystem sea ICD-10 (variantes
   * de naming aceptadas), por `code` exacto/prefix o `display` containing.
   *
   * Vive aquí (no en catalog.router) para no tocar otros routers (US-5.6).
   */
  searchIcd10: tenantProcedure
    .input(
      z.object({
        query: z.string().trim().min(1).max(120),
        limit: z.number().int().min(1).max(50).default(15),
      }),
    )
    .query(async ({ ctx, input }) => {
      const q = input.query;
      const items = await ctx.prisma.clinicalConcept.findMany({
        where: {
          active: true,
          codeSystem: { code: { in: [...ICD10_SYSTEM_CODES] } },
          OR: [
            { code: { startsWith: q, mode: "insensitive" } },
            { display: { contains: q, mode: "insensitive" } },
          ],
        },
        take: input.limit,
        orderBy: [{ code: "asc" }],
        select: { id: true, code: true, display: true },
      });
      return items;
    }),

  /**
   * Stub: marca el certificado como notificado al Registro Civil.
   * TODO Sprint 6: integración real con web service del RNPN.
   */
  notifyCivilRegistry: physicianOrAdminProc
    .input(deathCertificateNotifyCivilRegistrySchema)
    .mutation(async ({ ctx, input }) => {
      const cert = await ctx.prisma.deathCertificate.findFirst({
        where: {
          id: input.certificateId,
          organizationId: ctx.tenant.organizationId,
        },
      });
      if (!cert) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Certificado no encontrado.",
        });
      }
      if (cert.notifiedToCivilRegistryAt) {
        return cert;
      }
      const now = new Date();
      const updated = await ctx.prisma.deathCertificate.update({
        where: { id: cert.id },
        data: { notifiedToCivilRegistryAt: now },
      });
      await ctx.prisma.auditLog.create({
        data: {
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId ?? null,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          action: "UPDATE",
          entity: "DeathCertificate",
          entityId: cert.id,
          afterJson: {
            severity: "MEDIUM",
            op: "NOTIFY_CIVIL_REGISTRY_STUB",
            notifiedAt: now.toISOString(),
          },
          justification:
            "Notificación al Registro Civil (stub — pendiente integración Sprint 6).",
        },
      });
      return updated;
    }),
});
