/**
 * Router tRPC — CareTask (CC-0026 D1/D2).
 *
 * Tarea de primera clase generada al firmar una indicación médica (u orden de
 * lab/imágenes/traslado) para seguimiento por área/rol. Modelo Prisma
 * `CareTask` (schema `public`), RLS en `packages/database/sql/209_cc0026_care_task.sql`
 * — ver la cabecera de ese archivo para la trampa de los dos espacios de GUC
 * (`withTenantContext` vs `withEceContext`). Este router usa `withTenantContext`
 * (tableros/consultas de UI); el INSERT desde `firmar()` de indicaciones
 * médicas usa `withEceContext` directamente (ver
 * `packages/trpc/src/ece/care-task-consumer.ts`).
 *
 * Alimenta `/tableros/[unidad]` (Ola 3, fuera de alcance de este archivo).
 */
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";
import {
  careTaskListInput,
  careTaskIniciarInput,
  careTaskCompletarInput,
  careTaskCancelarInput,
} from "@his/contracts/schemas/care-task";

// Cualquier rol operativo asignable a una CareTask puede transicionarla —
// `assignedRoleCode` es texto libre de aplicación (sql/209, sin FK a Role),
// así que este wrapper no intenta cerrar el catálogo, solo exige que quien
// llama sea personal clínico/operativo (no ADMIN/FIN puro).
// Roles verificados contra public."Role" en prod (2026-08-26): NURSE,
// PHYSICIAN y TRIAGE_NURSE existen. LAB_TECHNICIAN sigue la convención de
// pathology.router.ts y RAD_TECHNICIAN su simétrico — hoy NO existen como
// Role en prod (gate inerte hasta que se creen; catálogo parametrizable
// per CC-0017). No usar alias fantasma (ENF/MC): no gatean nada.
const careTaskProcedure = requireRole([
  "NURSE",
  "TRIAGE_NURSE",
  "LAB_TECHNICIAN",
  "RAD_TECHNICIAN",
  "PHYSICIAN",
]);

export const careTaskRouter = router({
  list: tenantProcedure.input(careTaskListInput).query(async ({ ctx, input }) => {
    const where = {
      organizationId: ctx.tenant.organizationId,
      ...(input.serviceUnitId ? { serviceUnitId: input.serviceUnitId } : {}),
      ...(input.assignedRoleCode ? { assignedRoleCode: input.assignedRoleCode } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.patientId ? { patientId: input.patientId } : {}),
      ...(input.encounterId ? { encounterId: input.encounterId } : {}),
    };

    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const [items, total] = await Promise.all([
        tx.careTask.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
          include: {
            patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
            serviceUnit: { select: { id: true, code: true, name: true } },
          },
        }),
        tx.careTask.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    });
  }),

  /** PENDIENTE → EN_PROCESO. Si no tenía assignee, lo toma quien la inicia. */
  iniciar: careTaskProcedure.input(careTaskIniciarInput).mutation(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const task = await tx.careTask.findFirst({
        where: { id: input.id, organizationId: ctx.tenant.organizationId },
      });
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: `CareTask no encontrada: ${input.id}` });
      }
      if (task.status !== "PENDIENTE") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede iniciar una tarea PENDIENTE. Estado actual: '${task.status}'.`,
        });
      }

      return tx.careTask.update({
        where: { id: input.id },
        data: {
          status: "EN_PROCESO",
          assigneeId: task.assigneeId ?? ctx.user.id,
        },
      });
    });
  }),

  /** PENDIENTE|EN_PROCESO → CUMPLIDA. */
  completar: careTaskProcedure.input(careTaskCompletarInput).mutation(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const task = await tx.careTask.findFirst({
        where: { id: input.id, organizationId: ctx.tenant.organizationId },
      });
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: `CareTask no encontrada: ${input.id}` });
      }
      if (task.status !== "PENDIENTE" && task.status !== "EN_PROCESO") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede completar una tarea PENDIENTE o EN_PROCESO. Estado actual: '${task.status}'.`,
        });
      }

      return tx.careTask.update({
        where: { id: input.id },
        data: {
          status: "CUMPLIDA",
          completedById: ctx.user.id,
          completedAt: new Date(),
        },
      });
    });
  }),

  /** PENDIENTE|EN_PROCESO → CANCELADA. Requiere motivo (≥5 chars). */
  cancelar: careTaskProcedure.input(careTaskCancelarInput).mutation(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const task = await tx.careTask.findFirst({
        where: { id: input.id, organizationId: ctx.tenant.organizationId },
      });
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: `CareTask no encontrada: ${input.id}` });
      }
      if (task.status !== "PENDIENTE" && task.status !== "EN_PROCESO") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede cancelar una tarea PENDIENTE o EN_PROCESO. Estado actual: '${task.status}'.`,
        });
      }

      return tx.careTask.update({
        where: { id: input.id },
        data: { status: "CANCELADA", cancelReason: input.cancelReason },
      });
    });
  }),
});
