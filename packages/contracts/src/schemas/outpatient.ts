/**
 * §10 Outpatient (Consulta Externa) — schemas de input.
 *
 * Beta.7 hardening layer 1:
 *  - reasonCategory enum (ROUTINE/FOLLOWUP/ACUTE/PREVENTIVE/CHRONIC/OTHER)
 *  - reason/reasonOfVisit max bumped to 500 chars
 *  - ALLOWED_TRANSITIONS para state machine validada en router
 *  - noShowDetectInput para endpoint detectNoShows
 */
import { z } from "zod";

const APPOINTMENT_STATUS = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "NO_SHOW",
  "COMPLETED",
  "CANCELLED",
] as const;

export const appointmentStatusEnum = z.enum(APPOINTMENT_STATUS);
export type AppointmentStatusType = z.infer<typeof appointmentStatusEnum>;

export const REASON_CATEGORY = [
  "ROUTINE",
  "FOLLOWUP",
  "ACUTE",
  "PREVENTIVE",
  "CHRONIC",
  "OTHER",
] as const;

export const reasonCategoryEnum = z.enum(REASON_CATEGORY);
export type ReasonCategoryType = z.infer<typeof reasonCategoryEnum>;

/**
 * Valid state machine transitions.
 *
 * SCHEDULED   -> CONFIRMED | CHECKED_IN | CANCELLED | NO_SHOW
 * CONFIRMED   -> CHECKED_IN | CANCELLED | NO_SHOW
 * CHECKED_IN  -> COMPLETED | CANCELLED
 * NO_SHOW / COMPLETED / CANCELLED -> (terminal)
 */
export const ALLOWED_TRANSITIONS: Record<
  AppointmentStatusType,
  ReadonlyArray<AppointmentStatusType>
> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["COMPLETED", "CANCELLED"],
  NO_SHOW: [],
  COMPLETED: [],
  CANCELLED: [],
};

export const outpatientAppointmentCreateInput = z.object({
  patientId: z.string().uuid(),
  providerId: z.string().uuid(),
  establishmentId: z.string().uuid(),
  specialtyId: z.string().uuid().optional(),
  serviceUnitId: z.string().uuid().optional(),
  scheduledAt: z.coerce.date().refine((d) => d > new Date(), {
    message: "scheduledAt debe ser futuro",
  }),
  durationMinutes: z.number().int().min(5).max(180).default(20),
  reason: z.string().trim().max(500).optional(),
  reasonCategory: reasonCategoryEnum.optional(),
});

export const outpatientAppointmentUpdateInput = z.object({
  id: z.string().uuid(),
  status: appointmentStatusEnum.optional(),
  scheduledAt: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(5).max(180).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  reasonCategory: reasonCategoryEnum.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export const outpatientAppointmentListInput = z.object({
  providerId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: appointmentStatusEnum.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const outpatientAppointmentCancelInput = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

export const noShowDetectInput = z.object({
  thresholdMinutes: z.number().int().min(1).max(1440).default(30),
  commit: z.boolean().default(false),
});

export const outpatientConsultationCreateInput = z.object({
  appointmentId: z.string().uuid().optional(),
  encounterId: z.string().uuid(),
  reasonOfVisit: z.string().trim().min(1).max(500),
  reasonCategory: reasonCategoryEnum.optional(),
  subjective: z.string().trim().max(8000).optional(),
  objective: z.string().trim().max(8000).optional(),
  assessment: z.string().trim().max(8000).optional(),
  plan: z.string().trim().max(8000).optional(),
});

export type OutpatientAppointmentCreateInput = z.infer<typeof outpatientAppointmentCreateInput>;
export type OutpatientAppointmentUpdateInput = z.infer<typeof outpatientAppointmentUpdateInput>;
export type OutpatientAppointmentListInput = z.infer<typeof outpatientAppointmentListInput>;
export type OutpatientAppointmentCancelInput = z.infer<typeof outpatientAppointmentCancelInput>;
export type NoShowDetectInput = z.infer<typeof noShowDetectInput>;
export type OutpatientConsultationCreateInput = z.infer<typeof outpatientConsultationCreateInput>;

// -----------------------------------------------------------------------------
// CC-0036 Ola 4 (REQ-HIS-AFIL-001 S4) — operación de agenda: reserva desde un
// slot de `agenda.disponibilidad`, reprogramación, cancelación tipificada,
// sobrecupo, check-in→Encounter+cuenta y no-show. US.AGE.2.4/2.5/2.6/2.7.
// -----------------------------------------------------------------------------

export const tipoCitaEnum = z.enum(["PRIMERA_VEZ", "SUBSECUENTE", "CONTROL_POSTQX", "PROCEDIMIENTO"]);
export const canalCitaEnum = z.enum(["RECEPCION", "TELEFONO", "MEDICO", "PORTAL"]);

/**
 * REQ no define el catálogo exacto de "motivo tipificado" para cancelación
 * tardía (US.AGE.2.5 AC2) — vocabulario cerrado razonable, a confirmar con
 * @PO si el negocio necesita más granularidad.
 */
export const motivoCancelacionCitaEnum = z.enum([
  "PACIENTE_NO_PUEDE",
  "MEDICO_NO_DISPONIBLE",
  "ERROR_AGENDAMIENTO",
  "DUPLICADO",
  "OTRO",
]);

/**
 * US.AGE.2.4 — reserva desde un slot devuelto por `agenda.disponibilidad`.
 * `confirmarDuplicado:true` fuerza el guardado pese a que el paciente ya
 * tenga una cita SCHEDULED/CONFIRMED en la misma agenda y fecha (AC4).
 * `esSobrecupo`/`motivoSobrecupo` cubren US.AGE.2.5 AC4/AC5 — el router
 * exige el permiso `agenda.sobrecupo` cuando `esSobrecupo=true`.
 */
export const reservarCitaInput = z.object({
  agendaId: z.string().uuid(),
  patientId: z.string().uuid(),
  slotInicio: z.coerce.date(),
  tipoCita: tipoCitaEnum,
  canal: canalCitaEnum,
  reason: z.string().trim().max(500).optional(),
  tipoCuentaId: z.string().uuid().optional(),
  insurerId: z.string().uuid().optional(),
  confirmarDuplicado: z.boolean().optional(),
  esSobrecupo: z.boolean().optional(),
  motivoSobrecupo: z.string().trim().min(1).max(500).optional(),
  /** US.AGE.2.4 AC6 — motivo exigido cuando la agenda está SUSPENDIDA (permiso `agenda.reservar_suspendida`). */
  motivoReservarSuspendida: z.string().trim().min(1).max(500).optional(),
});

export type ReservarCitaInput = z.infer<typeof reservarCitaInput>;

/** US.AGE.2.5 AC1 — la original pasa a CANCELLED/REPROGRAMADA, se crea una nueva con `reprogramadaDeId`. */
export const reprogramarCitaInput = z.object({
  id: z.string().uuid(),
  agendaId: z.string().uuid(),
  slotInicio: z.coerce.date(),
  motivo: z.string().trim().max(500).optional(),
});

export type ReprogramarCitaInput = z.infer<typeof reprogramarCitaInput>;

export const cancelarCitaInput = z.object({
  id: z.string().uuid(),
  motivo: motivoCancelacionCitaEnum,
  notas: z.string().trim().max(500).optional(),
});

export type CancelarCitaInput = z.infer<typeof cancelarCitaInput>;

export const checkInCitaInput = z.object({ id: z.string().uuid() });
export type CheckInCitaInput = z.infer<typeof checkInCitaInput>;

export const revertirNoShowInput = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(500),
});
export type RevertirNoShowInput = z.infer<typeof revertirNoShowInput>;

export const completarCitaInput = z.object({ id: z.string().uuid() });
export type CompletarCitaInput = z.infer<typeof completarCitaInput>;

/** US.AGE.2.7 AC3/AC4 — tablero del día por sede/consultorio/médico. */
export const tableroDiaInput = z.object({
  fecha: z.string().date(),
  establishmentId: z.string().uuid().optional(),
  consultorioId: z.string().uuid().optional(),
});
export type TableroDiaInput = z.infer<typeof tableroDiaInput>;

/** US.AGE.2.7 AC5 — no-show/cancelación tardía/ocupación/espera promedio por rango. */
export const indicadoresAgendaInput = z.object({
  desde: z.string().date(),
  hasta: z.string().date(),
  establishmentId: z.string().uuid().optional(),
  medicoAfiliadoId: z.string().uuid().optional(),
  consultorioId: z.string().uuid().optional(),
});
export type IndicadoresAgendaInput = z.infer<typeof indicadoresAgendaInput>;