/**
 * §20 Services & Equipment — router skeleton (Wave 8 / Phase 2 entry).
 *
 * Cobertura mínima:
 *   - BiomedicalEquipment registro + cambio de estado.
 *   - PmSchedule (mantenimiento preventivo) workflow plan → complete | cancel.
 *   - CalibrationLog inmutable.
 *
 * Programación recurrente de PM (RRULE-based) y notificaciones de calibración
 * vencida viven en iteraciones siguientes.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  equipmentCreateInput,
  equipmentListInput,
  equipmentSetStatusInput,
  pmScheduleCreateInput,
  pmScheduleListInput,
  pmScheduleCompleteInput,
  pmScheduleCancelInput,
  calibrationLogCreateInput,
  calibrationLogListInput,
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
        const updated = await ctx.prisma.biomedicalEquipment.updateMany({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          data: { status: input.status },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Equipo no existe en la organización.",
          });
        }
        return { ok: true as const };
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
