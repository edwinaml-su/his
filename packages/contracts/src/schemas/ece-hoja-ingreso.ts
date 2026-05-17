/**
 * Schemas Zod — Hoja de Ingreso Hospitalario (Doc 12 NTEC, §3.12).
 *
 * Workflow HOJA_ING:
 *   borrador → en_revision → firmado → validado → anulado
 *
 * Roles:
 *   ADM llena + firma (acción 'firmar', PIN electrónico).
 *   ARCH valida       (acción 'validar').
 *   DIR anula         (acción 'anular', cualquier estado pre-validado).
 *
 * Tabla física: ece.hoja_ingreso (schema ece, fuera del modelo Prisma).
 */
import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const MODALIDAD_INGRESO = ["urgente", "programado"] as const;
export type ModalidadIngreso = (typeof MODALIDAD_INGRESO)[number];

export const ESTADO_HOJA_INGRESO = [
  "borrador",
  "en_revision",
  "firmado",
  "validado",
  "anulado",
] as const;
export type EstadoHojaIngreso = (typeof ESTADO_HOJA_INGRESO)[number];

export const modalidadIngresoSchema = z.enum(MODALIDAD_INGRESO);
export const estadoHojaIngresoSchema = z.enum(ESTADO_HOJA_INGRESO);

// ─── Create ───────────────────────────────────────────────────────────────────

export const eceHojaIngresoCreateSchema = z.object({
  ordenIngresoId: z.string().uuid(),
  fechaHoraIngreso: z.coerce.date(),
  servicioIngresoId: z.string().uuid(),
  camaAsignadaId: z.string().uuid().optional(),
  modalidad: modalidadIngresoSchema,
  procedencia: z.string().min(1).max(500),
  /** Diagnóstico de ingreso libre (complementa el CIE-10 de la orden). */
  diagnosticoIngreso: z.string().min(1).max(2000).optional(),
  /** Motivo de consulta en palabras del paciente o del admisionista. */
  motivoConsulta: z.string().min(1).max(2000).optional(),
  notasAdicionales: z.string().max(2000).optional(),
});

export type EceHojaIngresoCreateInput = z.infer<typeof eceHojaIngresoCreateSchema>;

// ─── Update (solo borrador) ───────────────────────────────────────────────────

export const eceHojaIngresoUpdateSchema = z.object({
  id: z.string().uuid(),
  fechaHoraIngreso: z.coerce.date().optional(),
  servicioIngresoId: z.string().uuid().optional(),
  camaAsignadaId: z.string().uuid().nullable().optional(),
  modalidad: modalidadIngresoSchema.optional(),
  procedencia: z.string().min(1).max(500).optional(),
  diagnosticoIngreso: z.string().min(1).max(2000).optional(),
  motivoConsulta: z.string().min(1).max(2000).optional(),
  notasAdicionales: z.string().max(2000).optional(),
});

export type EceHojaIngresoUpdateInput = z.infer<typeof eceHojaIngresoUpdateSchema>;

// ─── List ─────────────────────────────────────────────────────────────────────

export const eceHojaIngresoListSchema = z.object({
  pacienteId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  servicioId: z.string().uuid().optional(),
  estado: estadoHojaIngresoSchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type EceHojaIngresoListInput = z.infer<typeof eceHojaIngresoListSchema>;

// ─── Get ──────────────────────────────────────────────────────────────────────

export const eceHojaIngresoGetSchema = z.object({
  id: z.string().uuid(),
});

export type EceHojaIngresoGetInput = z.infer<typeof eceHojaIngresoGetSchema>;

// ─── Firmar (ADM con PIN) ─────────────────────────────────────────────────────

export const eceHojaIngresoFirmarSchema = z.object({
  id: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
  contexto: z.string().max(500).optional(),
});

export type EceHojaIngresoFirmarInput = z.infer<typeof eceHojaIngresoFirmarSchema>;

// ─── Validar (ARCH) ───────────────────────────────────────────────────────────

export const eceHojaIngresoValidarSchema = z.object({
  id: z.string().uuid(),
  observacion: z.string().max(1000).optional(),
});

export type EceHojaIngresoValidarInput = z.infer<typeof eceHojaIngresoValidarSchema>;

// ─── Anular (DIR) ─────────────────────────────────────────────────────────────

export const eceHojaIngresoAnularSchema = z.object({
  id: z.string().uuid(),
  motivoAnulacion: z.string().min(5).max(1000),
});

export type EceHojaIngresoAnularInput = z.infer<typeof eceHojaIngresoAnularSchema>;

// ─── Row type (raw SQL) ───────────────────────────────────────────────────────

export interface HojaIngresoRow {
  id: string;
  instancia_id: string;
  paciente_id: string;
  episodio_hospitalario_id: string | null;
  orden_ingreso_id: string;
  fecha_hora_ingreso: Date;
  servicio_ingreso_id: string;
  cama_asignada_id: string | null;
  modalidad: ModalidadIngreso;
  procedencia: string;
  diagnostico_ingreso: string | null;
  motivo_consulta: string | null;
  notas_adicionales: string | null;
  admisionista_id: string;
  estado_codigo: EstadoHojaIngreso;
  estado_id: string;
  creado_en: Date;
}
