import { z } from "zod";

/**
 * CC-0036 Ola 5 (REQ-HIS-AFIL-001 S6) — ConvenioHonorario / ReglaHonorario /
 * ProduccionMedica / Liquidacion / LiquidacionCompensacion.
 * sql/248_cc0036_honorarios.sql. US.AFIL.1.5, US.AFIL.1.6, US.AFIL.1.7.
 *
 * ⚠️ Decisión de Edwin Martinez 2026-09-15 #1 (hub de eventos, misma que
 * CC-0036 Ola 2): CERO integración con Odoo en esta ola. `Liquidacion` llega
 * hasta `APROBADA` y emite `liquidacion.aprobada` al outbox. Los estados
 * `ENVIADA_ODOO`/`PAGADA` quedan declarados (columna `varchar` con CHECK) sin
 * escritor en esta ola.
 *
 * Parámetros que responden a §15 (preguntas abiertas del REQ) — NUNCA
 * hardcodear, siempre editables por convenio/regla:
 *   - `retencionRentaPct`/`aplicaIvaRetenido`/`periodicidadLiquidacion` en
 *     ConvenioHonorario responden a §15.3 (¿la compensación renta-honorarios
 *     está pactada contractualmente?) — el DEFAULT de columna es el 10% del
 *     REQ, pero cada convenio lo fija.
 *   - `montoMinimo`/`montoMaximo`/`prioridad` en ReglaHonorario permiten
 *     parametrizar sin tocar código el §15.1/§15.2 (cuota de servicios /
 *     participación diferenciada sobre insumos) cuando el negocio los
 *     resuelva — hoy solo CIRUGIA/CONSULTA/PROCEDIMIENTO/INTERPRETACION/
 *     VISITA_HOSPITALARIA/INSUMO están cableados como `ambito`.
 */

export const rolMedicoEnum = z.enum([
  "TRATANTE",
  "CIRUJANO",
  "AYUDANTE",
  "ANESTESISTA",
  "INTERPRETE",
  "REFERENTE",
]);

export const ambitoHonorarioEnum = z.enum([
  "CIRUGIA",
  "CONSULTA",
  "PROCEDIMIENTO",
  "INTERPRETACION",
  "VISITA_HOSPITALARIA",
  "INSUMO",
]);

export const tipoCalculoHonorarioEnum = z.enum(["PORCENTAJE", "MONTO_FIJO"]);

export const convenioEstadoEnum = z.enum(["BORRADOR", "VIGENTE", "TERMINADO"]);

export const periodicidadLiquidacionEnum = z.enum(["QUINCENAL", "MENSUAL"]);

export const produccionEstadoEnum = z.enum(["PENDIENTE", "LIQUIDADO", "EXCLUIDO", "REVERSADO"]);

/** MANUAL = exclusión hecha por un analista (produccion.excluir); SIN_REGLA/PERSONAL_DE_PLANTA son automáticas. */
export const motivoExclusionEnum = z.enum(["SIN_REGLA", "PERSONAL_DE_PLANTA", "MANUAL"]);

/** Vocabulario completo (CHECK, sql/248). Esta ola solo produce BORRADOR/APROBADA/ANULADA. */
export const liquidacionEstadoEnum = z.enum(["BORRADOR", "APROBADA", "ENVIADA_ODOO", "PAGADA", "ANULADA"]);

// -----------------------------------------------------------------------------
// ConvenioHonorario
// -----------------------------------------------------------------------------

export const convenioListSchema = z
  .object({
    medicoAfiliadoId: z.string().uuid().optional(),
    estado: convenioEstadoEnum.optional(),
  })
  .optional();

export const convenioGetSchema = z.object({ id: z.string().uuid() });

export const convenioCreateSchema = z
  .object({
    medicoAfiliadoId: z.string().uuid(),
    vigenciaDesde: z.string().date(),
    vigenciaHasta: z.string().date().optional(),
    retencionRentaPct: z.number().min(0).max(1).optional(),
    aplicaIvaRetenido: z.boolean().optional(),
    periodicidadLiquidacion: periodicidadLiquidacionEnum.optional(),
  })
  .refine((v) => v.vigenciaHasta === undefined || v.vigenciaHasta >= v.vigenciaDesde, {
    message: "vigenciaHasta debe ser posterior o igual a vigenciaDesde.",
    path: ["vigenciaHasta"],
  });

export const convenioUpdateSchema = z.object({
  id: z.string().uuid(),
  retencionRentaPct: z.number().min(0).max(1).optional(),
  aplicaIvaRetenido: z.boolean().optional(),
  periodicidadLiquidacion: periodicidadLiquidacionEnum.optional(),
});

/** US.AFIL.1.5 AC1 — solo activa con >=1 regla `active`. */
export const convenioActivarSchema = z.object({ id: z.string().uuid() });

// -----------------------------------------------------------------------------
// ReglaHonorario
// -----------------------------------------------------------------------------

export const reglaListSchema = z.object({ convenioId: z.string().uuid() });

export const reglaCreateSchema = z
  .object({
    convenioId: z.string().uuid(),
    ambito: ambitoHonorarioEnum,
    rolMedico: rolMedicoEnum.optional(),
    serviceCategoryId: z.string().uuid().optional(),
    codigoServicio: z.string().trim().max(40).optional(),
    tipoCalculo: tipoCalculoHonorarioEnum,
    porcentaje: z.number().min(0).max(1).optional(),
    montoFijo: z.number().min(0).max(99_999_999.99).optional(),
    montoMinimo: z.number().min(0).max(99_999_999.99).optional(),
    montoMaximo: z.number().min(0).max(99_999_999.99).optional(),
    prioridad: z.number().int().min(0).max(1000).optional(),
    costCenterId: z.string().uuid().optional(),
    cuentaContableCodigo: z.string().trim().max(40).optional(),
  })
  .refine((v) => (v.tipoCalculo === "PORCENTAJE" ? v.porcentaje !== undefined : v.montoFijo !== undefined), {
    message: "PORCENTAJE requiere 'porcentaje'; MONTO_FIJO requiere 'montoFijo'.",
    path: ["tipoCalculo"],
  })
  .refine((v) => v.montoMinimo === undefined || v.montoMaximo === undefined || v.montoMaximo >= v.montoMinimo, {
    message: "montoMaximo debe ser mayor o igual a montoMinimo.",
    path: ["montoMaximo"],
  });

export const reglaUpdateSchema = z.object({
  id: z.string().uuid(),
  porcentaje: z.number().min(0).max(1).optional(),
  montoFijo: z.number().min(0).max(99_999_999.99).optional(),
  montoMinimo: z.number().min(0).max(99_999_999.99).optional(),
  montoMaximo: z.number().min(0).max(99_999_999.99).optional(),
  prioridad: z.number().int().min(0).max(1000).optional(),
  costCenterId: z.string().uuid().optional(),
  cuentaContableCodigo: z.string().trim().max(40).optional(),
  active: z.boolean().optional(),
});

// -----------------------------------------------------------------------------
// ProduccionMedica
// -----------------------------------------------------------------------------

export const produccionListSchema = z.object({
  medicoAfiliadoId: z.string().uuid().optional(),
  estado: produccionEstadoEnum.optional(),
  fechaDesde: z.string().date().optional(),
  fechaHasta: z.string().date().optional(),
});

/** Reporte de excepciones SIN_REGLA (US.AFIL.1.5 AC5) — obligatorio antes de la primera liquidación real. */
export const produccionExcepcionesSchema = z.object({
  medicoAfiliadoId: z.string().uuid().optional(),
});

export const produccionExcluirSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(200),
});

/** Reprocesa la resolución de regla sobre una producción PENDIENTE (p.ej. tras corregir una regla). */
export const produccionReprocesarSchema = z.object({ id: z.string().uuid() });

// -----------------------------------------------------------------------------
// Liquidacion
// -----------------------------------------------------------------------------

export const liquidacionListSchema = z.object({
  medicoAfiliadoId: z.string().uuid().optional(),
  estado: liquidacionEstadoEnum.optional(),
});

export const liquidacionGetSchema = z.object({ id: z.string().uuid() });

export const liquidacionGenerarSchema = z
  .object({
    medicoAfiliadoId: z.string().uuid(),
    periodoDesde: z.string().date(),
    periodoHasta: z.string().date(),
  })
  .refine((v) => v.periodoHasta >= v.periodoDesde, {
    message: "periodoHasta debe ser posterior o igual a periodoDesde.",
    path: ["periodoHasta"],
  });

export const liquidacionAprobarSchema = z.object({ id: z.string().uuid() });

export const liquidacionAnularSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(500),
});

// -----------------------------------------------------------------------------
// Reportes (Decisión Edwin 2026-09-16 #2c/#2d)
// -----------------------------------------------------------------------------

export const resumenPorRubroSchema = z.object({ accountId: z.string().uuid() });

export const reporteCuentaTerceroSchema = z.object({ accountId: z.string().uuid() });

export type ConvenioListInput = z.infer<typeof convenioListSchema>;
export type ConvenioCreateInput = z.infer<typeof convenioCreateSchema>;
export type ConvenioUpdateInput = z.infer<typeof convenioUpdateSchema>;
export type ReglaCreateInput = z.infer<typeof reglaCreateSchema>;
export type ReglaUpdateInput = z.infer<typeof reglaUpdateSchema>;
export type ProduccionListInput = z.infer<typeof produccionListSchema>;
export type ProduccionExcluirInput = z.infer<typeof produccionExcluirSchema>;
export type LiquidacionListInput = z.infer<typeof liquidacionListSchema>;
export type LiquidacionGenerarInput = z.infer<typeof liquidacionGenerarSchema>;
export type LiquidacionAnularInput = z.infer<typeof liquidacionAnularSchema>;
