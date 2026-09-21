/**
 * CC-0042 / REQ-HIS-TR-001 (S1) — Módulo de Terapia Respiratoria sobre el
 * legacy §21 (RespiratoryOrder). Fuente visual: docs/CC/CC0042/MOCK-HIS-TR-001.html.
 *
 * Orden CPOE-TR (3 secciones del mockup) + sesión (ejecutar/no ejecutar, el
 * cargo se devenga AL EJECUTAR — RN-TR-24) + catálogos parametrizables
 * (procedimientos con tarifa base, medicamentos inhalados con dosis
 * paramétrica, SLA por prioridad). SQL: packages/database/sql/254.
 */
import { z } from "zod";
import { labSlaConfigUpsertInput, labSlaEstadoEnum, labPriorityEnum } from "./lis";

// ---------------------------------------------------------------------------
// Metas de saturación (RN-TR-01..04, RN-TR-34)
// ---------------------------------------------------------------------------

export const TR_METAS_SATURACION = ["94-98", "88-92", "88-93", "OTRO"] as const;
export const trMetaSaturacionEnum = z.enum(TR_METAS_SATURACION);
export type TrMetaSaturacion = z.infer<typeof trMetaSaturacionEnum>;

// ---------------------------------------------------------------------------
// Declaración por sección (RN-TR-32/35)
// ---------------------------------------------------------------------------

export const trDeclaracionSeccionEnum = z.enum(["SELECCIONADA", "NO_REQUIERE"]);

export const trDeclaracionesSchema = z.object({
  oxigenoterapia: trDeclaracionSeccionEnum,
  aerosolterapia: trDeclaracionSeccionEnum,
  seccion3: trDeclaracionSeccionEnum,
});
export type TrDeclaraciones = z.infer<typeof trDeclaracionesSchema>;

// ---------------------------------------------------------------------------
// Bloque de medicamento (RN-TR-36) — snapshot en el ítem
// ---------------------------------------------------------------------------

/** Unidades capturables; «g» se acepta a nivel Zod para que el SERVER la
 *  rechace con el mensaje clínico correcto (bloqueo duro del REQ §6.3). */
export const trUnidadDosisEnum = z.enum(["mg", "µg", "g", "mL", "disparos"]);

export const trMedicamentoItemSchema = z.object({
  clave: z.string().trim().min(1).max(40),
  dosis: z.number().positive().max(100000),
  unidad: trUnidadDosisEnum,
  diluyente: z.string().trim().max(120),
  extraLabel: z.string().trim().max(80).optional(),
  extraValor: z.string().trim().max(120).optional(),
  frecuencia: z.string().trim().max(40),
});
export type TrMedicamentoItem = z.infer<typeof trMedicamentoItemSchema>;

// ---------------------------------------------------------------------------
// Orden CPOE-TR
// ---------------------------------------------------------------------------

export const trOrdenItemInput = z.object({
  codigo: z.string().trim().min(1).max(20),
  /** Solo ítems de aerosolterapia con bloque de medicamento (TR-AER-01/03/04). */
  medicamento: trMedicamentoItemSchema.optional(),
});

export const trOrdenCrearInput = z.object({
  cuentaId: z.string().uuid(),
  /** RN-TR-31 — diagnóstico CIE-11 obligatorio. */
  dxCodigo: z.string().trim().min(1).max(20),
  dxDescripcion: z.string().trim().min(1).max(300),
  prioridad: labPriorityEnum.default("ROUTINE"),
  /** 72 = terapia continua · 24 = protocolo delegado · null = hasta el egreso. */
  vigenciaHoras: z.number().int().min(1).max(720).nullable().default(72),
  declaraciones: trDeclaracionesSchema,
  /** Requerida cuando oxigenoterapia = SELECCIONADA (RN-TR-34 valida OTRO). */
  meta: z
    .object({
      tipo: trMetaSaturacionEnum,
      min: z.number().int().min(50).max(100).optional(),
      max: z.number().int().min(50).max(100).optional(),
      justificacion: z.string().trim().max(2000).optional(),
    })
    .optional(),
  /** Una orden sin procedimientos no tiene objeto clínico ni genera sesiones. */
  items: z.array(trOrdenItemInput).min(1, "La orden debe incluir al menos un procedimiento seleccionado.").max(30),
  observaciones: z.string().trim().max(4000).optional(),
});
export type TrOrdenCrearInput = z.infer<typeof trOrdenCrearInput>;

export const trOrdenListarPorCuentaInput = z.object({ cuentaId: z.string().uuid() });
export const trOrdenDetalleInput = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Sesión (RN-TR-24 — el cargo se devenga al ejecutar)
// ---------------------------------------------------------------------------

/** Anexo B — causas codificadas de no ejecución (lista cerrada v1). */
export const TR_CAUSAS_NO_EJECUCION = [
  "Paciente en estudio de imagen",
  "Paciente fuera de la unidad",
  "Paciente rechaza la terapia",
  "Contraindicación clínica transitoria",
  "Orden suspendida por el médico",
  "Falta de insumo o equipo",
  "Otro (especificar en observaciones)",
] as const;
export const trCausaNoEjecucionEnum = z.enum(TR_CAUSAS_NO_EJECUCION);

export const trSesionEjecutarInput = z
  .object({
    itemId: z.string().uuid(),
    resultado: z.enum(["EJECUTADA", "NO_EJECUTADA"]),
    causaNoEjecucion: trCausaNoEjecucionEnum.optional(),
    observaciones: z.string().trim().max(2000).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.resultado === "NO_EJECUTADA" && !d.causaNoEjecucion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["causaNoEjecucion"],
        message: "Una sesión no ejecutada exige causa codificada (Anexo B).",
      });
    }
  });
export type TrSesionEjecutarInput = z.infer<typeof trSesionEjecutarInput>;

// ---------------------------------------------------------------------------
// Supervisión + SLA (espejo del patrón CC-0040/CC-0041)
// ---------------------------------------------------------------------------

export const trSlaConfigUpsertInput = labSlaConfigUpsertInput;

export const trSupervisionInput = z.object({
  /** Coincide contra paciente, expediente, cuenta o procedimiento. */
  search: z.string().trim().max(160).optional(),
  slaEstado: labSlaEstadoEnum.optional(),
  /** true (default) = incluir sesiones ya ejecutadas/no ejecutadas. */
  incluirCompletados: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(200),
});
export type TrSupervisionInput = z.infer<typeof trSupervisionInput>;

// ---------------------------------------------------------------------------
// Panel de configuración (catálogos parametrizables)
// ---------------------------------------------------------------------------

export const trProcedimientoUpdateInput = z.object({
  /** id de la fila (global o del tenant); el server materializa override de tenant si es global. */
  id: z.string().uuid(),
  nombre: z.string().trim().min(1).max(200).optional(),
  tarifaBase: z.number().min(0).max(999999).nullable().optional(),
  tiempoEstandarMin: z.number().int().min(1).max(600).nullable().optional(),
  requiereConsentimiento: z.boolean().optional(),
  delegablePorProtocolo: z.boolean().optional(),
  activo: z.boolean().optional(),
});
export type TrProcedimientoUpdateInput = z.infer<typeof trProcedimientoUpdateInput>;

export const trMedicamentoUpdateInput = z.object({
  id: z.string().uuid(),
  nombre: z.string().trim().min(1).max(200).optional(),
  dosisMin: z.number().positive().optional(),
  dosisMax: z.number().positive().optional(),
  dosisDefault: z.number().positive().optional(),
  altoRiesgo: z.boolean().optional(),
  precaucion: z.boolean().optional(),
  mensaje: z.string().trim().min(1).max(2000).optional(),
  activo: z.boolean().optional(),
});
export type TrMedicamentoUpdateInput = z.infer<typeof trMedicamentoUpdateInput>;
