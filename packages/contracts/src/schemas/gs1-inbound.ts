import { z } from "zod";

// ---------------------------------------------------------------------------
// Producto escaneado en muelle: un ítem dentro del JSONB `productos`
// ---------------------------------------------------------------------------
export const gs1ProductoRecibidoSchema = z.object({
  gtin: z.string().min(14).max(14).regex(/^\d+$/, "GTIN debe ser 14 dígitos"),
  cantidad: z.number().int().positive(),
  lote: z.string().min(1).max(50),
  expiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD")
    .refine((d) => new Date(d) > new Date(), "Producto ya vencido"),
});

export type Gs1ProductoRecibido = z.infer<typeof gs1ProductoRecibidoSchema>;

// ---------------------------------------------------------------------------
// Verificación de los 5 correctos (adaptada a logística de muelle)
// ---------------------------------------------------------------------------
export const verificacion5CorrectosSchema = z.object({
  /** Siempre true en muelle — no aplica paciente */
  paciente_n_a: z.literal(true),
  /** Operador confirma que el medicamento/insumo coincide con el DESADV */
  medicamento_verif: z.boolean(),
  /** Siempre true en muelle */
  dosis_n_a: z.literal(true),
  /** Siempre true en muelle */
  via_n_a: z.literal(true),
  /** Siempre true en muelle */
  hora_n_a: z.literal(true),
});

export type Verificacion5Correctos = z.infer<typeof verificacion5CorrectosSchema>;

// ---------------------------------------------------------------------------
// Input: recibirMercancia
// ---------------------------------------------------------------------------
export const recibirMercanciaInput = z.object({
  numero_documento_recepcion: z.string().min(1).max(100),
  fecha: z.string().datetime().optional(),
  proveedor_gln: z
    .string()
    .length(13)
    .regex(/^\d+$/, "GLN debe ser 13 dígitos"),
  sscc_pallet: z.string().optional(),
  productos: z.array(gs1ProductoRecibidoSchema).min(1),
  verificacion_5correctos: verificacion5CorrectosSchema,
  establecimiento_id: z.string().uuid(),
  registrado_por: z.string().uuid(),
});

export type RecibirMercanciaInput = z.infer<typeof recibirMercanciaInput>;

// ---------------------------------------------------------------------------
// Input: verificar5Correctos — confirma la verificación sobre un doc existente
// ---------------------------------------------------------------------------
export const verificar5CorrectosInput = z.object({
  recepcionId: z.string().uuid(),
  verificacion_5correctos: verificacion5CorrectosSchema,
});

export type Verificar5CorrectosInput = z.infer<typeof verificar5CorrectosInput>;

// ---------------------------------------------------------------------------
// Input: rechazar
// ---------------------------------------------------------------------------
export const rechazarRecepcionInput = z.object({
  recepcionId: z.string().uuid(),
  motivo_rechazo: z.string().min(5).max(500),
});

export type RechazarRecepcionInput = z.infer<typeof rechazarRecepcionInput>;

// ---------------------------------------------------------------------------
// Input: listar recepciones
// ---------------------------------------------------------------------------
export const listarRecepcionesInput = z.object({
  establecimiento_id: z.string().uuid(),
  estado: z.enum(["pendiente", "verificado", "rechazado"]).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type ListarRecepcionesInput = z.infer<typeof listarRecepcionesInput>;
