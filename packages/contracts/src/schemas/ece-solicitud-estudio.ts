/**
 * Schemas Zod — Solicitud de Estudio ECE (Doc 18 NTEC).
 *
 * Workflow SOL_EST:
 *   borrador → en_revision → firmado → validado
 *
 * MC firma (borrador → firmado). MC valida (firmado → validado).
 * Anulación: permitida desde cualquier estado pre-validado (rol MC o DIR).
 */
import { z } from "zod";

export const tipoEstudioSchema = z.enum(["laboratorio", "imagenologia", "otro"]);
export type TipoEstudio = z.infer<typeof tipoEstudioSchema>;

export const prioridadEstudioSchema = z.enum(["rutina", "urgente", "stat"]);
export type PrioridadEstudio = z.infer<typeof prioridadEstudioSchema>;

/** Input de creación — genera borrador */
export const eceSolicitudEstudioCreateSchema = z.object({
  episodioId: z.string().uuid(),
  tipo: tipoEstudioSchema,
  /** Códigos de estudios solicitados, ej. LOINC o código interno del catálogo. */
  estudiosSolicitados: z.array(z.string().min(1).max(100)).min(1).max(50),
  prioridad: prioridadEstudioSchema.default("rutina"),
  observacionesClinicas: z.string().max(4000).optional(),
});
export type EceSolicitudEstudioCreateInput = z.infer<typeof eceSolicitudEstudioCreateSchema>;

/** Input para firmar (MC) — avanza borrador → firmado */
export const eceSolicitudEstudioFirmarSchema = z.object({
  solicitudId: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
});
export type EceSolicitudEstudioFirmarInput = z.infer<typeof eceSolicitudEstudioFirmarSchema>;

/** Input para validar (MC confirma clínicamente) — firmado → validado */
export const eceSolicitudEstudioValidarSchema = z.object({
  solicitudId: z.string().uuid(),
  observacion: z.string().max(1000).optional(),
});
export type EceSolicitudEstudioValidarInput = z.infer<typeof eceSolicitudEstudioValidarSchema>;

/** Input para anular */
export const eceSolicitudEstudioAnularSchema = z.object({
  solicitudId: z.string().uuid(),
  motivo: z.string().min(1).max(1000),
});
export type EceSolicitudEstudioAnularInput = z.infer<typeof eceSolicitudEstudioAnularSchema>;

/** Input list */
export const eceSolicitudEstudioListSchema = z.object({
  episodioId: z.string().uuid().optional(),
  /** Filtrar por estado del workflow */
  estadoCodigo: z.string().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type EceSolicitudEstudioListInput = z.infer<typeof eceSolicitudEstudioListSchema>;
