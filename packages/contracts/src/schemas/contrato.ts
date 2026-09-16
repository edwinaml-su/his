import { z } from "zod";

/**
 * CC-0036 Ola 2 (REQ-HIS-AFIL-001 S2) — ContratoArrendamiento / ContratoJornada
 * / ContratoCargo. sql/245_cc0036_contratos.sql. US.AFIL.1.3, US.AFIL.1.4.
 *
 * ⚠️ Decisión de Edwin Martinez 2026-09-15 que supersede §9 del REQ: CERO
 * integración con Odoo en esta ola. El devengo llega hasta `DEVENGADO` y
 * emite `contrato.cargo.devengado` al outbox (ese ES el "hub de eventos" al
 * que se refiere Edwin — la integración transaccional real se cablea en otra
 * fase). Los estados `ENVIADO_ODOO`/`FACTURADO`/`PAGADO` del enum de estado
 * de `ContratoCargo` quedan declarados (columna `estado` es `varchar` con
 * CHECK, no enum Postgres) pero NINGÚN código de este router los produce ni
 * los consume — son vocabulario reservado para la ola de integración.
 */

export const contratoModalidadEnum = z.enum(["EXCLUSIVO", "COMPARTIDO_POR_JORNADA"]);

export const contratoEstadoEnum = z.enum([
  "BORRADOR",
  "VIGENTE",
  "EN_MORA",
  "SUSPENDIDO",
  "TERMINADO",
  "RENOVADO",
]);

/**
 * Vocabulario completo de la columna `estado` (CHECK, sql/245). Esta ola solo
 * produce DEVENGADO/ANULADO — ENVIADO_ODOO/FACTURADO/PAGADO son reservados
 * para la ola de integración (ver docstring arriba).
 */
export const contratoCargoEstadoEnum = z.enum([
  "DEVENGADO",
  "ENVIADO_ODOO",
  "FACTURADO",
  "PAGADO",
  "ANULADO",
]);

export const contratoCargoConceptoEnum = z.enum([
  "RENTA",
  "SERVICIOS",
  "MORA",
  "AJUSTE",
  "DEPOSITO",
]);

/** "HH:MM" u "HH:MM:SS" — hora local America/El_Salvador, sin offset (NFR-6). Igual a turno.ts. */
const horaSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Formato de hora inválido (HH:MM).");

// -----------------------------------------------------------------------------
// ContratoArrendamiento
// -----------------------------------------------------------------------------

export const contratoListSchema = z
  .object({
    medicoAfiliadoId: z.string().uuid().optional(),
    consultorioId: z.string().uuid().optional(),
    estado: contratoEstadoEnum.optional(),
  })
  .optional();

export const contratoGetSchema = z.object({ id: z.string().uuid() });

export const contratoJornadaInputSchema = z.object({
  diaSemana: z.number().int().min(0).max(6),
  horaInicio: horaSchema,
  horaFin: horaSchema,
});

export const contratoCreateSchema = z
  .object({
    medicoAfiliadoId: z.string().uuid(),
    consultorioId: z.string().uuid(),
    modalidad: contratoModalidadEnum,
    fechaInicio: z.string().date(),
    fechaFin: z.string().date().optional(),
    plazoMeses: z.number().int().positive().max(600).optional(),
    rentaMensual: z.number().positive().max(99_999_999.99),
    cuotaServicios: z.number().min(0).max(99_999_999.99).optional(),
    currencyId: z.string().uuid(),
    diaCorte: z.number().int().min(1).max(31).optional(),
    plazoPagoDias: z.number().int().positive().max(120).optional(),
    ivaAplica: z.boolean().optional(),
    indexacionAnualPct: z.number().min(0).max(100).optional(),
    depositoGarantia: z.number().min(0).max(99_999_999.99).optional(),
    renovacionAutomatica: z.boolean().optional(),
    mesesPreavisoTermino: z.number().int().min(0).max(24).optional(),
    costCenterId: z.string().uuid().optional(),
    notas: z.string().trim().max(2000).optional(),
    /** Solo relevante (y requerido en `activar`) para modalidad COMPARTIDO_POR_JORNADA. */
    jornadas: z.array(contratoJornadaInputSchema).max(50).optional(),
  })
  .refine((v) => v.fechaFin === undefined || v.fechaFin >= v.fechaInicio, {
    message: "fechaFin debe ser posterior o igual a fechaInicio.",
    path: ["fechaFin"],
  });

export const contratoActivarSchema = z.object({ id: z.string().uuid() });

export const contratoTerminarSchema = z.object({
  id: z.string().uuid(),
  fechaEfectiva: z.string().date(),
  motivo: z.string().trim().min(1).max(500),
});

export const contratoMoraSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(500),
});

// -----------------------------------------------------------------------------
// ContratoJornada (CRUD independiente, además del alta embebida en create)
// -----------------------------------------------------------------------------

export const contratoJornadaListSchema = z.object({ contratoId: z.string().uuid() });

export const contratoJornadaCreateSchema = contratoJornadaInputSchema.extend({
  contratoId: z.string().uuid(),
});

export const contratoJornadaDeleteSchema = z.object({ id: z.string().uuid() });

// -----------------------------------------------------------------------------
// ContratoCargo
// -----------------------------------------------------------------------------

export const contratoCargoListSchema = z.object({
  contratoId: z.string().uuid(),
  periodoDesde: z.string().date().optional(),
  periodoHasta: z.string().date().optional(),
});

/** US.AFIL.1.4 — generación manual del período (idempotente por el UNIQUE de BD). */
export const contratoCargoGenerarSchema = z.object({
  contratoId: z.string().uuid(),
  /** Primer día del mes a devengar (YYYY-MM-01). */
  periodo: z.string().date(),
});

/** Solo DEVENGADO es anulable en esta ola (los estados Odoo no existen todavía). */
export const contratoCargoAnularSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(500),
});

export type ContratoListInput = z.infer<typeof contratoListSchema>;
export type ContratoCreateInput = z.infer<typeof contratoCreateSchema>;
export type ContratoActivarInput = z.infer<typeof contratoActivarSchema>;
export type ContratoTerminarInput = z.infer<typeof contratoTerminarSchema>;
export type ContratoMoraInput = z.infer<typeof contratoMoraSchema>;
export type ContratoJornadaInput = z.infer<typeof contratoJornadaInputSchema>;
export type ContratoJornadaCreateInput = z.infer<typeof contratoJornadaCreateSchema>;
export type ContratoCargoListInput = z.infer<typeof contratoCargoListSchema>;
export type ContratoCargoGenerarInput = z.infer<typeof contratoCargoGenerarSchema>;
export type ContratoCargoAnularInput = z.infer<typeof contratoCargoAnularSchema>;
