/**
 * CC-0016 — Módulo de Radiología e Imágenes (mockup) sobre el RIS legacy §18.
 * Fuente: docs/CC/0016/mockup_modulo_imagenes.html.
 *
 * Cabecera de solicitud (ImagingRequest) + N ImagingOrder hijas + parametrización
 * (campos del formulario / reglas del módulo / atributos del catálogo).
 * SQL: packages/database/sql/192_cc0016_modulo_imagenes.sql.
 */
import { z } from "zod";
import { imagingPriorityEnum, type ImagingOrderStatusType } from "./imaging";

// ---------------------------------------------------------------------------
// Campos del formulario de solicitud (mockup FIELDS)
// ---------------------------------------------------------------------------

export const IMAGING_FIELD_KEYS = [
  "dx",
  "just",
  "prio",
  "fecha",
  "embarazo",
  "alergias",
  "creat",
  "obs",
] as const;
export const imagingFieldKeyEnum = z.enum(IMAGING_FIELD_KEYS);
export type ImagingFieldKey = z.infer<typeof imagingFieldKeyEnum>;

const IMAGING_FIELD_ESTADOS = ["obligatorio", "opcional", "oculto"] as const;
export const imagingFieldEstadoEnum = z.enum(IMAGING_FIELD_ESTADOS);
export type ImagingFieldEstado = z.infer<typeof imagingFieldEstadoEnum>;

export const imagingFormFieldConfigSetInput = z.object({
  fieldKey: imagingFieldKeyEnum,
  estado: imagingFieldEstadoEnum,
});
export type ImagingFormFieldConfigSetInput = z.infer<typeof imagingFormFieldConfigSetInput>;

// ---------------------------------------------------------------------------
// Reglas generales del módulo (mockup RULES)
// ---------------------------------------------------------------------------

export const IMAGING_RULE_KEYS = ["multi", "global", "codigo", "flags", "dupWarn", "firma", "maxN"] as const;
export const imagingRuleKeyEnum = z.enum(IMAGING_RULE_KEYS);
export type ImagingRuleKey = z.infer<typeof imagingRuleKeyEnum>;

export const imagingModuleRuleSetInput = z.object({
  ruleKey: imagingRuleKeyEnum,
  enabled: z.boolean(),
  /** Solo aplica a `maxN`; el resto de reglas lo ignoran. */
  valorNum: z.number().int().min(1).max(999).nullable().optional(),
});
export type ImagingModuleRuleSetInput = z.infer<typeof imagingModuleRuleSetInput>;

// ---------------------------------------------------------------------------
// Catálogo de prestaciones (parametrización — CRUD combinado LabTest+attrs)
// ---------------------------------------------------------------------------

export const imagingCatalogoUpsertInput = z
  .object({
    /** Presente = actualiza; ausente = crea una prestación nueva. */
    labTestId: z.string().uuid().optional(),
    panelId: z.string().uuid(),
    /** Requerido al crear; se ignora al actualizar (el code no se edita). */
    code: z.string().trim().min(1).max(20).optional(),
    name: z.string().trim().min(1).max(200),
    displayOrder: z.number().int().min(0).max(999).default(0),
    duracionMin: z.number().int().min(5).max(600).default(20),
    modalityId: z.string().uuid().nullable().optional(),
    requiereContraste: z.boolean().default(false),
    requiereAyuno: z.boolean().default(false),
    requiereAutorizacion: z.boolean().default(false),
    active: z.boolean().default(true),
    preparacionPaciente: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.labTestId !== undefined || d.code !== undefined, {
    message: "code es requerido al crear una prestación nueva.",
    path: ["code"],
  });
export type ImagingCatalogoUpsertInput = z.infer<typeof imagingCatalogoUpsertInput>;

/** Shape de respuesta de `catalogoImagen.list` — LabTest + ImagingTestAttrs unidos. */
export interface ImagingCatalogoItem {
  labTestId: string;
  code: string;
  name: string;
  panelId: string;
  panelNombre: string;
  panelDisplayOrder: number;
  panelActive: boolean;
  displayOrder: number;
  active: boolean;
  requiereContraste: boolean;
  requiereAyuno: boolean;
  requiereAutorizacion: boolean;
  duracionMin: number;
  modalityId: string | null;
  preparacionPaciente: string | null;
}

// ---------------------------------------------------------------------------
// Solicitud — crear / listar / detalle
// ---------------------------------------------------------------------------

export const imagingRequestPrestacionInput = z.object({
  labTestId: z.string().uuid(),
  conContraste: z.boolean().optional(),
  nota: z.string().trim().max(300).optional(),
});
export type ImagingRequestPrestacionInput = z.infer<typeof imagingRequestPrestacionInput>;

/**
 * Todos los campos clínicos (dx/justificacion/prioridad/fecha/embarazo/
 * alergias/creatinina/observaciones) son opcionales a nivel Zod — la
 * obligatoriedad la valida el server según `ImagingFormFieldConfig` de la
 * organización (parametrizable, mockup FIELDS).
 */
export const imagingRequestCrearInput = z.object({
  cuentaId: z.string().uuid(),
  prestaciones: z.array(imagingRequestPrestacionInput).min(1, "Seleccione al menos una prestación.").max(50),
  dx: z.string().trim().max(300).optional(),
  justificacion: z.string().trim().max(4000).optional(),
  prioridad: imagingPriorityEnum.optional(),
  fechaDeseada: z.coerce.date().optional(),
  embarazo: z.string().trim().max(20).optional(),
  alergias: z.string().trim().max(300).optional(),
  creatinina: z.string().trim().max(40).optional(),
  observaciones: z.string().trim().max(4000).optional(),
  /** Requerido solo cuando la regla `firma` está habilitada. */
  pin: z.string().trim().min(1).max(20).optional(),
});
export type ImagingRequestCrearInput = z.infer<typeof imagingRequestCrearInput>;

export const imagingRequestListarPorCuentaInput = z.object({ cuentaId: z.string().uuid() });
export const imagingRequestListarPorPacienteInput = z.object({ patientId: z.string().uuid() });
export const imagingRequestDetalleInput = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Estado derivado de la solicitud (agregado de sus ImagingOrder hijas)
// ---------------------------------------------------------------------------

const IMAGING_SOLICITUD_ESTADOS = ["pend", "prog", "real", "inf", "anulado"] as const;
export const imagingSolicitudEstadoEnum = z.enum(IMAGING_SOLICITUD_ESTADOS);
export type ImagingSolicitudEstado = z.infer<typeof imagingSolicitudEstadoEnum>;

/** Rango de avance por estado de ImagingOrder (CANCELLED se trata aparte). */
const ORDER_STATUS_RANK: Record<Exclude<ImagingOrderStatusType, "CANCELLED">, number> = {
  ORDERED: 0,
  SCHEDULED: 1,
  IN_PROGRESS: 1,
  COMPLETED: 2,
  REPORTED: 3,
  VALIDATED: 3,
};
const RANK_TO_ESTADO: readonly ImagingSolicitudEstado[] = ["pend", "prog", "real", "inf"];

/**
 * Deriva el estado agregado de una solicitud desde los estados de sus
 * ImagingOrder hijas: el MÍNIMO rango entre las órdenes no canceladas
 * (mientras una prestación siga pendiente, la solicitud completa se ve
 * "pend" — mismo criterio que el mockup, que modela una sola solicitud sin
 * estado por-prestación en el listado). Si TODAS las órdenes están
 * CANCELLED (o no hay órdenes), el agregado es "anulado".
 */
export function derivarEstadoSolicitud(
  estadosOrdenes: readonly ImagingOrderStatusType[],
): ImagingSolicitudEstado {
  const activos = estadosOrdenes.filter((s): s is Exclude<ImagingOrderStatusType, "CANCELLED"> => s !== "CANCELLED");
  if (activos.length === 0) return "anulado";
  const minRank = Math.min(...activos.map((s) => ORDER_STATUS_RANK[s]));
  return RANK_TO_ESTADO[minRank]!;
}
