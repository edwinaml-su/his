/**
 * Schemas Zod — ECE Registro de Enfermería.
 *
 * Cubre la cabecera del registro de jornada (`ece.registro_enfermeria`) y el
 * detalle de administración de medicamento (`ece.administracion_medicamento`).
 *
 * Norma técnica: TDR §7 NTEC / Doc 7 MAR-Kardex.
 *
 * Columnas BD reales:
 *   ece.registro_enfermeria:        id, instancia_id, episodio_id, turno,
 *                                   nota_evolucion, plan_cuidados, valoracion_enf (jsonb),
 *                                   registrado_por, registrado_en, estado_registro
 *   ece.administracion_medicamento: id, registro_enf_id, indicacion_item_id,
 *                                   hora_programada (timestamptz), hora_aplicada (timestamptz),
 *                                   estado, motivo_omision, responsable
 */
import { z } from "zod";

export const turnoEnum = z.enum(["matutino", "vespertino", "nocturno"]);
export type Turno = z.infer<typeof turnoEnum>;

/** Crea la cabecera del registro de jornada de enfermería. */
export const eceRegistroCreateSchema = z.object({
  episodioId: z.string().uuid(),
  turno: turnoEnum,
  // nota_evolucion en BD (antes: observaciones)
  notaEvolucion: z.string().trim().max(2000).optional(),
  // campos NTEC opcionales expuestos a partir de HD-22
  planCuidados: z.string().trim().max(4000).optional(),
  valoracionEnf: z.record(z.unknown()).optional(),
});

export type EceRegistroCreateInput = z.infer<typeof eceRegistroCreateSchema>;

/** Agrega una administración de medicamento al registro de jornada. */
export const eceAdministracionSchema = z.object({
  // registro_enf_id en BD (antes: registroId → registro_id — columna inexistente)
  registroEnfId: z.string().uuid(),
  indicacionItemId: z.string().uuid(),
  // hora_aplicada en BD (antes: horaAdministrada → hora_administrada — columna inexistente)
  horaAplicada: z.coerce.date(),
  estado: z.enum(["administrado", "omitido", "pospuesto"]).default("administrado"),
  motivoOmision: z.string().trim().max(500).optional(),
  // Campos GS1 opcionales — cuando presentes activan validación 5 correctos obligatoria
  gs1: z.object({
    gtin: z.string().min(8).max(14),
    lote: z.string().min(1).max(80),
    expiry: z.coerce.date(),
    pacienteId: z.string().uuid(),
    pacienteGsrn: z.string().length(18).optional(),
    episodioId: z.string().uuid().optional(),
    dosis: z.string().min(1).max(100).optional(),
    via: z.string().min(1).max(80).optional(),
  }).optional(),
});

export type EceAdministracionInput = z.infer<typeof eceAdministracionSchema>;

/** Filtros para listar registros. */
export const eceRegistroListSchema = z.object({
  episodioId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export type EceRegistroListInput = z.infer<typeof eceRegistroListSchema>;

/** Obtiene un registro por id. */
export const eceRegistroGetSchema = z.object({
  id: z.string().uuid(),
});

export type EceRegistroGetInput = z.infer<typeof eceRegistroGetSchema>;

/** Input de firma y validación: sólo el id del registro. */
export const eceRegistroIdSchema = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// SBAR — Handoff estructurado al cierre de turno (JCI IPSG.2 ME 4)
// ---------------------------------------------------------------------------

const sbarFieldSchema = z.string().trim().min(10).max(2000);

/**
 * Estructura SBAR para handoff inter-turno de enfermería.
 * JCI Standard: IPSG.2 ME 4.
 *
 * Cada componente requiere mínimo 10 caracteres para forzar texto sustantivo
 * (evita "ok", "bien") y máximo 2000 caracteres.
 */
export const sbarSchema = z.object({
  /** Situación actual del paciente al momento del cierre de turno. */
  situation: sbarFieldSchema,
  /** Antecedentes clínicos relevantes para el enfermero entrante. */
  background: sbarFieldSchema,
  /** Evaluación de enfermería: estado actual, tendencias, preocupaciones. */
  assessment: sbarFieldSchema,
  /** Acciones recomendadas o pendientes para el próximo turno. */
  recommendation: sbarFieldSchema,
});

export type SbarInput = z.infer<typeof sbarSchema>;

/**
 * Input para el cierre de turno (procedure cerrarTurno).
 * sbar es opcional — warning en respuesta cuando paciente activo y sbar null.
 */
export const eceRegistroEnfermeriaCierreSchema = z.object({
  id: z.string().uuid(),
  sbar: sbarSchema.optional(),
});
