import { z } from "zod";

/**
 * CC-0036 Ola 3 (REQ-HIS-AFIL-001 S3) — AgendaMedico / AgendaHorario /
 * AgendaExcepcion / ListaEspera. sql/246_cc0036_agenda_core.sql.
 * US.AGE.2.1, US.AGE.2.2, US.AGE.2.3.
 *
 * D4 del REQ (no reabrir): disponibilidad DERIVADA por
 * `fn_agenda_disponibilidad` — sin tabla de slots. `ListaEspera` es modelo
 * completo pero su operación (inscribir/notificar/convertir a cita) llega en
 * Ola 4 — sin schemas de mutación acá todavía.
 */

export const agendaEstadoEnum = z.enum(["BORRADOR", "PUBLICADA", "SUSPENDIDA", "CERRADA"]);

export const agendaExcepcionTipoEnum = z.enum(["BLOQUEO", "EXTENSION", "VACACION", "CONGRESO"]);

/** "HH:MM" u "HH:MM:SS" — hora local America/El_Salvador, sin offset (NFR-6). Igual a turno.ts/contrato.ts. */
const horaSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Formato de hora inválido (HH:MM).");

// -----------------------------------------------------------------------------
// AgendaMedico
// -----------------------------------------------------------------------------

export const agendaListSchema = z
  .object({
    medicoAfiliadoId: z.string().uuid().optional(),
    consultorioId: z.string().uuid().optional(),
    establishmentId: z.string().uuid().optional(),
    specialtyId: z.string().uuid().optional(),
    estado: agendaEstadoEnum.optional(),
  })
  .optional();

export const agendaGetSchema = z.object({ id: z.string().uuid() });

const agendaHorarioShape = {
  diaSemana: z.number().int().min(0).max(6),
  horaInicio: horaSchema,
  horaFin: horaSchema,
};

function refineHorario<T extends { horaInicio: string; horaFin: string }>(v: T): boolean {
  return v.horaFin > v.horaInicio;
}

export const agendaHorarioInputSchema = z.object(agendaHorarioShape).refine(refineHorario, {
  message: "horaFin debe ser posterior a horaInicio.",
  path: ["horaFin"],
});

/**
 * US.AGE.2.1 AC1 — alta en BORRADOR. `establishmentId` NO se recibe: el
 * router lo deriva de `Consultorio.establishmentId` (única fuente de verdad,
 * evita drift si el cliente enviara un establecimiento distinto al del
 * consultorio). El contrato VIGENTE también se resuelve en el router.
 */
export const agendaCreateSchema = z.object({
  medicoAfiliadoId: z.string().uuid(),
  consultorioId: z.string().uuid(),
  specialtyId: z.string().uuid().optional(),
  vigenciaDesde: z.string().date(),
  vigenciaHasta: z.string().date().optional(),
  duracionSlotMin: z.number().int().min(1).max(480).optional(),
  capacidadPorSlot: z.number().int().min(1).max(50).optional(),
  sobrecupoMaximoDia: z.number().int().min(0).max(50).optional(),
  anticipacionMinimaHoras: z.number().int().min(0).max(720).optional(),
  horizonteMaximoDias: z.number().int().min(1).max(730).optional(),
  politicaCancelacionHoras: z.number().int().min(0).max(720).optional(),
  permiteAutoagenda: z.boolean().optional(),
});

/**
 * US.AGE.2.1 AC5 — cambios a `duracionSlotMin`/`capacidadPorSlot` en una
 * agenda PUBLICADA pueden afectar citas futuras del médico. `confirmar:true`
 * fuerza el guardado pese al conflicto listado (mismo patrón `forzar` que
 * `agendaExcepcionCreateSchema` — ver docstring del router).
 */
export const agendaUpdateSchema = z.object({
  id: z.string().uuid(),
  specialtyId: z.string().uuid().nullable().optional(),
  vigenciaHasta: z.string().date().nullable().optional(),
  duracionSlotMin: z.number().int().min(1).max(480).optional(),
  capacidadPorSlot: z.number().int().min(1).max(50).optional(),
  sobrecupoMaximoDia: z.number().int().min(0).max(50).optional(),
  anticipacionMinimaHoras: z.number().int().min(0).max(720).optional(),
  horizonteMaximoDias: z.number().int().min(1).max(730).optional(),
  politicaCancelacionHoras: z.number().int().min(0).max(720).optional(),
  permiteAutoagenda: z.boolean().optional(),
  confirmar: z.boolean().optional(),
});

export const agendaPublicarSchema = z.object({ id: z.string().uuid() });

export const agendaSuspenderSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(500),
});

export const agendaReactivarSchema = z.object({ id: z.string().uuid() });

// -----------------------------------------------------------------------------
// AgendaHorario
// -----------------------------------------------------------------------------

export const agendaHorarioListSchema = z.object({ agendaId: z.string().uuid() });

export const agendaHorarioCreateSchema = z
  .object({ ...agendaHorarioShape, agendaId: z.string().uuid() })
  .refine(refineHorario, { message: "horaFin debe ser posterior a horaInicio.", path: ["horaFin"] });

export const agendaHorarioDeleteSchema = z.object({ id: z.string().uuid() });

// -----------------------------------------------------------------------------
// AgendaExcepcion (US.AGE.2.2)
// -----------------------------------------------------------------------------

/**
 * AC2 — una excepción sobre una fecha con citas ya reservadas exige
 * confirmación explícita (`forzar:true`) tras ver el listado de citas
 * afectadas que devuelve el router en el primer intento (`PRECONDITION_FAILED`).
 */
export const agendaExcepcionCreateSchema = z
  .object({
    agendaId: z.string().uuid(),
    fecha: z.string().date(),
    tipo: agendaExcepcionTipoEnum,
    horaInicio: horaSchema.optional(),
    horaFin: horaSchema.optional(),
    motivo: z.string().trim().min(1).max(500),
    forzar: z.boolean().optional(),
  })
  .refine((v) => (v.horaInicio === undefined) === (v.horaFin === undefined), {
    message: "horaInicio y horaFin deben especificarse juntos (o ninguno para día completo).",
    path: ["horaFin"],
  })
  .refine((v) => v.horaInicio === undefined || v.horaFin! > v.horaInicio, {
    message: "horaFin debe ser posterior a horaInicio.",
    path: ["horaFin"],
  });

export const agendaExcepcionListSchema = z.object({
  agendaId: z.string().uuid(),
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
});

export const agendaExcepcionDeleteSchema = z.object({ id: z.string().uuid() });

// -----------------------------------------------------------------------------
// Disponibilidad (US.AGE.2.3)
// -----------------------------------------------------------------------------

export const agendaDisponibilidadSchema = z
  .object({
    agendaId: z.string().uuid().optional(),
    medicoAfiliadoId: z.string().uuid().optional(),
    specialtyId: z.string().uuid().optional(),
    desde: z.string().date(),
    hasta: z.string().date(),
  })
  .refine((v) => v.agendaId !== undefined || v.medicoAfiliadoId !== undefined || v.specialtyId !== undefined, {
    message: "Debe indicar agendaId, medicoAfiliadoId o specialtyId.",
    path: ["agendaId"],
  })
  .refine((v) => v.hasta >= v.desde, {
    message: "hasta debe ser posterior o igual a desde.",
    path: ["hasta"],
  });

export type AgendaListInput = z.infer<typeof agendaListSchema>;
export type AgendaCreateInput = z.infer<typeof agendaCreateSchema>;
export type AgendaUpdateInput = z.infer<typeof agendaUpdateSchema>;
export type AgendaHorarioInput = z.infer<typeof agendaHorarioInputSchema>;
export type AgendaHorarioCreateInput = z.infer<typeof agendaHorarioCreateSchema>;
export type AgendaExcepcionCreateInput = z.infer<typeof agendaExcepcionCreateSchema>;
export type AgendaDisponibilidadInput = z.infer<typeof agendaDisponibilidadSchema>;
