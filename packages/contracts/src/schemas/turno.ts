import { z } from "zod";

/**
 * Turnos 24/7 — CC-0036 Ola 1A (Bloque C de REQ-HIS-AFIL-001).
 * PlantillaTurno / ProgramacionTurno / AsignacionTurno + fn_medico_de_turno
 * (sql/243_cc0036_turnos.sql). US.AFIL.1.9, US.AFIL.1.10, US.AFIL.1.11.
 */

export const plantillaTurnoTipoEnum = z.enum(["MEDICO_GENERAL", "ENFERMERIA", "APOYO"]);

export const programacionTurnoEstadoEnum = z.enum(["BORRADOR", "PUBLICADA", "CERRADA"]);

export const asignacionTurnoEstadoEnum = z.enum([
  "PROGRAMADO",
  "CONFIRMADO",
  "EN_CURSO",
  "CUMPLIDO",
  "AUSENTE",
  "SUSTITUIDO",
]);

/** "HH:MM" o "HH:MM:SS" — hora local America/El_Salvador, sin offset (NFR-6). */
const horaSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Formato de hora inválido (HH:MM).");

// ---------------------------------------------------------------------------
// PlantillaTurno
// ---------------------------------------------------------------------------

export const plantillaTurnoListSchema = z
  .object({
    establishmentId: z.string().uuid().optional(),
    tipo: plantillaTurnoTipoEnum.optional(),
    activeOnly: z.boolean().optional(),
  })
  .optional();

export const plantillaTurnoCreateSchema = z.object({
  establishmentId: z.string().uuid(),
  serviceUnitId: z.string().uuid().optional(),
  codigo: z.string().trim().min(1).max(40),
  nombre: z.string().trim().min(1).max(120),
  horaInicio: horaSchema,
  horaFin: horaSchema,
  tipo: plantillaTurnoTipoEnum,
  dotacionRequerida: z.number().int().positive().default(1),
});

export const plantillaTurnoUpdateSchema = z.object({
  id: z.string().uuid(),
  serviceUnitId: z.string().uuid().nullable().optional(),
  nombre: z.string().trim().min(1).max(120).optional(),
  horaInicio: horaSchema.optional(),
  horaFin: horaSchema.optional(),
  dotacionRequerida: z.number().int().positive().optional(),
});

export const plantillaTurnoSetActiveSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

export const plantillaTurnoCoberturaSchema = z.object({
  establishmentId: z.string().uuid(),
  tipo: plantillaTurnoTipoEnum,
});

// ---------------------------------------------------------------------------
// ProgramacionTurno
// ---------------------------------------------------------------------------

export const programacionTurnoListSchema = z.object({
  establishmentId: z.string().uuid().optional(),
  estado: programacionTurnoEstadoEnum.optional(),
});

export const programacionTurnoGetSchema = z.object({ id: z.string().uuid() });

export const programacionTurnoCreateSchema = z
  .object({
    establishmentId: z.string().uuid(),
    periodoDesde: z.string().date(),
    periodoHasta: z.string().date(),
  })
  .refine((v) => v.periodoHasta >= v.periodoDesde, {
    message: "periodoHasta debe ser posterior o igual a periodoDesde.",
    path: ["periodoHasta"],
  });

export const programacionTurnoPublicarSchema = z.object({
  id: z.string().uuid(),
  /** Requerido solo si hay turnos por debajo de dotacionRequerida (turno:autorizar_descubierto). */
  autorizaDescubiertoMotivo: z.string().trim().min(1).max(300).optional(),
});

export const programacionTurnoCerrarSchema = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// AsignacionTurno
// ---------------------------------------------------------------------------

export const asignacionTurnoListSchema = z.object({
  programacionId: z.string().uuid(),
});

export const asignacionTurnoAsignarSchema = z.object({
  programacionId: z.string().uuid(),
  plantillaTurnoId: z.string().uuid(),
  userId: z.string().uuid(),
  fecha: z.string().date(),
  /** US.AFIL.1.10.3 — obligatoria si la asignación deja al usuario con >24h continuas. */
  justificacion24h: z.string().trim().min(1).max(300).optional(),
});

export const asignacionTurnoQuitarSchema = z.object({ id: z.string().uuid() });

export const asignacionTurnoSustituirSchema = z.object({
  id: z.string().uuid(),
  sustitutoUserId: z.string().uuid(),
  motivo: z.string().trim().min(1).max(300),
});

export const asignacionTurnoMarcarInicioSchema = z.object({ id: z.string().uuid() });
export const asignacionTurnoMarcarFinSchema = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// fn_medico_de_turno
// ---------------------------------------------------------------------------

export const medicoDeTurnoSchema = z.object({
  establishmentId: z.string().uuid(),
  /** ISO datetime; por defecto `now()` en el server (STABLE, sin input = ambigüedad de reloj cliente). */
  at: z.string().datetime().optional(),
});

export type PlantillaTurnoListInput = z.infer<typeof plantillaTurnoListSchema>;
export type PlantillaTurnoCreateInput = z.infer<typeof plantillaTurnoCreateSchema>;
export type PlantillaTurnoUpdateInput = z.infer<typeof plantillaTurnoUpdateSchema>;
export type PlantillaTurnoSetActiveInput = z.infer<typeof plantillaTurnoSetActiveSchema>;
export type ProgramacionTurnoListInput = z.infer<typeof programacionTurnoListSchema>;
export type ProgramacionTurnoCreateInput = z.infer<typeof programacionTurnoCreateSchema>;
export type ProgramacionTurnoPublicarInput = z.infer<typeof programacionTurnoPublicarSchema>;
export type AsignacionTurnoAsignarInput = z.infer<typeof asignacionTurnoAsignarSchema>;
export type AsignacionTurnoSustituirInput = z.infer<typeof asignacionTurnoSustituirSchema>;
export type MedicoDeTurnoInput = z.infer<typeof medicoDeTurnoSchema>;
