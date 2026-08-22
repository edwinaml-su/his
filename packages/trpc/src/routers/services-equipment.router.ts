/**
 * §20 Services & Equipment — router (Wave 8 / Beta.11 hardening layer 1).
 *
 * Hardening layer 1:
 *   - State machine validation on setStatus (ALLOWED_TRANSITIONS).
 *   - CRITICAL equipment entering UNDER_MAINTENANCE requires maintenanceReason.
 *   - equipment.getOverduePm — PM schedules with nextDueAt < now() on non-MAINTENANCE equipment.
 *   - equipment.getExpiringCertifications — equipment whose certificationExpiresAt is within N days.
 *   - CalibrationLog remains append-only at DB layer (trigger in 35_equipment_hardening.sql).
 *
 * R02 (auditoría RLS externa) — decisión (a) para TODO el router excepto lo
 * anotado abajo, evidencia 2026-08-22 (psql read-only vía DIRECT_URL prod):
 * `BiomedicalEquipment` tiene policies `biomedical_equipment_tenant_modify`
 * (polcmd='*', `organizationId = current_org_id()`) y
 * `_tenant_select` (polcmd='r', `organizationId = current_org_id() OR
 * is_break_glass()`) — coinciden EXACTO con el filtro `organizationId:
 * ctx.tenant.organizationId` que ya aplicaba todo el router en JS.
 * `PmSchedule`/`CalibrationLog` heredan el boundary via policy `*` con
 * `EXISTS (... BiomedicalEquipment WHERE organizationId = current_org_id())`
 * — también coincide con el filtro `equipment: { organizationId }` ya usado.
 * `authenticated` tiene grants completos en las 3 tablas (verificado).
 * Migrado con `withTenantContext` en todos los procedures de `equipment`,
 * `pmSchedule` y `calibration`.
 * Excepción: `ece.epcis_event_equipment` (usada por `actualizarUbicacion` /
 * `historialUbicaciones`) tiene RLS DESHABILITADO en prod (`relrowsecurity =
 * false`, sin policies) — envolverla en `withTenantContext` no añade
 * protección para ESA tabla (su propio GUC no aplica ahí; el espacio de GUC
 * tampoco sería el correcto — es ece, no public). El boundary real para esas
 * dos operaciones sigue siendo el `findFirst({ id, organizationId })` sobre
 * `BiomedicalEquipment` que ya corre primero — ahora reforzado por RLS real
 * al envolverlo en `withTenantContext`. La falta de RLS en
 * `epcis_event_equipment` es un gap de BD fuera de este scope (no se toca
 * BD en esta tarea); no hay fuga adicional porque la tabla no tiene columna
 * `organizationId`/tenant propia — solo `equipment_id`, ya validado contra
 * el tenant antes del insert/select.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  equipmentCreateInput,
  equipmentListInput,
  equipmentSetStatusInput,
  getOverduePmInput,
  getExpiringCertificationsInput,
  pmScheduleCreateInput,
  pmScheduleListInput,
  pmScheduleCompleteInput,
  pmScheduleCancelInput,
  calibrationLogCreateInput,
  calibrationLogListInput,
  isValidTransition,
  registrarGiaiInput,
  actualizarUbicacionInput,
  historialUbicacionesInput,
  type EquipmentStatusType,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

export const servicesEquipmentRouter = router({
  equipment: router({
    list: tenantProcedure
      .input(equipmentListInput)
      .query(async ({ ctx, input }) => {
        const filters: object[] = [
          { organizationId: ctx.tenant.organizationId },
        ];
        if (input.activeOnly) filters.push({ active: true });
        if (input.establishmentId) filters.push({ establishmentId: input.establishmentId });
        if (input.status) filters.push({ status: input.status });
        if (input.criticality) filters.push({ criticality: input.criticality });
        if (input.category) filters.push({ category: input.category });
        if (input.search) {
          filters.push({
            OR: [
              { assetTag: { contains: input.search, mode: "insensitive" as const } },
              { name: { contains: input.search, mode: "insensitive" as const } },
              { serialNumber: { contains: input.search, mode: "insensitive" as const } },
            ],
          });
        }
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.biomedicalEquipment.findMany({
            where: { AND: filters },
            orderBy: { name: "asc" },
            take: input.limit,
          }),
        );
      }),

    create: tenantProcedure
      .input(equipmentCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const est = await tx.establishment.findFirst({
            where: {
              id: input.establishmentId,
              organizationId: ctx.tenant.organizationId,
            },
            select: { id: true },
          });
          if (!est) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Establecimiento no existe en la organización.",
            });
          }
          return tx.biomedicalEquipment.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              establishmentId: input.establishmentId,
              assetTag: input.assetTag,
              name: input.name,
              manufacturer: input.manufacturer ?? null,
              model: input.model ?? null,
              serialNumber: input.serialNumber ?? null,
              category: input.category ?? null,
              location: input.location ?? null,
              installDate: input.installDate ?? null,
              criticality: input.criticality,
              certificationExpiresAt: input.certificationExpiresAt ?? null,
              createdBy: ctx.user.id,
            },
          });
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.biomedicalEquipment.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId },
          }),
        );
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    setStatus: tenantProcedure
      .input(equipmentSetStatusInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const equipment = await tx.biomedicalEquipment.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId },
            select: { id: true, status: true, criticality: true },
          });
          if (!equipment) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Equipo no existe en la organización.",
            });
          }

          const from = equipment.status as EquipmentStatusType;
          const to = input.status;

          if (!isValidTransition(from, to)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Transición inválida: ${from} → ${to}.`,
            });
          }

          // CRITICAL equipment entering UNDER_MAINTENANCE requires a reason.
          if (equipment.criticality === "CRITICAL" && to === "UNDER_MAINTENANCE") {
            if (!input.maintenanceReason?.trim()) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Equipos CRITICAL requieren maintenanceReason al pasar a UNDER_MAINTENANCE.",
              });
            }
          }

          await tx.biomedicalEquipment.update({
            where: { id: input.id },
            data: {
              status: to,
              maintenanceReason:
                to === "UNDER_MAINTENANCE" ? (input.maintenanceReason ?? null) : null,
            },
          });

          return { ok: true as const };
        });
      }),

    getOverduePm: tenantProcedure
      .input(getOverduePmInput)
      .query(async ({ ctx, input }) => {
        const now = new Date();
        const filters: object[] = [
          { organizationId: ctx.tenant.organizationId },
          { active: true },
          // Equipment not currently in UNDER_MAINTENANCE (those are being worked on).
          { status: { not: "UNDER_MAINTENANCE" } },
        ];
        if (input.establishmentId) filters.push({ establishmentId: input.establishmentId });

        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.biomedicalEquipment.findMany({
            where: {
              AND: [
                ...filters,
                {
                  pmSchedules: {
                    some: {
                      status: { in: ["PLANNED", "OVERDUE"] },
                      scheduledAt: { lt: now },
                    },
                  },
                },
              ],
            },
            include: {
              pmSchedules: {
                where: {
                  status: { in: ["PLANNED", "OVERDUE"] },
                  scheduledAt: { lt: now },
                },
                orderBy: { scheduledAt: "asc" },
              },
            },
            orderBy: { name: "asc" },
            take: input.limit,
          }),
        );
      }),

    getExpiringCertifications: tenantProcedure
      .input(getExpiringCertificationsInput)
      .query(async ({ ctx, input }) => {
        const now = new Date();
        const cutoff = new Date(now.getTime() + input.daysAhead * 24 * 60 * 60 * 1000);

        const filters: object[] = [
          { organizationId: ctx.tenant.organizationId },
          { active: true },
          { certificationExpiresAt: { not: null, lte: cutoff } },
        ];
        if (input.establishmentId) filters.push({ establishmentId: input.establishmentId });

        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.biomedicalEquipment.findMany({
            where: { AND: filters },
            orderBy: { certificationExpiresAt: "asc" },
            take: input.limit,
          }),
        );
      }),

    // ------------------------------------------------------------------
    // GS1 — GIAI + GLN + EPCIS
    // ------------------------------------------------------------------

    registrarGiai: tenantProcedure
      .input(registrarGiaiInput)
      .mutation(async ({ ctx, input }) => {
        try {
          await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
            const eq = await tx.biomedicalEquipment.findFirst({
              where: { id: input.equipmentId, organizationId: ctx.tenant.organizationId },
              select: { id: true },
            });
            if (!eq) throw new TRPCError({ code: "NOT_FOUND", message: "Equipo no encontrado." });

            await tx.biomedicalEquipment.update({
              where: { id: input.equipmentId },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              data: { giai_code: input.giaiCode } as any,
            });
          });
        } catch (err: unknown) {
          if (err instanceof TRPCError) throw err;
          const pg = err as { code?: string };
          if (pg.code === "23505") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "El GIAI ya está asignado a otro equipo.",
            });
          }
          throw err;
        }
        return { ok: true as const };
      }),

    // R02: `ece.epcis_event_equipment` no tiene RLS (ver comentario de
    // cabecera) — se envuelve la parte `public.BiomedicalEquipment` en
    // withTenantContext (boundary real); el INSERT/SELECT a la tabla ece.*
    // corre en la misma tx demotada (ya tiene grants a `authenticated`,
    // verificado) pero sin policy que la restrinja — sin regresión respecto
    // al estado previo (tampoco tenía protección antes).
    actualizarUbicacion: tenantProcedure
      .input(actualizarUbicacionInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const eq = await tx.biomedicalEquipment.findFirst({
            where: { id: input.equipmentId, organizationId: ctx.tenant.organizationId },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            select: { id: true, gln_ubicacion_actual: true } as any,
          });
          if (!eq) throw new TRPCError({ code: "NOT_FOUND", message: "Equipo no encontrado." });

          // Actualiza columna GLN en el equipo
          await tx.biomedicalEquipment.update({
            where: { id: input.equipmentId },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { gln_ubicacion_actual: input.glnUbicacion } as any,
          });

          // Registra evento EPCIS en ece.epcis_event_equipment vía raw query
          // (tabla fuera del schema Prisma; usamos $executeRaw para no bloquear el build)
          await tx.$executeRaw`
            INSERT INTO ece.epcis_event_equipment
              (equipment_id, gln_origen, gln_destino, biz_step, recorded_by)
            VALUES (
              ${input.equipmentId}::uuid,
              ${(eq as Record<string, unknown>).gln_ubicacion_actual as string | null},
              ${input.glnUbicacion},
              ${input.bizStep ?? "storing"},
              ${ctx.user.id}::uuid
            )
          `;

          return { ok: true as const };
        });
      }),

    historialUbicaciones: tenantProcedure
      .input(historialUbicacionesInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // Verifica pertenencia al tenant
          const eq = await tx.biomedicalEquipment.findFirst({
            where: { id: input.equipmentId, organizationId: ctx.tenant.organizationId },
            select: { id: true },
          });
          if (!eq) throw new TRPCError({ code: "NOT_FOUND", message: "Equipo no encontrado." });

          // Lee eventos EPCIS vía raw query (tabla fuera del schema Prisma)
          return tx.$queryRaw<
            {
              id: string;
              event_time: Date;
              biz_step: string | null;
              gln_destino: string | null;
              gln_origen: string | null;
              recorded_by: string | null;
            }[]
          >`
            SELECT id, event_time, biz_step, gln_destino, gln_origen, recorded_by
            FROM ece.epcis_event_equipment
            WHERE equipment_id = ${input.equipmentId}::uuid
            ORDER BY event_time DESC
            LIMIT ${input.limit}
          `;
        });
      }),
  }),

  pmSchedule: router({
    list: tenantProcedure
      .input(pmScheduleListInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.pmSchedule.findMany({
            where: {
              equipment: { organizationId: ctx.tenant.organizationId },
              ...(input.equipmentId && { equipmentId: input.equipmentId }),
              ...(input.status && { status: input.status }),
              ...((input.fromDate || input.toDate) && {
                scheduledAt: {
                  ...(input.fromDate && { gte: input.fromDate }),
                  ...(input.toDate && { lte: input.toDate }),
                },
              }),
            },
            include: {
              equipment: { select: { id: true, assetTag: true, name: true } },
            },
            orderBy: { scheduledAt: "asc" },
            take: input.limit,
          }),
        );
      }),

    create: tenantProcedure
      .input(pmScheduleCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const eq = await tx.biomedicalEquipment.findFirst({
            where: {
              id: input.equipmentId,
              organizationId: ctx.tenant.organizationId,
            },
            select: { id: true },
          });
          if (!eq) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Equipo no existe en la organización.",
            });
          }
          return tx.pmSchedule.create({
            data: {
              equipmentId: input.equipmentId,
              scheduledAt: input.scheduledAt,
              taskNotes: input.taskNotes ?? null,
            },
          });
        });
      }),

    complete: tenantProcedure
      .input(pmScheduleCompleteInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.pmSchedule.updateMany({
            where: {
              id: input.id,
              equipment: { organizationId: ctx.tenant.organizationId },
              status: { in: ["PLANNED", "OVERDUE"] },
            },
            data: {
              status: "COMPLETED",
              performedAt: new Date(),
              performedBy: ctx.user.id,
              ...(input.taskNotes && { taskNotes: input.taskNotes }),
            },
          }),
        );
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "PM no existe o ya está cerrado.",
          });
        }
        return { ok: true as const };
      }),

    cancel: tenantProcedure
      .input(pmScheduleCancelInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.pmSchedule.updateMany({
            where: {
              id: input.id,
              equipment: { organizationId: ctx.tenant.organizationId },
              status: { in: ["PLANNED", "OVERDUE"] },
            },
            data: { status: "CANCELLED" },
          }),
        );
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "PM no existe o ya está cerrado.",
          });
        }
        return { ok: true as const };
      }),
  }),

  calibration: router({
    list: tenantProcedure
      .input(calibrationLogListInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.calibrationLog.findMany({
            where: {
              equipment: { organizationId: ctx.tenant.organizationId },
              ...(input.equipmentId && { equipmentId: input.equipmentId }),
              ...((input.fromDate || input.toDate) && {
                calibratedAt: {
                  ...(input.fromDate && { gte: input.fromDate }),
                  ...(input.toDate && { lte: input.toDate }),
                },
              }),
            },
            include: {
              equipment: { select: { id: true, assetTag: true, name: true } },
            },
            orderBy: { calibratedAt: "desc" },
            take: input.limit,
          }),
        );
      }),

    create: tenantProcedure
      .input(calibrationLogCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const eq = await tx.biomedicalEquipment.findFirst({
            where: {
              id: input.equipmentId,
              organizationId: ctx.tenant.organizationId,
            },
            select: { id: true },
          });
          if (!eq) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Equipo no existe en la organización.",
            });
          }
          return tx.calibrationLog.create({
            data: {
              equipmentId: input.equipmentId,
              calibratedAt: input.calibratedAt,
              calibratedBy: ctx.user.id,
              externalAgency: input.externalAgency ?? null,
              certificateRef: input.certificateRef ?? null,
              result: input.result,
              nextDueAt: input.nextDueAt ?? null,
              notes: input.notes ?? null,
            },
          });
        });
      }),
  }),
});
