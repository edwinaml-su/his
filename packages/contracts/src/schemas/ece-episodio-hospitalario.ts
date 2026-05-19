/**
 * §ECE — Episodio Hospitalario: schemas Zod de input/output.
 *
 * Complementa ece-episodio.ts (apertura/transición genérica).
 * Este módulo cubre el ciclo hospitalario especializado:
 *   - listActivos   → tablero de episodios en curso
 *   - getDetalle    → cabecera enriquecida (paciente + cama + médico + docs)
 *   - iniciarAlta   → crea borrador de epicrisis y cambia a estado "alta_iniciada"
 *   - confirmarAlta → cierra episodio y libera cama
 */
import { z } from "zod";

// ─── Enums de dominio ────────────────────────────────────────────────────────

// NOTA HD-08: GravedadEpisodio eliminado de queries BD — columna no existe en
// ece.episodio_hospitalario. Se conserva el tipo/enum para uso en UI y futuras
// migraciones DDL que @AE debe evaluar.
export const GRAVEDAD_ENUM = ["leve", "moderado", "grave", "critico"] as const;
export type GravedadEpisodio = (typeof GRAVEDAD_ENUM)[number];
export const gravedadEnum = z.enum(GRAVEDAD_ENUM);

export const MOTIVO_ALTA_ENUM = [
  "mejoria",
  "traslado",
  "alta_voluntaria",
  "defuncion",
] as const;
export type MotivoAlta = (typeof MOTIVO_ALTA_ENUM)[number];
export const motivoAltaEnum = z.enum(MOTIVO_ALTA_ENUM);

// ─── listActivos ─────────────────────────────────────────────────────────────

export const listActivosInput = z.object({
  servicioId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  // gravedad eliminado (HD-08): columna no existe en ece.episodio_hospitalario BD.
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});
export type ListActivosInput = z.infer<typeof listActivosInput>;

// ─── getDetalle ───────────────────────────────────────────────────────────────

export const getDetalleInput = z.object({
  id: z.string().uuid(),
});
export type GetDetalleInput = z.infer<typeof getDetalleInput>;

// ─── iniciarAltaMedica ────────────────────────────────────────────────────────

export const iniciarAltaMedicaInput = z.object({
  episodioId: z.string().uuid(),
  medicoAltaId: z.string().uuid(),
  fechaHoraAlta: z.coerce.date(),
  motivoAlta: motivoAltaEnum,
  instruccionesAlta: z.string().trim().min(1).max(5000),
});
export type IniciarAltaMedicaInput = z.infer<typeof iniciarAltaMedicaInput>;

// ─── confirmarAlta ────────────────────────────────────────────────────────────

export const confirmarAltaInput = z.object({
  episodioId: z.string().uuid(),
  epicrisisId: z.string().uuid(),
});
export type ConfirmarAltaInput = z.infer<typeof confirmarAltaInput>;

// ─── Tipos de fila raw (respuestas SQL) ───────────────────────────────────────

export interface EpisodioActivoRow {
  id: string;
  episodio_atencion_id: string;   // alias SQL de eh.episodio_id (FK → episodio_atencion)
  paciente_id: string;
  paciente_nombre: string;
  sala_id: string;                // alias SQL de eh.servicio_id
  sala_nombre: string | null;
  cama_id: string | null;
  cama_codigo: string | null;
  fecha_ingreso: Date;            // alias SQL de eh.fecha_hora_orden_ingreso
  estado: string;
  // gravedad eliminado (HD-08): columna ausente en ece.episodio_hospitalario BD.
  // medico_tratante_id eliminado (HD-08): columna ausente en BD.
  medico_nombre: string | null;
}

export interface EpisodioDetalleRow extends EpisodioActivoRow {
  motivo_ingreso: string;
  orden_ingreso_id: string;
  documentos_firmados_count: number;
}
