/**
 * US-5.3 — Traslados internos.
 *
 * Equipo Lima · Sprint 3.
 *
 * Estos esquemas son **independientes** del `transferSchema` de
 * `encounter.ts` (que sigue alimentando el legacy `encounter.transfer`
 * mantenido por el equipo de admisión). Aquí modelamos el contrato del
 * router dedicado `encounter-transfer.router.ts` con la semántica nueva
 * exigida por la historia: el cliente identifica el destino por
 * `toServiceUnitId` (servicio) y opcionalmente `toBedId` (cama). El
 * origen lo resuelve el servidor a partir de `Encounter.serviceUnitId`
 * y el `BedAssignment` activo.
 *
 * NO se registra en `schemas/index.ts` (otros equipos extienden ese
 * barrel — restricción del Sprint 3). El router importa por ruta
 * relativa: `../../contracts/src/schemas/transfer` resuelto vía el
 * paquete `@his/contracts/schemas/transfer` cuando se exponga, o por
 * import directo con la ruta del paquete.
 */
import { z } from "zod";

/** Input para `encounter-transfer.transferEncounter`. */
export const transferEncounterInput = z.object({
  encounterId: z.string().uuid(),
  toServiceUnitId: z.string().uuid(),
  toBedId: z.string().uuid().optional(),
  reason: z.string().trim().min(2).max(200),
});

/** Input para `encounter-transfer.listByEncounter`. */
export const listTransfersByEncounterInput = z.object({
  encounterId: z.string().uuid(),
});

/** Input para `encounter-transfer.listRecent` (tablero `/transfers`). */
export const listRecentTransfersInput = z.object({
  serviceUnitId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type TransferEncounterInput = z.infer<typeof transferEncounterInput>;
export type ListTransfersByEncounterInput = z.infer<
  typeof listTransfersByEncounterInput
>;
export type ListRecentTransfersInput = z.infer<typeof listRecentTransfersInput>;
