/**
 * §20 Services & Equipment — router (Wave 8 / Beta.11 hardening layer 1).
 *
 * Hardening layer 1:
 *   - State machine validation on setStatus (ALLOWED_TRANSITIONS).
 *   - CRITICAL equipment entering UNDER_MAINTENANCE requires maintenanceReason.
 *   - equipment.getOverduePm — PM schedules with nextDueAt < now() on non-MAINTENANCE equipment.
 *   - equipment.getExpiringCertifications — equipment whose certificationExpiresAt is within N days.
 *   - CalibrationLog remains append-only at DB layer (trigger in 35_equipment_hardening.sql).
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
  type EquipmentStatusType,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

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
        return ctx.prisma.biomedicalEquipment.findMany({
          where: { AND: filters },
          orderBy: { name: "asc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(equipmentCreateInput)
      .mutation(async ({ ctx, input }) => {
        const est = await ctx.prisma.establishment.findFirst({
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
        return ctx.prisma.biomedicalEquipment.create({
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
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.biomedicalEquipment.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    setStatus: tenantProcedure
      .input(equipmentSetStatusInput)
      .mutation(async ({ ctx, input }) => {
        const equipment = await ctx.prisma.biomedicalEquipment.findFirst({
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

        await ctx.prisma.biomedicalEquipment.update({
          where: { id: input.id },
          data: {
            status: to,
            maintenanceReason:
              to === "UNDER_MAINTENANCE" ? (input.maintenanceReason ?? null) : null,
          },
        });

        return { ok: true as const };
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

        return ctx.prisma.biomedicalEquipment.findMany({
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
        });
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

        return ctx.prisma.biomedicalEquipment.findMany({
          where: { AND: filters },
          orderBy: { certificationExpiresAt: "asc" },
          take: input.limit,
        });
      }),
  }),

  pmSchedule: router({
    list: tenantProcedure
      .input(pmScheduleListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.pmSchedule.findMany({
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
        });
      }),

    create: tenantProcedure
      .input(pmScheduleCreateInput)
      .mutation(async ({ ctx, input }) => {
        const eq = await ctx.prisma.biomedicalEquipment.findFirst({
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
        return ctx.prisma.pmSchedule.create({
          data: {
            equipmentId: input.equipmentId,
            scheduledAt: input.scheduledAt,
            taskNotes: input.taskNotes ?? null,
          },
        });
      }),

    complete: tenantProcedure
      .input(pmScheduleCompleteInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.pmSchedule.updateMany({
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
        });
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
        const updated = await ctx.prisma.pmSchedule.updateMany({
          where: {
            id: input.id,
            equipment: { organizationId: ctx.tenant.organizationId },
            status: { in: ["PLANNED", "OVERDUE"] },
          },
          data: { status: "CANCELLED" },
        });
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
        return ctx.prisma.calibrationLog.findMany({
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
        });
      }),

    create: tenantProcedure
      .input(calibrationLogCreateInput)
      .mutation(async ({ ctx, input }) => {
        const eq = await ctx.prisma.biomedicalEquipment.findFirst({
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
        return ctx.prisma.calibrationLog.create({
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
      }),
  }),
});
