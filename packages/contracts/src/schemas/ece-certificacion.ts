/**
 * Schemas Zod — Certificación DIR (Art. 21 NTEC).
 *
 * Solo el rol DIR puede certificar copias formales de:
 *   FICHA_ID, EPICRISIS, CERT_DEF.
 *
 * Tabla operada: ece.documento_instancia (raw SQL, schema ece).
 */
import { z } from "zod";

// PIN de firma: 6-8 dígitos numéricos (mismo contrato que firma-electronica.ts)
const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{6,8}$/, { message: "El PIN debe tener entre 6 y 8 dígitos." });

// ---------------------------------------------------------------------------
// listColaCertificacion
// ---------------------------------------------------------------------------

export const listColaCertificacionInput = z.object({
  /** Si true, devuelve documentos ya certificados (histórico). Default false. */
  incluirCertificados: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

export type ListColaCertificacionInput = z.infer<typeof listColaCertificacionInput>;

export const documentoEnColaSchema = z.object({
  id: z.string().uuid(),
  tipoDocumentoCodigo: z.string(),
  tipoDocumentoNombre: z.string(),
  pacienteId: z.string().uuid(),
  pacienteNombre: z.string(),
  estadoCodigo: z.string(),
  estadoNombre: z.string(),
  version: z.number().int(),
  validadoPor: z.string().uuid().nullable(),
  validadoPorNombre: z.string().nullable(),
  creadoEn: z.string().datetime(),
  ultimoCambioEn: z.string().datetime(),
});

export type DocumentoEnCola = z.infer<typeof documentoEnColaSchema>;

// ---------------------------------------------------------------------------
// certificar
// ---------------------------------------------------------------------------

export const certificarInput = z.object({
  instanciaId: z.string().uuid(),
  pin: pinSchema,
});

export type CertificarInput = z.infer<typeof certificarInput>;
