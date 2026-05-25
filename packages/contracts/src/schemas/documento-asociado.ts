import { z } from "zod";

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

export const CATEGORIA_DOC_ASOC = [
  "imagen_diagnostica",
  "laboratorio_externo",
  "referencia_externa",
  "consentimiento_externo",
  "otro",
] as const;

export type CategoriaDocAsoc = (typeof CATEGORIA_DOC_ASOC)[number];

/**
 * MIME types admitidos en el bucket ece-documentos-asociados.
 * Incluye: imágenes médicas comunes, PDFs y DICOM.
 */
export const MIME_TYPES_PERMITIDOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/dicom",
  "application/dicom",
  "application/octet-stream", // DICOM a veces llega sin tipo específico
] as const;

export type MimeTypePermitido = (typeof MIME_TYPES_PERMITIDOS)[number];

// ---------------------------------------------------------------------------
// Constantes de validación
// ---------------------------------------------------------------------------

const TAMANO_MAX_BYTES = 52_428_800; // 50 MB

// ---------------------------------------------------------------------------
// Schemas de input
// ---------------------------------------------------------------------------

/**
 * El cliente sube el archivo primero (vía URL firmada de `getUploadUrl`),
 * luego envía esta metadata para persistir la fila.
 */
export const documentoAsociadoCreateInput = z.object({
  pacienteId:      z.string().uuid(),
  episodioId:      z.string().uuid().optional(),
  categoria:       z.enum(CATEGORIA_DOC_ASOC),
  titulo:          z.string().min(3).max(255),
  descripcion:     z.string().max(1_000).optional(),
  fechaDocumento:  z.coerce.date().optional(), // default: hoy en BD
  // Metadata del archivo (registrada post-upload)
  storagePath:     z.string().min(1).max(1_000),
  mimeType:        z.enum(MIME_TYPES_PERMITIDOS),
  tamanoBytes:     z.number().int().min(1).max(TAMANO_MAX_BYTES, {
    message: "El archivo no puede superar 50 MB.",
  }),
  hashSha256:      z.string().length(64).regex(/^[0-9a-f]+$/, {
    message: "hashSha256 debe ser hex de 64 chars (SHA-256).",
  }),
});

export type DocumentoAsociadoCreateInput = z.infer<typeof documentoAsociadoCreateInput>;

export const documentoAsociadoFirmarInput = z.object({
  id:       z.string().uuid(),
  firmaPin: z.string().min(4).max(32),
});

export type DocumentoAsociadoFirmarInput = z.infer<typeof documentoAsociadoFirmarInput>;

export const documentoAsociadoAnularInput = z.object({
  id:               z.string().uuid(),
  motivoAnulacion:  z.string().min(10).max(1_000),
});

export type DocumentoAsociadoAnularInput = z.infer<typeof documentoAsociadoAnularInput>;

export const documentoAsociadoGetInput = z.object({
  id: z.string().uuid(),
});

export const documentoAsociadoListInput = z.object({
  pacienteId:  z.string().uuid().optional(),
  episodioId:  z.string().uuid().optional(),
  categoria:   z.enum(CATEGORIA_DOC_ASOC).optional(),
  page:        z.number().int().min(1).default(1),
  pageSize:    z.number().int().min(1).max(100).default(20),
});

export type DocumentoAsociadoListInput = z.infer<typeof documentoAsociadoListInput>;

/** Para obtener URL firmada de subida antes del upload. */
export const documentoAsociadoGetUploadUrlInput = z.object({
  fileName:  z.string().min(1).max(500),
  mimeType:  z.enum(MIME_TYPES_PERMITIDOS),
});

/** Para obtener URL firmada de descarga. */
export const documentoAsociadoGetDownloadUrlInput = z.object({
  id: z.string().uuid(),
});
