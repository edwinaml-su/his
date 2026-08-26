/**
 * CC-0026 D3 — Tableros de seguimiento por área/rol (`/tableros/[unidad]`).
 *
 * Inputs para `packages/trpc/src/routers/care-board.router.ts`, que lee
 * `CareTask` (vocabulario en `./care-task.ts`) agrupado por `ServiceUnit`
 * (columna `areaType`, sql/212) o por rol transversal (enfermería).
 */
import { z } from "zod";
import { careTaskStatusEnum } from "./care-task";

export const careBoardAreaTypeEnum = z.enum([
  "QUIROFANO",
  "LABORATORIO",
  "IMAGENES",
  "EMERGENCIA",
  "UCI",
  "UCIN",
  "MAX_URGENCIA",
  "SALA_ESPERA",
  "HOSPITALIZACION",
  "CONSULTA",
  "FARMACIA",
  "PARTOS",
  "OTRA",
]);

/** `board` acepta O una unidad de servicio O un rol transversal (enfermería) — nunca ambos. */
export const careBoardInput = z
  .object({
    serviceUnitId: z.string().uuid().optional(),
    rol: z.literal("NURSE").optional(),
    status: careTaskStatusEnum.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  })
  .refine((v) => !!v.serviceUnitId !== !!v.rol, {
    message: "Especifica exactamente uno de serviceUnitId o rol.",
  });

export type CareBoardAreaType = z.infer<typeof careBoardAreaTypeEnum>;
export type CareBoardInput = z.infer<typeof careBoardInput>;
