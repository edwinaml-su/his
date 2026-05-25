/**
 * Schemas Zod — ECE Orden de Ingreso (ORD_ING).
 *
 * Documento NTEC: Art. 33 — La orden de ingreso es la decisión clínica del
 * médico que autoriza el internamiento del paciente. Debe preceder siempre a
 * la Hoja de Ingreso Hospitalario (HOJA_ING) que apertura la admisión formal.
 *
 * Constraints reales en ece.orden_ingreso (verificados 2026-05-24 vía MCP):
 *   modalidad         IN ('hospitalizacion','hospital_de_dia')
 *   motivo_ingreso_tipo IN ('cirugia','emergencia','hospitalizacion','obs','otro')
 *   procedencia       IN ('consulta_externa','emergencia','traslado_externo',
 *                          'traslado_interno','espontaneo','otro')
 *   estado_registro   IN ('vigente','rectificado')  ← vigencia del registro
 *   El estado del workflow vive en ece.documento_instancia.estado_actual_id.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enumeraciones — alineadas con CHECK constraints de BD
// ---------------------------------------------------------------------------

export const MODALIDAD_ING = [
  "hospitalizacion",
  "hospital_de_dia",
] as const;

export const MOTIVO_INGRESO_TIPO = [
  "cirugia",
  "emergencia",
  "hospitalizacion",
  "obs",
  "otro",
] as const;

export const PROCEDENCIA = [
  "consulta_externa",
  "emergencia",
  "traslado_externo",
  "traslado_interno",
  "espontaneo",
  "otro",
] as const;

export type ModalidadIng       = (typeof MODALIDAD_ING)[number];
export type MotivoIngresoTipo  = (typeof MOTIVO_INGRESO_TIPO)[number];
export type Procedencia        = (typeof PROCEDENCIA)[number];

// ---------------------------------------------------------------------------
// Schema de item diagnóstico (array JSONB)
// ---------------------------------------------------------------------------

export const diagnosticoIngresoItemSchema = z.object({
  cie10:       z.string().regex(/^[A-Z]\d{2}(\.\d{1,4})?$/, "Código CIE-10 inválido"),
  descripcion: z.string().min(3).max(500),
  principal:   z.boolean(),
});

export type DiagnosticoIngresoItem = z.infer<typeof diagnosticoIngresoItemSchema>;

// ---------------------------------------------------------------------------
// Create — campos editables al crear la orden (sin firmaPin)
// ---------------------------------------------------------------------------

export const ordenIngresoCreateInput = z.object({
  pacienteId:          z.string().uuid(),
  episodioOrigenId:    z.string().uuid().optional(), // episodio previo que origina el ingreso (urgencias, CX)
  modalidad:           z.enum(MODALIDAD_ING),
  motivoIngreso:       z.string().min(10).max(2_000),
  motivoIngresoTipo:   z.enum(MOTIVO_INGRESO_TIPO),
  procedencia:         z.enum(PROCEDENCIA),
  servicioIngresoId:   z.string().uuid().optional(),
  procedimientoCie10:  z.string().regex(/^[A-Z]\d{2}(\.\d{1,4})?$/, "Código CIE-10 inválido").optional(),
  diagnosticoIngreso:  z.array(diagnosticoIngresoItemSchema).min(1).max(20).optional(),
  medicoOrdena:        z.string().uuid(),
  fechaHoraOrden:      z.coerce.date(),
  circunstanciaIngreso: z.string().min(5).max(2_000),
  reservaSalaQxId:     z.string().uuid().optional(), // solo cuando motivoIngresoTipo = 'cirugia'
});

export type OrdenIngresoCreateInput = z.infer<typeof ordenIngresoCreateInput>;

// ---------------------------------------------------------------------------
// Firmar — requiere el id de la orden + PIN electrónico
// ---------------------------------------------------------------------------

export const ordenIngresoFirmarInput = z.object({
  id:       z.string().uuid(),
  firmaPin: z.string().min(4).max(32),
});

export type OrdenIngresoFirmarInput = z.infer<typeof ordenIngresoFirmarInput>;

// ---------------------------------------------------------------------------
// Anular — motivo obligatorio ≥ 10 chars
// ---------------------------------------------------------------------------

export const ordenIngresoAnularInput = z.object({
  id:               z.string().uuid(),
  motivoAnulacion:  z.string().min(10).max(1_000),
});

export type OrdenIngresoAnularInput = z.infer<typeof ordenIngresoAnularInput>;

// ---------------------------------------------------------------------------
// List — filtros opcionales con paginación
// ---------------------------------------------------------------------------

export const ordenIngresoListInput = z.object({
  episodioId:  z.string().uuid().optional(),
  pacienteId:  z.string().uuid().optional(),
  modalidad:   z.enum(MODALIDAD_ING).optional(),
  fechaDesde:  z.coerce.date().optional(),
  fechaHasta:  z.coerce.date().optional(),
  page:        z.number().int().min(1).default(1),
  pageSize:    z.number().int().min(1).max(100).default(20),
});

export type OrdenIngresoListInput = z.infer<typeof ordenIngresoListInput>;

// ---------------------------------------------------------------------------
// Get — por id
// ---------------------------------------------------------------------------

export const ordenIngresoGetInput = z.object({
  id: z.string().uuid(),
});

export type OrdenIngresoGetInput = z.infer<typeof ordenIngresoGetInput>;
