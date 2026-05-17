/**
 * Schemas Zod — Proceso F GS1: Logística inversa / Devoluciones de inventario.
 *
 * Ciclo de vida:
 *   solicitado → autorizado (rol ARCH o admin)
 *   autorizado → en_transito (registrar despacho)
 *   en_transito → recibido | rechazado (registrar recepción)
 *
 * Eventos de dominio emitidos:
 *   gs1.devolucion.solicitada
 *   gs1.devolucion.autorizada
 *   gs1.devolucion.recibida
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const motivoDevolucionSchema = z.enum([
  "vencido",
  "defectuoso",
  "recall",
  "exceso",
  "no_administrado",
]);
export type MotivoDevolucion = z.infer<typeof motivoDevolucionSchema>;

export const estadoDevolucionSchema = z.enum([
  "solicitado",
  "autorizado",
  "en_transito",
  "recibido",
  "rechazado",
]);
export type EstadoDevolucion = z.infer<typeof estadoDevolucionSchema>;

// ---------------------------------------------------------------------------
// ProductoDevolucion — elemento del array JSONB `productos`
// ---------------------------------------------------------------------------

export const productoDevolucionSchema = z.object({
  /** GTIN-14 del producto (GS1 Healthcare). */
  gtin: z
    .string()
    .trim()
    .min(8)
    .max(14)
    .regex(/^\d+$/, "GTIN debe contener solo dígitos"),
  /** Número de lote del fabricante. */
  lote: z.string().trim().min(1).max(80),
  /** Cantidad a devolver (unidades de medida base). */
  cantidad: z.number().int().positive("La cantidad debe ser mayor a cero"),
});
export type ProductoDevolucion = z.infer<typeof productoDevolucionSchema>;

// ---------------------------------------------------------------------------
// Inputs de procedimientos
// ---------------------------------------------------------------------------

export const gs1DevolucionSolicitarSchema = z.object({
  origenGln: z
    .string()
    .trim()
    .min(4)
    .max(13)
    .regex(/^\d+$/, "GLN debe contener solo dígitos"),
  destinoGln: z
    .string()
    .trim()
    .min(4)
    .max(13)
    .regex(/^\d+$/, "GLN debe contener solo dígitos"),
  motivo: motivoDevolucionSchema,
  /** Mínimo 1 producto por solicitud. */
  productos: z
    .array(productoDevolucionSchema)
    .min(1, "Debe incluir al menos un producto"),
  fechaDevolucion: z.coerce.date().optional(),
  notas: z.string().trim().max(1000).optional(),
});
export type Gs1DevolucionSolicitarInput = z.infer<typeof gs1DevolucionSolicitarSchema>;

export const gs1DevolucionAutorizarSchema = z.object({
  devolucionId: z.string().uuid(),
  /** Observación opcional al autorizar o rechazar. */
  notas: z.string().trim().max(1000).optional(),
});
export type Gs1DevolucionAutorizarInput = z.infer<typeof gs1DevolucionAutorizarSchema>;

export const gs1DevolucionRecepcionSchema = z.object({
  devolucionId: z.string().uuid(),
  /** true = recibido conforme; false = rechazado (con motivo en notas). */
  recibidoConforme: z.boolean(),
  notas: z.string().trim().max(1000).optional(),
});
export type Gs1DevolucionRecepcionInput = z.infer<typeof gs1DevolucionRecepcionSchema>;

export const gs1DevolucionListSchema = z.object({
  estado: estadoDevolucionSchema.optional(),
  motivo: motivoDevolucionSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type Gs1DevolucionListInput = z.infer<typeof gs1DevolucionListSchema>;

export const gs1DevolucionGetSchema = z.object({
  id: z.string().uuid(),
});
export type Gs1DevolucionGetInput = z.infer<typeof gs1DevolucionGetSchema>;
