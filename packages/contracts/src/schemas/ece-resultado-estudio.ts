/**
 * Schemas Zod — Resultado de Estudio ECE (Doc 18 NTEC).
 *
 * El resultado solo puede registrarse si la solicitud está en estado
 * 'firmado' o 'validado'. El médico aprueba el resultado.
 */
import { z } from "zod";

/** Input para registrar un resultado (técnico / profesional de diagnóstico) */
export const eceResultadoEstudioRegistrarSchema = z.object({
  solicitudId: z.string().uuid(),
  /** Resultado textual o estructurado */
  resultado: z.string().min(1).max(10000),
  interpretacion: z.string().max(4000).optional(),
  /** URI del archivo adjunto en storage externo (PDF, imagen, etc.) */
  adjuntoUri: z.string().url().max(2000).optional(),
});
export type EceResultadoEstudioRegistrarInput = z.infer<typeof eceResultadoEstudioRegistrarSchema>;

/** Input para aprobar resultado (médico valida clínicamente) */
export const eceResultadoEstudioAprobarSchema = z.object({
  resultadoId: z.string().uuid(),
  comentarioMedico: z.string().max(2000).optional(),
});
export type EceResultadoEstudioAprobarInput = z.infer<typeof eceResultadoEstudioAprobarSchema>;

/** Input list — filtra por solicitud */
export const eceResultadoEstudioListSchema = z.object({
  solicitudId: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type EceResultadoEstudioListInput = z.infer<typeof eceResultadoEstudioListSchema>;
