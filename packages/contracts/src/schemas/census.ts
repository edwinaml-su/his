import { z } from "zod";

/**
 * US-5.4 — Censo realtime + ocupación.
 *
 * Inputs Zod para los endpoints de `census.router`. Todos los queries
 * son tenant-scoped (la organización viene del contexto), pero permiten
 * un filtro adicional por establecimiento o servicio.
 *
 * Notas:
 *   - `date` por defecto = hoy (en UTC del server). El router calcula
 *     [00:00, 23:59:59.999] en cada query.
 *   - `serviceUnitId` opcional permite reusar los endpoints para un
 *     dashboard agregado o un sub-tablero por servicio.
 */

export const censusBedMapSchema = z
  .object({
    serviceUnitId: z.string().uuid().optional(),
    establishmentId: z.string().uuid().optional(),
  })
  .optional();

export const censusOccupancyStatsSchema = z
  .object({
    /** Snapshot a una fecha (default = hoy). */
    date: z.coerce.date().optional(),
    serviceUnitId: z.string().uuid().optional(),
    establishmentId: z.string().uuid().optional(),
  })
  .optional();

export const censusDailyMovementsSchema = z
  .object({
    date: z.coerce.date().optional(),
    establishmentId: z.string().uuid().optional(),
  })
  .optional();

export const censusKpisByServiceSchema = z.object({
  serviceUnitId: z.string().uuid(),
  /** Ventana de cálculo de estancia promedio (default = 30 días). */
  windowDays: z.number().int().min(1).max(365).default(30),
});

export type CensusBedMapInput = z.infer<typeof censusBedMapSchema>;
export type CensusOccupancyStatsInput = z.infer<typeof censusOccupancyStatsSchema>;
export type CensusDailyMovementsInput = z.infer<typeof censusDailyMovementsSchema>;
export type CensusKpisByServiceInput = z.infer<typeof censusKpisByServiceSchema>;
