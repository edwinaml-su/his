import { z } from "zod";

/**
 * Schemas Zod — Bridge ECE↔HIS Encounter (Fase 2, Stream 22b).
 *
 * Cubre las cuatro operaciones del bridge:
 *   - linkEncounter   : vincula episodio ECE existente a Encounter HIS
 *   - unlinkEncounter : elimina el vínculo (set NULL)
 *   - createEpisodioFromEncounter : crea episodio ECE a partir de Encounter HIS
 *   - listEncountersWithoutEpisodio : paginación de Encounters sin episodio
 */

export const linkEncounterSchema = z.object({
  encounterId: z.string().uuid(),
  episodioId: z.string().uuid(),
});

export type LinkEncounterInput = z.infer<typeof linkEncounterSchema>;

export const unlinkEncounterSchema = z.object({
  episodioId: z.string().uuid(),
});

export type UnlinkEncounterInput = z.infer<typeof unlinkEncounterSchema>;

/**
 * modalidad y servicio_categoria son requeridos para la creación de un episodio
 * ECE válido (Art. 16, 17 NTEC). El caller decide su valor basado en el
 * contexto clínico del Encounter HIS (ambulatorio vs hospitalario).
 */
export const createEpisodioFromEncounterSchema = z.object({
  encounterId: z.string().uuid(),
  modalidad: z.enum(["ambulatorio", "hospitalario"]),
  servicio_categoria: z.enum([
    "consulta_externa",
    "emergencia",
    "hospitalizacion",
    "hospital_de_dia",
  ]),
  establecimientoEceId: z.string().uuid(),
  origen_consulta: z
    .enum(["espontanea", "cita_previa", "referencia"])
    .optional(),
  motivo: z.string().max(500).optional(),
});

export type CreateEpisodioFromEncounterInput = z.infer<
  typeof createEpisodioFromEncounterSchema
>;

export const listEncountersWithoutEpisodioSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListEncountersWithoutEpisodioInput = z.infer<
  typeof listEncountersWithoutEpisodioSchema
>;
