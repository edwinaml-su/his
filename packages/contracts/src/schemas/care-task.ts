/**
 * CC-0026 — CareTask: tareas por área/rol generadas al firmar una indicación
 * médica (o al crear una orden de lab/imágenes/traslado), consumidas por los
 * tableros `/tableros/[unidad]` (Ola 3, fuera de alcance) y el router
 * `packages/trpc/src/routers/care-task.router.ts`.
 *
 * Vocabulario espejo de `packages/database/sql/209_cc0026_care_task.sql`
 * (columnas `sourceType`/priority/status con CHECK inline, no enum Postgres).
 */
import { z } from "zod";

export const careTaskSourceTypeEnum = z.enum([
  "INDICACION_ITEM",
  "LAB_ORDER",
  "IMAGING_ORDER",
  "TRANSFER",
  "MANUAL",
]);

export const careTaskPriorityEnum = z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]);

export const careTaskStatusEnum = z.enum([
  "PENDIENTE",
  "EN_PROCESO",
  "CUMPLIDA",
  "CANCELADA",
]);

export const careTaskListInput = z.object({
  serviceUnitId: z.string().uuid().optional(),
  assignedRoleCode: z.string().trim().min(1).max(40).optional(),
  status: careTaskStatusEnum.optional(),
  patientId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const careTaskIniciarInput = z.object({ id: z.string().uuid() });

export const careTaskCompletarInput = z.object({ id: z.string().uuid() });

export const careTaskCancelarInput = z.object({
  id: z.string().uuid(),
  cancelReason: z.string().trim().min(5).max(300),
});

export type CareTaskListInput = z.infer<typeof careTaskListInput>;
export type CareTaskIniciarInput = z.infer<typeof careTaskIniciarInput>;
export type CareTaskCompletarInput = z.infer<typeof careTaskCompletarInput>;
export type CareTaskCancelarInput = z.infer<typeof careTaskCancelarInput>;
