/**
 * Schemas locales para hoja-ingreso.router.ts.
 *
 * Definidos inline (mismo patrón que schemas.ts para consentimiento) para
 * evitar problemas de resolución de symlink en el worktree.
 * Fuente canónica: packages/contracts/src/schemas/ece-hoja-ingreso.ts
 */
import { z } from "zod";

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

export const eceHojaIngresoCreateSchema = z.object({
  ordenIngresoId: z.string().uuid(),
  fechaHoraIngreso: z.coerce.date(),
  servicioIngresoId: z.string().uuid(),
  camaAsignadaId: z.string().uuid().optional(),
  modalidad: modalidadIngresoSchema,
  procedencia: z.string().min(1).max(500),
  diagnosticoIngreso: z.string().min(1).max(2000).optional(),
  motivoConsulta: z.string().min(1).max(2000).optional(),
  notasAdicionales: z.string().max(2000).optional(),
});

export type EceHojaIngresoCreateInput = z.infer<typeof eceHojaIngresoCreateSchema>;

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

export const eceHojaIngresoListSchema = z.object({
  pacienteId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  servicioId: z.string().uuid().optional(),
  estado: estadoHojaIngresoSchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type EceHojaIngresoListInput = z.infer<typeof eceHojaIngresoListSchema>;

export const eceHojaIngresoGetSchema = z.object({ id: z.string().uuid() });
export type EceHojaIngresoGetInput = z.infer<typeof eceHojaIngresoGetSchema>;

export const eceHojaIngresoFirmarSchema = z.object({
  id: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
  contexto: z.string().max(500).optional(),
});

export type EceHojaIngresoFirmarInput = z.infer<typeof eceHojaIngresoFirmarSchema>;

export const eceHojaIngresoValidarSchema = z.object({
  id: z.string().uuid(),
  observacion: z.string().max(1000).optional(),
});

export type EceHojaIngresoValidarInput = z.infer<typeof eceHojaIngresoValidarSchema>;

export const eceHojaIngresoAnularSchema = z.object({
  id: z.string().uuid(),
  motivoAnulacion: z.string().min(5).max(1000),
});

export type EceHojaIngresoAnularInput = z.infer<typeof eceHojaIngresoAnularSchema>;

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
