import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  admitSchema,
  transferSchema,
  dischargeSchema,
  encounterListSchema,
  encounterListOpenByOrgSchema,
  encounterCensusSchema,
  buildGSRN,
  validateGSRN,
} from "@his/contracts";
import { Prisma } from "@prisma/client";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";
import {
  isOutOfServiceUnitScope,
  serviceUnitWhereFragment,
} from "../lib/service-unit-scope";
import { nextEncounterNumber } from "../lib/encounter-numbering";
import {
  hookEceEpisodioAfterAdmit,
  resolveEceEstablecimientoId,
} from "../lib/ece-hooks";

/** Prefijo GS1 de fallback cuando la organización no tiene uno configurado. */
const FALLBACK_GS1_PREFIX = "7503000";

function serialFromMrn(mrn: string): number {
  const match = /(\d+)$/.exec(mrn);
  if (match) return Number.parseInt(match[1]!, 10);
  return Array.from(mrn).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 1_000_000;
}


export const encounterRouter = router({
  /**
   * US-5.1 — Admisión completa con tipos.
   *
   * Reglas implementadas:
   *   1. Paciente debe existir, no estar soft-deleted y pertenecer al tenant.
   *   2. Idempotencia: si ya existe un encuentro abierto para el paciente
   *      (`dischargedAt IS NULL`) lo retornamos en lugar de duplicar.
   *   3. SCHEDULED requiere `bedId` (la cama se reservó previamente).
   *      EMERGENCY puede admitir sin cama (triage primero, cama después).
   *      BIRTH/NEWBORN devuelven NOT_IMPLEMENTED hasta Sprint 4 (vínculo madre/RN).
   *   4. Transacción Prisma:
   *        a) emite encounterNumber,
   *        b) crea Encounter,
   *        c) si hay bedId valida `bed.status='FREE'`, crea BedAssignment
   *           y mueve la cama a OCCUPIED.
   *      El audit log corre por trigger global (TDR §5.5).
   *
   * Notas:
   *   - El campo `status` lógico OPEN/CLOSED se modela vía `dischargedAt`
   *     (ver TDR §8.3): no existe columna `status` en Encounter. Usar
   *     `dischargedAt IS NULL` para listar abiertos.
   *   - Campos opcionales del wizard (chiefComplaint, valuables, etc.)
   *     llegan al contrato pero no se persisten aún (TODO Sprint 4).
   */
  admit: tenantProcedure.input(admitSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.tenant.establishmentId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Selecciona un establecimiento antes de admitir.",
      });
    }

    if (input.admissionType === "BIRTH" || input.admissionType === "NEWBORN") {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "Admisión de parto/recién nacido requiere vínculo madre↔RN (Sprint 4).",
      });
    }

    if (input.admissionType === "SCHEDULED" && !input.bedId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Las admisiones programadas requieren cama asignada.",
      });
    }

    // 1) Paciente válido y vivo (deletedAt actúa también como marcador de baja).
    const patient = await ctx.prisma.patient.findFirst({
      where: {
        id: input.patientId,
        organizationId: ctx.tenant.organizationId,
        deletedAt: null,
      },
      select: { id: true, active: true },
    });
    if (!patient) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Paciente no encontrado o inactivo.",
      });
    }

    // 2) Idempotencia: encuentro abierto preexistente.
    const existingOpen = await ctx.prisma.encounter.findFirst({
      where: {
        organizationId: ctx.tenant.organizationId,
        patientId: input.patientId,
        dischargedAt: null,
      },
      orderBy: { admittedAt: "desc" },
    });
    if (existingOpen) {
      return existingOpen;
    }

    const org = await ctx.prisma.organization.findUnique({
      where: { id: ctx.tenant.organizationId },
      select: { functionalCurrency: true },
    });
    const currencyId = input.currencyId ?? org?.functionalCurrency;
    if (!currencyId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Moneda no definida para la organización.",
      });
    }

    // 3) Transacción atómica.
    return ctx.prisma.$transaction(async (tx) => {
      if (input.bedId) {
        const bed = await tx.bed.findFirst({
          where: {
            id: input.bedId,
            organizationId: ctx.tenant.organizationId,
            active: true,
          },
        });
        if (!bed) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Cama no encontrada.",
          });
        }
        if (bed.status !== "FREE") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `La cama ${bed.code} no está disponible (${bed.status}).`,
          });
        }
      }

      const encounterNumber = await nextEncounterNumber(
        tx,
        ctx.tenant.organizationId,
      );

      const encounter = await tx.encounter.create({
        data: {
          countryId: ctx.tenant.countryId,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId!,
          serviceUnitId: input.serviceUnitId,
          patientId: input.patientId,
          patientTypeId: input.patientTypeId,
          patientCategoryId: input.patientCategoryId,
          admissionType: input.admissionType,
          admittedAt: input.admittedAt ?? new Date(),
          encounterNumber,
          currencyId,
          costCenterId: input.costCenterId ?? null,
          // TODO(Sprint 2): resolver tipo de cambio real desde ExchangeRate.
          exchangeRateToFunc: 1,
          createdBy: ctx.user.id,
          // H2-01 (audit Stream A — P1 ALTA): campos de admisión ahora persistidos.
          chiefComplaint: input.chiefComplaint ?? null,
          accompanyingPersonName: input.accompanyingPersonName ?? null,
          valuables: input.valuables ? (input.valuables as Prisma.InputJsonValue) : Prisma.JsonNull,
          isReferral: input.isReferral ?? false,
          referralOrigin: input.referralOrigin ?? null,
        },
      });

      if (input.bedId) {
        await tx.bedAssignment.create({
          data: {
            encounterId: encounter.id,
            bedId: input.bedId,
            reason: "Admisión",
            createdBy: ctx.user.id,
          },
        });
        await tx.bed.update({
          where: { id: input.bedId },
          data: { status: "OCCUPIED" },
        });
      }

      return encounter;
    }).then(async (encounter) => {
      // Hook ECE: crear ece.paciente + ece.episodio_atencion para habilitar
      // documentos clínicos NTEC. TX separada — si falla, no revierte la admisión
      // (se puede backfillear con scripts/backfill-ece.mjs).
      // EXCEPCIÓN: BIRTH/NEWBORN se gestionan en atencion-rn.router (ya crean ece.*).
      if (
        input.admissionType !== "BIRTH" &&
        input.admissionType !== "NEWBORN"
      ) {
        await ctx.prisma.$transaction(async (tx) => {
          const eceEstabId = await resolveEceEstablecimientoId(
            tx,
            ctx.tenant.establishmentId!,
          );
          if (!eceEstabId) {
            // ece.establecimiento no inicializado: ejecutar backfill-ece.mjs primero.
            console.warn(
              `[encounter.admit] ece.establecimiento no encontrado para estab=${ctx.tenant.establishmentId}. ` +
                "Ejecuta scripts/backfill-ece.mjs para inicializar el schema ECE.",
            );
            return;
          }

          const patient = await tx.patient.findFirst({
            where: { id: input.patientId },
            select: { id: true, mrn: true },
          });
          if (!patient) return;

          await hookEceEpisodioAfterAdmit(
            tx,
            encounter.id,
            input.patientId,
            input.admissionType ?? "SCHEDULED",
            encounter.admittedAt,
            eceEstabId,
            ctx.tenant.establishmentId!,
            patient.mrn,
          );
        }).catch((err: unknown) => {
          console.error(
            `[encounter.admit] hook ECE falló para encounter=${encounter.id}:`,
            err,
          );
        });
      }

      // Hook US.F2.6.1: asignar GSRN al confirmar admisión hospitalaria.
      // TX separada — no bloquea la admisión si el GSRN falla.
      // Silencia CONFLICT (paciente ya tiene GSRN de un encuentro previo).
      await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const patient = await tx.patient.findFirst({
          where: {
            id: input.patientId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, gsrn: true, mrn: true },
        });

        if (!patient || patient.gsrn) return; // ya asignado o no encontrado

        const org = await tx.organization.findUnique({
          where: { id: ctx.tenant.organizationId },
          select: { gs1CompanyPrefix: true },
        });

        if (!org?.gs1CompanyPrefix) {
          // Configurar gs1CompanyPrefix en Administración > Organizaciones
          // para usar el prefijo oficial de la empresa en lugar del fallback.
          console.warn(
            `[GSRN] org ${ctx.tenant.organizationId} sin gs1CompanyPrefix configurado — usando fallback ${FALLBACK_GS1_PREFIX}`,
          );
        }
        const prefix = org?.gs1CompanyPrefix ?? FALLBACK_GS1_PREFIX;
        const serial = serialFromMrn(patient.mrn);
        const gsrn = buildGSRN(prefix, serial);

        if (!validateGSRN(gsrn)) return; // defensivo

        await tx.patient.update({
          where: { id: patient.id },
          data: { gsrn },
        });
      }).catch(() => {
        // GSRN assignment failure es non-fatal para la creación del encuentro.
      });

      return encounter;
    });
  }),

  transfer: tenantProcedure.input(transferSchema).mutation(async ({ ctx, input }) => {
    return ctx.prisma.encounterTransfer.create({
      data: {
        encounterId: input.encounterId,
        fromServiceId: input.fromServiceId,
        toServiceId: input.toServiceId,
        fromBedId: input.fromBedId,
        toBedId: input.toBedId,
        reason: input.reason,
        createdBy: ctx.user.id,
      },
    });
  }),

  discharge: tenantProcedure.input(dischargeSchema).mutation(async ({ ctx, input }) => {
    return ctx.prisma.encounter.update({
      where: { id: input.encounterId },
      data: {
        dischargeType: input.dischargeType,
        dischargedAt: input.dischargedAt ?? new Date(),
        primaryDiagnosisId: input.primaryDiagnosisId,
        updatedBy: ctx.user.id,
      },
    });
  }),

  list: tenantProcedure.input(encounterListSchema).query(async ({ ctx, input }) => {
    const where = {
      organizationId: ctx.tenant.organizationId,
      ...(input.patientId ? { patientId: input.patientId } : {}),
      ...(input.costCenterId ? { costCenterId: input.costCenterId } : {}),
      ...(input.status === "OPEN" ? { dischargedAt: null } : {}),
      ...(input.status === "CLOSED" ? { dischargedAt: { not: null } } : {}),
    };
    const [items, total] = await Promise.all([
      ctx.prisma.encounter.findMany({
        where,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        orderBy: { admittedAt: "desc" },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          serviceUnit: true,
        },
      }),
      ctx.prisma.encounter.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }),

  /**
   * US-5.1 — listado paginado de encuentros abiertos en la org. Soporta
   * búsqueda por nombre o MRN del paciente, y filtros por tipo de admisión
   * y servicio. Pensado para tablero ADT (US-5.4).
   */
  listOpenByOrg: tenantProcedure
    .input(encounterListOpenByOrgSchema)
    .query(async ({ ctx, input }) => {
      const q = input.query?.trim();
      // Nivel B — bloquea explícitamente si pidieron un servicio fuera de scope.
      if (input.serviceUnitId && isOutOfServiceUnitScope(ctx.tenant, input.serviceUnitId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "El servicio seleccionado no está en tus asignaciones.",
        });
      }
      // Encounter.serviceUnitId es NULLABLE: incluimos nulls para no ocultar
      // encuentros recién admitidos por triage (aún sin servicio definido).
      const scopedSU = input.serviceUnitId
        ? { serviceUnitId: input.serviceUnitId }
        : serviceUnitWhereFragment(ctx.tenant, "serviceUnitId", { includeNullable: true });
      const where = {
        organizationId: ctx.tenant.organizationId,
        dischargedAt: null,
        ...(input.admissionType ? { admissionType: input.admissionType } : {}),
        ...scopedSU,
        ...(input.costCenterId ? { costCenterId: input.costCenterId } : {}),
        ...(q
          ? {
              patient: {
                OR: [
                  { mrn: { contains: q, mode: "insensitive" as const } },
                  { firstName: { contains: q, mode: "insensitive" as const } },
                  { lastName: { contains: q, mode: "insensitive" as const } },
                ],
              },
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.encounter.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: { admittedAt: "desc" },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            serviceUnit: { select: { id: true, code: true, name: true } },
            bedAssignments: {
              where: { releasedAt: null },
              include: { bed: { select: { id: true, code: true, status: true } } },
              take: 1,
            },
          },
        }),
        ctx.prisma.encounter.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }),

  /**
   * US-5.1 — Censo: count agrupado por servicio, tipo de admisión y
   * presencia/ausencia de cama. Devuelve también el listado plano del
   * censo activo para compatibilidad con la UI previa (paneles que ya
   * consumían `getCensus` esperan un array).
   *
   * Para futuro tablero (US-5.4) se exponen los breakdowns agregados.
   */
  getCensus: tenantProcedure
    .input(encounterCensusSchema)
    .query(async ({ ctx, input }) => {
      if (input?.serviceUnitId && isOutOfServiceUnitScope(ctx.tenant, input.serviceUnitId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "El servicio seleccionado no está en tus asignaciones.",
        });
      }
      // Nivel B — incluye nulls (encuentros sin servicio aún no clasificado).
      const scopedSU = input?.serviceUnitId
        ? { serviceUnitId: input.serviceUnitId }
        : serviceUnitWhereFragment(ctx.tenant, "serviceUnitId", { includeNullable: true });
      const where = {
        organizationId: ctx.tenant.organizationId,
        dischargedAt: null,
        ...scopedSU,
      };

      const [items, byService, byAdmissionType] = await Promise.all([
        ctx.prisma.encounter.findMany({
          where,
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            serviceUnit: true,
            bedAssignments: {
              where: { releasedAt: null },
              include: { bed: true },
              take: 1,
            },
          },
          orderBy: { admittedAt: "asc" },
        }),
        ctx.prisma.encounter.groupBy({
          by: ["serviceUnitId"],
          where,
          _count: { _all: true },
        }),
        ctx.prisma.encounter.groupBy({
          by: ["admissionType"],
          where,
          _count: { _all: true },
        }),
      ]);

      return {
        items,
        breakdown: {
          byService: byService.map((b) => ({
            serviceUnitId: b.serviceUnitId,
            count: b._count._all,
          })),
          byAdmissionType: byAdmissionType.map((b) => ({
            admissionType: b.admissionType,
            count: b._count._all,
          })),
          total: items.length,
        },
      };
    }),
});
