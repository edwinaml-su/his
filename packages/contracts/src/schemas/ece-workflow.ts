/**
 * Schemas Zod del motor de workflow ECE.
 *
 * Tablas: ece.tipo_documento, ece.flujo_estado, ece.flujo_transicion, ece.documento_rol.
 * Spec: docs/backlog/fase2/_insumos/05_motor_workflow.sql
 *
 * Exporta schemas de input y tipos de fila resultado (raw SQL).
 */
import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const TIPO_REGISTRO = ["maestro", "transaccional", "historico"] as const;
export const MODALIDAD = ["ambulatorio", "hospitalario", "ambos"] as const;
export const FUNCION_VALUES = ["LLENA", "RESPONSABLE", "AUTORIZA", "FIRMA"] as const;

export const tipoRegistroEnum = z.enum(TIPO_REGISTRO);
export const modalidadEnum = z.enum(MODALIDAD);
export const funcionEnum = z.enum(FUNCION_VALUES);

export type TipoRegistro = (typeof TIPO_REGISTRO)[number];
export type Modalidad = (typeof MODALIDAD)[number];
export type Funcion = (typeof FUNCION_VALUES)[number];

// ─── tipo_documento ───────────────────────────────────────────────────────────

export const tipoDocCreateSchema = z.object({
  codigo: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "Solo minúsculas, dígitos y guión bajo; debe iniciar con letra."),
  nombre: z.string().min(2).max(255),
  tablaDatos: z
    .string()
    .min(2)
    .max(128)
    .regex(/^[a-z][a-z0-9_]*$/, "Solo minúsculas, dígitos y guión bajo."),
  tipoRegistro: tipoRegistroEnum,
  modalidad: modalidadEnum,
  dependeDe: z.array(z.string().min(2).max(64)).optional(),
  inmutable: z.boolean().optional(),
});

export const tipoDocUpdateSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string().min(2).max(255).optional(),
  tablaDatos: z
    .string()
    .min(2)
    .max(128)
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
  tipoRegistro: tipoRegistroEnum.optional(),
  modalidad: modalidadEnum.optional(),
  dependeDe: z.array(z.string().min(2).max(64)).optional(),
  inmutable: z.boolean().optional(),
});

export const tipoDocListSchema = z.object({
  soloActivos: z.boolean().optional(),
  modalidad: modalidadEnum.optional(),
  tipoRegistro: tipoRegistroEnum.optional(),
});

export type TipoDocCreateInput = z.infer<typeof tipoDocCreateSchema>;
export type TipoDocUpdateInput = z.infer<typeof tipoDocUpdateSchema>;
export type TipoDocListInput = z.infer<typeof tipoDocListSchema>;

// ─── flujo_estado ─────────────────────────────────────────────────────────────

export const estadoListSchema = z.object({
  tipDocumentoId: z.string().uuid(),
});

export const estadoCreateSchema = z.object({
  tipDocumentoId: z.string().uuid(),
  codigo: z.string().trim().min(1).max(64),
  nombre: z.string().trim().min(1).max(255),
  esInicial: z.boolean().default(false),
  esFinal: z.boolean().default(false),
  orden: z.number().int().min(0).default(0),
});

export const estadoUpdateSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string().trim().min(1).max(255).optional(),
  esInicial: z.boolean().optional(),
  esFinal: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
});

export const estadoDeleteSchema = z.object({ id: z.string().uuid() });

export type EstadoListInput = z.infer<typeof estadoListSchema>;
export type EstadoCreateInput = z.infer<typeof estadoCreateSchema>;
export type EstadoUpdateInput = z.infer<typeof estadoUpdateSchema>;

// ─── flujo_transicion ─────────────────────────────────────────────────────────

export const transicionListSchema = z.object({
  tipDocumentoId: z.string().uuid(),
});

export const transicionCreateSchema = z.object({
  tipDocumentoId: z.string().uuid(),
  estadoOrigenId: z.string().uuid(),
  estadoDestinoId: z.string().uuid(),
  accion: z.string().trim().min(1).max(64),
  rolAutorizaId: z.string().uuid(),
  requiereFirma: z.boolean().default(true),
});

export const transicionUpdateSchema = z.object({
  id: z.string().uuid(),
  estadoDestinoId: z.string().uuid().optional(),
  rolAutorizaId: z.string().uuid().optional(),
  requiereFirma: z.boolean().optional(),
});

export const transicionDeleteSchema = z.object({ id: z.string().uuid() });

export type TransicionListInput = z.infer<typeof transicionListSchema>;
export type TransicionCreateInput = z.infer<typeof transicionCreateSchema>;
export type TransicionUpdateInput = z.infer<typeof transicionUpdateSchema>;

// ─── documento_rol ────────────────────────────────────────────────────────────

export const rolListSchema = z.object({
  tipDocumentoId: z.string().uuid(),
});

export const rolAssignSchema = z.object({
  tipDocumentoId: z.string().uuid(),
  rolId: z.string().uuid(),
  funcion: funcionEnum,
  obligatorio: z.boolean().default(true),
});

export const rolRevokeSchema = z.object({
  tipDocumentoId: z.string().uuid(),
  rolId: z.string().uuid(),
  funcion: funcionEnum,
});

export type RolListInput = z.infer<typeof rolListSchema>;
export type RolAssignInput = z.infer<typeof rolAssignSchema>;
export type RolRevokeInput = z.infer<typeof rolRevokeSchema>;

// ─── Row types (SQL raw) ──────────────────────────────────────────────────────

export interface TipoDocRow {
  id: string;
  codigo: string;
  nombre: string;
  tabla_datos: string;
  tipo_registro: string;
  modalidad: string;
  depende_de: string[] | null;
  inmutable: boolean;
  activo: boolean;
}

export interface FlujoEstadoRow {
  id: string;
  tipo_documento_id: string;
  codigo: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
}

export interface FlujoTransicionRow {
  id: string;
  tipo_documento_id: string;
  estado_origen_id: string;
  estado_destino_id: string;
  accion: string;
  rol_autoriza_id: string;
  requiere_firma: boolean;
  rol_codigo?: string;
  rol_nombre?: string;
}

export interface DocumentoRolRow {
  id: string;
  tipo_documento_id: string;
  rol_id: string;
  funcion: Funcion;
  obligatorio: boolean;
  rol_codigo?: string;
  rol_nombre?: string;
}
