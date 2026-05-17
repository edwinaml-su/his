/**
 * §ECE Episodio — schemas Zod de input.
 *
 * Estados válidos: abierto | en_curso | cerrado | cancelado
 * Transiciones permitidas: abierto→en_curso, en_curso→cerrado
 * cancelado es estado terminal (no se puede transicionar desde él).
 */
import { z } from "zod";

export const EPISODIO_ESTADO = ["abierto", "en_curso", "cerrado", "cancelado"] as const;
export type EpisodioEstado = (typeof EPISODIO_ESTADO)[number];

export const episodioEstadoEnum = z.enum(EPISODIO_ESTADO);

// ─── list ─────────────────────────────────────────────────────────────────────

export const listAmbulatoriasInput = z.object({
  pacienteId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  estado: episodioEstadoEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

export const listHospitalariasInput = z.object({
  salaId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

// ─── get ──────────────────────────────────────────────────────────────────────

export const getEpisodioInput = z.object({
  id: z.string().uuid(),
});

// ─── crear ────────────────────────────────────────────────────────────────────

export const crearAmbulatorioInput = z.object({
  pacienteId: z.string().uuid(),
  motivoConsulta: z.string().trim().min(1).max(1000),
  /** Vincula con HIS Encounter existente (opcional). */
  encounterId: z.string().uuid().optional(),
  fechaApertura: z.coerce.date().optional(),
});

export const crearHospitalarioInput = z.object({
  pacienteId: z.string().uuid(),
  ordenIngresoId: z.string().uuid(),
  camaId: z.string().uuid(),
  salaId: z.string().uuid(),
  motivoIngreso: z.string().trim().min(1).max(1000),
  fechaIngreso: z.coerce.date().optional(),
});

// ─── transicionar ─────────────────────────────────────────────────────────────

export const transicionarInput = z.object({
  episodioId: z.string().uuid(),
  nuevoEstado: z.enum(["en_curso", "cerrado"]),
  observacion: z.string().trim().max(1000).optional(),
});

// ─── cama ─────────────────────────────────────────────────────────────────────

export const asignarCamaInput = z.object({
  episodioHospitalarioId: z.string().uuid(),
  camaId: z.string().uuid(),
  fechaAsignacion: z.coerce.date(),
});

export const liberarCamaInput = z.object({
  asignacionId: z.string().uuid(),
  fechaLiberacion: z.coerce.date(),
});

// ─── Tipos inferidos ──────────────────────────────────────────────────────────

export type ListAmbulatoriasInput = z.infer<typeof listAmbulatoriasInput>;
export type ListHospitalariasInput = z.infer<typeof listHospitalariasInput>;
export type GetEpisodioInput = z.infer<typeof getEpisodioInput>;
export type CrearAmbulatorioInput = z.infer<typeof crearAmbulatorioInput>;
export type CrearHospitalarioInput = z.infer<typeof crearHospitalarioInput>;
export type TransicionarInput = z.infer<typeof transicionarInput>;
export type AsignarCamaInput = z.infer<typeof asignarCamaInput>;
export type LiberarCamaInput = z.infer<typeof liberarCamaInput>;
