import { z } from "zod";
import { triageColorEnum } from "./triage";

/**
 * US-6.5 / US-6.6 — Tablero de triage con cronómetros.
 *
 * Equipo Sierra. NO se exporta desde `schemas/index.ts` aquí (lo cablea Orq);
 * el router consume estas schemas vía import directo.
 *
 * Convenciones:
 *  - `elapsedMinutes` y `remainingMinutes` se calculan en el server al momento
 *    de la query y se devuelven al cliente como float redondeado a 1 decimal.
 *    El cliente además anima el segundero localmente (TriageTimer) para no
 *    depender del polling — ver `triage-timer.tsx`.
 *  - `severity` es derivada del cliente desde elapsed/max, pero la
 *    pre-computamos en server para que el orden y los counts del header sean
 *    consistentes en cada refetch (10s).
 */

export const triageTimerSeverityEnum = z.enum(["NORMAL", "WARNING", "CRITICAL"]);
export type TriageTimerSeverity = z.infer<typeof triageTimerSeverityEnum>;

/** Filtros operativos del whiteboard. */
export const triageDashboardFiltersSchema = z.object({
  /** Búsqueda libre (nombre, MRN). Min 2 chars cuando se aplica. */
  search: z.string().trim().max(80).optional(),
  /** UUID de Establishment — si se omite, usa el activo del tenant. */
  establishmentId: z.string().uuid().optional(),
  /** UUID de ServiceUnit — opcional, restringe la cola. */
  serviceUnitId: z.string().uuid().optional(),
  /** Si true, oculta los que ya pasaron a "WAITING_DOCTOR". MVP: false. */
  onlyActive: z.boolean().default(true),
});

export type TriageDashboardFilters = z.infer<typeof triageDashboardFiltersSchema>;

/** Item del tablero — proyección del TriageEvaluation IN_PROGRESS. */
export const triageQueueItemSchema = z.object({
  id: z.string().uuid(),
  patient: z.object({
    id: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    mrn: z.string(),
    /** Edad en años, calculada desde birthDate. Null si NN sin estimar. */
    ageYears: z.number().int().nonnegative().nullable(),
    isUnknown: z.boolean(),
  }),
  encounterId: z.string().uuid().nullable(),
  serviceUnit: z
    .object({ id: z.string().uuid(), name: z.string() })
    .nullable(),
  assignedLevel: z.object({
    id: z.string().uuid(),
    color: triageColorEnum,
    name: z.string(),
    /** Prioridad clínica: 1=RED, 5=BLUE. */
    priority: z.number().int().min(1).max(5),
    maxWaitMinutes: z.number().int().positive(),
    uiColorHex: z.string().nullable(),
  }),
  status: z.string(),
  /** ISO. Todos los timestamps al cliente vía superjson como Date. */
  startedAt: z.date(),
  /** Cuántas re-evaluaciones encadenadas. Aproxima `reTriageCount`. */
  reTriageCount: z.number().int().nonnegative(),
  /** Calculado server-side al momento de la query. */
  elapsedMinutes: z.number(),
  remainingMinutes: z.number(),
  /** elapsed > maxWaitMinutes. */
  isOverdue: z.boolean(),
  severity: triageTimerSeverityEnum,
});

export type TriageQueueItem = z.infer<typeof triageQueueItemSchema>;

/** Cabecera con counts por nivel — alimenta los 5 cards color-coded. */
export const triageLevelCountSchema = z.object({
  color: triageColorEnum,
  name: z.string(),
  uiColorHex: z.string().nullable(),
  count: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
});

export const triageQueueResponseSchema = z.object({
  serverNow: z.date(),
  counts: z.array(triageLevelCountSchema),
  totalActive: z.number().int().nonnegative(),
  totalOverdue: z.number().int().nonnegative(),
  items: z.array(triageQueueItemSchema),
});

export type TriageQueueResponse = z.infer<typeof triageQueueResponseSchema>;
