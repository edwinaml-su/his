/**
 * Schemas Zod — Consentimiento Informado ECE (Doc 9 NTEC, §3.9).
 *
 * La tabla `ece.consentimiento_informado` es INMUTABLE tras la firma del MC.
 * Correcciones requieren un nuevo consentimiento (nuevo registro).
 *
 * Tipos de consentimiento mapeados al CHECK constraint de la tabla:
 *   'hospitalizacion' | 'quirurgico' | 'anestesico' | 'otro'
 * (La tabla también acepta 'procedimiento' y 'transfusion', pero el brief
 * delimita el scope al subconjunto indicado; el resto se puede ampliar.)
 */
import { z } from "zod";

export const tipoConsentimientoSchema = z.enum([
  "hospitalizacion",
  "quirurgico",
  "anestesico",
  "otro",
]);

export type TipoConsentimiento = z.infer<typeof tipoConsentimientoSchema>;

/** Input de creación — borrador inicial, sin firma. */
export const eceConsentimientoCreateSchema = z.object({
  episodioId: z.string().uuid(),
  tipoConsentimiento: tipoConsentimientoSchema,
  procedimientoDescrito: z.string().min(1).max(4000),
  riesgos: z.string().max(4000).optional(),
  alternativas: z.string().max(4000).optional(),
  /** Datos del testigo opcional (nombre + documento de identidad). */
  datosTestigo: z
    .object({
      nombre: z.string().min(1).max(200),
      documento: z.string().min(1).max(50),
    })
    .optional(),
});

export type EceConsentimientoCreateInput = z.infer<
  typeof eceConsentimientoCreateSchema
>;

/** Input para registrar la firma del paciente / representante legal. */
export const eceConsentimientoFirmarPacienteSchema = z.object({
  consentimientoId: z.string().uuid(),
  /** 'paciente' o 'representante_legal' — mapea a firmante_rol de la tabla. */
  firmanteTipo: z.enum(["paciente", "representante_legal"]),
  firmanteNombre: z.string().min(1).max(200),
  firmanteDocumento: z.string().min(1).max(50),
  /**
   * URI del objeto de firma/imagen en storage externo.
   * Mapea a `evidencia_firma_ref` de la tabla.
   */
  firmaImagenUri: z.string().url().max(1000),
});

export type EceConsentimientoFirmarPacienteInput = z.infer<
  typeof eceConsentimientoFirmarPacienteSchema
>;

/** Input para que el MC firme con PIN electrónico. */
export const eceConsentimientoFirmarMcSchema = z.object({
  consentimientoId: z.string().uuid(),
  /** PIN de la firma electrónica del MC (validado con argon2 en ece.firma_electronica). */
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
  /** Contexto de auditoría libre (ej. nombre del procedimiento). */
  contexto: z.string().max(500).optional(),
});

export type EceConsentimientoFirmarMcInput = z.infer<
  typeof eceConsentimientoFirmarMcSchema
>;

/** Input para validación por DIR. */
export const eceConsentimientoValidarSchema = z.object({
  consentimientoId: z.string().uuid(),
  observacion: z.string().max(1000).optional(),
});

export type EceConsentimientoValidarInput = z.infer<
  typeof eceConsentimientoValidarSchema
>;
