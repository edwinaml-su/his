/**
 * Workflow Inbox — Bandeja centralizada de tareas pendientes por rol.
 *
 * Patrón BPM: cada "tarea" representa una acción pendiente en un flujo de
 * negocio que requiere intervención humana (firma, validación, dispensación,
 * reporte, certificación, etc.). El sistema agrega tareas de múltiples
 * fuentes en un shape unificado.
 *
 * Routing RBAC: cada tipo de tarea declara los `requiredRoles`. El procedure
 * `miBandeja` filtra por intersección con `ctx.tenant.roleCodes`.
 *
 * NO se exporta desde `schemas/index.ts` (import directo desde el router).
 */
import { z } from "zod";

/** Tipo de tarea — corresponde a una transición BPM esperada. */
export const taskTypeEnum = z.enum([
  // ─── Base (V1) ────────────────────────────────────────────────────────────
  "PRESCRIPTION_TO_SIGN",         // Receta DRAFT pendiente de firma médica (MC)
  "PRESCRIPTION_TO_DISPENSE",     // Receta SIGNED lista para dispensar (PHARM)
  "TRIAGE_IN_PROGRESS",           // Triage IN_PROGRESS pendiente de completar
  "LAB_TO_PROCESS",               // LabOrder ORDERED/COLLECTED para procesar
  "LAB_TO_VALIDATE",              // LabOrder RESULTED para validar
  "IMAGING_TO_REPORT",            // ImagingOrder COMPLETED para reportar
  "IMAGING_TO_VALIDATE",          // ImagingOrder REPORTED para validar
  "MED_TO_ADMINISTER",            // Medicación bedside pendiente

  // ─── Ola 1 Sprint A — Documentos NTEC (11) ────────────────────────────────
  "HC_TO_SIGN",                   // Historia Clínica borrador
  "EPICRISIS_TO_SIGN",            // Epicrisis borrador al alta
  "EVOLUTION_TO_WRITE",           // Encuentro >24h sin evolución médica
  "VALORACION_INICIAL_PENDING",   // Valoración ENF pendiente al ingreso
  "MEDICAL_CONSENT_PENDING",      // Consentimiento médico NTEC sin firma
  "ORDEN_INGRESO_PENDING",        // Orden de ingreso borrador
  "ATENCION_EMERGENCIA_PENDING",  // Documento atención emergencia borrador
  "RRI_PENDING",                  // Referencia/Retorno/Interconsulta sin respuesta
  "ISSS_CERT_PENDING",            // Certificado incapacidad ISSS borrador
  "ECE_RECTIFICACION_PENDING",    // Rectificación ECE pendiente aprobación DIR
  "ECE_DOC_TO_CERTIFY",           // Documento ECE pendiente certificación DIR

  // ─── Ola 1 Sprint B — JCI / Seguridad del paciente (7) ────────────────────
  "VERBAL_ORDER_TO_CONFIRM",      // IPSG.2 — verbal order sin confirmar
  "CRITICAL_RESULT_TO_NOTIFY",    // IPSG.2 — resultado crítico sin notificar
  "DOUBLE_CHECK_PENDING",         // IPSG.3 — high-alert sin 2da verificación
  "WHO_CHECKLIST_INCOMPLETE",     // IPSG.4 — cirugía sin WHO completo
  "FALL_REPORT_PENDING",          // IPSG.6 — caída sin notificación JCI
  "MORSE_REEVALUATE",             // IPSG.6 — riesgo alto sin reevaluar 24h
  "WRISTBAND_MISSING",            // IPSG.1 — paciente hospitalizado sin GSRN

  // ─── Ola 1 Sprint C — Quirófano (5) ───────────────────────────────────────
  "SURGERY_PREOP_PENDING",        // Cirugía mañana sin preop
  "SURGERY_CONSENT_PENDING",      // Cirugía sin consentimiento Qx firmado
  "ANESTHESIA_RECORD_OPEN",       // Anestésico sin cerrar post-cx
  "URPA_DISCHARGE_PENDING",       // URPA con criterios cumplidos
  "SURGERY_NOTE_PENDING",         // Cirugía terminada sin nota operatoria

  // ─── Ola 2 — Camas / Flujo paciente (4) ───────────────────────────────────
  "BED_TO_CLEAN",
  "BED_TO_RELEASE",
  "TRANSFER_PENDING_ACCEPT",
  "ADMISSION_VITALS_MISSING",

  // ─── Ola 2 — Consulta externa (3) ─────────────────────────────────────────
  "APPOINTMENT_TO_CHECKIN",
  "CONSULTATION_NOTE_PENDING",
  "APPOINTMENT_NO_SHOW_FOLLOWUP",

  // ─── Ola 2 — Estudios pendientes (3) ──────────────────────────────────────
  "RESPIRATORY_ORDER_PENDING",
  "NUTRITION_ORDER_PENDING",
  "STUDY_TO_SCHEDULE",

  // ─── Ola 2 — Maternidad (3) ────────────────────────────────────────────────
  "PARTOGRAMA_OVERDUE",
  "RN_APGAR_PENDING",
  "NRP_POSTEVENT_DEBRIEF",

  // ─── Ola 2 — Banco de sangre (2) ───────────────────────────────────────────
  "BLOOD_VERIFY_PENDING",
  "BLOOD_REACTION_REPORT",

  // ─── Ola 3 — MPI / Identidad / Privacidad (3) ─────────────────────────────
  "MPI_MERGE_PENDING",
  "PATIENT_NN_TO_RESOLVE",
  "ARCO_REQUEST_PENDING",

  // ─── Ola 3 — Farmacovigilancia / Calidad (2) ──────────────────────────────
  "ADR_REPORT_PENDING",
  "INCIDENT_TO_REVIEW",

  // ─── Ola 3 — GS1 / Logística (4) ──────────────────────────────────────────
  "GS1_INBOUND_PENDING",
  "GS1_TRANSFER_PENDING",
  "GS1_RETURN_PENDING",
  "GS1_RECALL_TO_PURGE",

  // ─── Ola 3 — Cold chain (1) ───────────────────────────────────────────────
  "COLD_CHAIN_BREACH",

  // ─── Ola 3 — Equipos / Mantenimiento (3) ──────────────────────────────────
  "EQUIPMENT_CALIBRATION_DUE",
  "EQUIPMENT_MAINTENANCE_DUE",
  "EQUIPMENT_OUT_OF_SERVICE_RETURN",

  // ─── Ola 3 — Inventario (2) ───────────────────────────────────────────────
  "INVENTORY_LOW_STOCK",
  "INVENTORY_EXPIRING_SOON",

  // ─── Ola 3 — Defunciones / Reclamos (3) ───────────────────────────────────
  "DEATH_CERT_PENDING",
  "CLAIM_PENDING_SUBMISSION",
  "CLAIM_REJECTED_TO_APPEAL",
]);
export type TaskType = z.infer<typeof taskTypeEnum>;

/** Severidad / prioridad de la tarea. */
export const taskPriorityEnum = z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]);
export type TaskPriority = z.infer<typeof taskPriorityEnum>;

/** SLA por tipo de tarea en minutos. Null = sin SLA. */
export const TASK_SLA_MINUTES: Record<TaskType, number | null> = {
  PRESCRIPTION_TO_SIGN:      30,
  PRESCRIPTION_TO_DISPENSE:  60,
  TRIAGE_IN_PROGRESS:        10,
  LAB_TO_PROCESS:           120,
  LAB_TO_VALIDATE:           60,
  IMAGING_TO_REPORT:        240,
  IMAGING_TO_VALIDATE:       60,
  MED_TO_ADMINISTER:         15,

  HC_TO_SIGN:                480,
  EPICRISIS_TO_SIGN:         240,
  EVOLUTION_TO_WRITE:       1440,
  VALORACION_INICIAL_PENDING: 240,
  MEDICAL_CONSENT_PENDING:   1440,
  ORDEN_INGRESO_PENDING:     120,
  ATENCION_EMERGENCIA_PENDING: 60,
  RRI_PENDING:              1440,
  ISSS_CERT_PENDING:        1440,
  ECE_RECTIFICACION_PENDING: 1440,
  ECE_DOC_TO_CERTIFY:        480,

  VERBAL_ORDER_TO_CONFIRM:  1440,
  CRITICAL_RESULT_TO_NOTIFY:  30,
  DOUBLE_CHECK_PENDING:        5,
  WHO_CHECKLIST_INCOMPLETE:    0,
  FALL_REPORT_PENDING:      1440,
  MORSE_REEVALUATE:         1440,
  WRISTBAND_MISSING:          60,

  SURGERY_PREOP_PENDING:    1440,
  SURGERY_CONSENT_PENDING:  1440,
  ANESTHESIA_RECORD_OPEN:    120,
  URPA_DISCHARGE_PENDING:     30,
  SURGERY_NOTE_PENDING:     1440,

  // Ola 2
  BED_TO_CLEAN:              120,
  BED_TO_RELEASE:             60,
  TRANSFER_PENDING_ACCEPT:   240,
  ADMISSION_VITALS_MISSING:   30,
  APPOINTMENT_TO_CHECKIN:    -30,
  CONSULTATION_NOTE_PENDING: 120,
  APPOINTMENT_NO_SHOW_FOLLOWUP: 1440,
  RESPIRATORY_ORDER_PENDING:  60,
  NUTRITION_ORDER_PENDING:   240,
  STUDY_TO_SCHEDULE:         240,
  PARTOGRAMA_OVERDUE:         30,
  RN_APGAR_PENDING:            5,
  NRP_POSTEVENT_DEBRIEF:    1440,
  BLOOD_VERIFY_PENDING:        5,
  BLOOD_REACTION_REPORT:     240,
  // Ola 3
  MPI_MERGE_PENDING:       10080,
  PATIENT_NN_TO_RESOLVE:    2880,
  ARCO_REQUEST_PENDING:    43200,
  ADR_REPORT_PENDING:       4320,
  INCIDENT_TO_REVIEW:      10080,
  GS1_INBOUND_PENDING:      1440,
  GS1_TRANSFER_PENDING:      240,
  GS1_RETURN_PENDING:       1440,
  GS1_RECALL_TO_PURGE:      1440,
  COLD_CHAIN_BREACH:          30,
  EQUIPMENT_CALIBRATION_DUE: null,
  EQUIPMENT_MAINTENANCE_DUE: null,
  EQUIPMENT_OUT_OF_SERVICE_RETURN: 10080,
  INVENTORY_LOW_STOCK:      1440,
  INVENTORY_EXPIRING_SOON: 43200,
  DEATH_CERT_PENDING:       1440,
  CLAIM_PENDING_SUBMISSION:10080,
  CLAIM_REJECTED_TO_APPEAL:43200,
};

/** Roles RBAC que pueden ejecutar cada tipo de tarea. */
export const TASK_REQUIRED_ROLES: Record<TaskType, string[]> = {
  PRESCRIPTION_TO_SIGN:      ["MC", "PHYSICIAN"],
  PRESCRIPTION_TO_DISPENSE:  ["PHARM", "PHARMACIST"],
  TRIAGE_IN_PROGRESS:        ["TRIAGIST", "NURSE", "ENF"],
  LAB_TO_PROCESS:            ["LAB_TECH", "LAB"],
  LAB_TO_VALIDATE:           ["LAB_VALIDATOR", "MC", "PHYSICIAN"],
  IMAGING_TO_REPORT:         ["RAD", "RADIOLOGO"],
  IMAGING_TO_VALIDATE:       ["MC", "PHYSICIAN", "RAD"],
  MED_TO_ADMINISTER:         ["NURSE", "ENF"],

  HC_TO_SIGN:                ["MC", "PHYSICIAN"],
  EPICRISIS_TO_SIGN:         ["MC", "PHYSICIAN"],
  EVOLUTION_TO_WRITE:        ["MC", "PHYSICIAN"],
  VALORACION_INICIAL_PENDING: ["NURSE", "ENF"],
  MEDICAL_CONSENT_PENDING:   ["MC", "PHYSICIAN"],
  ORDEN_INGRESO_PENDING:     ["MC", "PHYSICIAN"],
  ATENCION_EMERGENCIA_PENDING: ["MC", "PHYSICIAN"],
  RRI_PENDING:               ["MC", "PHYSICIAN"],
  ISSS_CERT_PENDING:         ["MC", "PHYSICIAN"],
  ECE_RECTIFICACION_PENDING: ["DIR"],
  ECE_DOC_TO_CERTIFY:        ["DIR"],

  VERBAL_ORDER_TO_CONFIRM:   ["MC", "PHYSICIAN"],
  CRITICAL_RESULT_TO_NOTIFY: ["MC", "PHYSICIAN", "NURSE", "ENF"],
  DOUBLE_CHECK_PENDING:      ["NURSE", "ENF"],
  WHO_CHECKLIST_INCOMPLETE:  ["MC", "PHYSICIAN", "NURSE", "ENF"],
  FALL_REPORT_PENDING:       ["NURSE", "ENF", "MC", "PHYSICIAN"],
  MORSE_REEVALUATE:          ["NURSE", "ENF"],
  WRISTBAND_MISSING:         ["NURSE", "ENF", "ADM"],

  SURGERY_PREOP_PENDING:     ["MC", "PHYSICIAN"],
  SURGERY_CONSENT_PENDING:   ["MC", "PHYSICIAN"],
  ANESTHESIA_RECORD_OPEN:    ["ANESTH", "MC"],
  URPA_DISCHARGE_PENDING:    ["ANESTH", "MC"],
  SURGERY_NOTE_PENDING:      ["MC", "PHYSICIAN"],

  // Ola 2
  BED_TO_CLEAN:              ["NURSE", "ENF", "LIMPIEZA", "ADM"],
  BED_TO_RELEASE:            ["ADM", "NURSE", "ENF"],
  TRANSFER_PENDING_ACCEPT:   ["MC", "PHYSICIAN"],
  ADMISSION_VITALS_MISSING:  ["NURSE", "ENF"],
  APPOINTMENT_TO_CHECKIN:    ["ADM", "RECEPCION"],
  CONSULTATION_NOTE_PENDING: ["MC", "PHYSICIAN"],
  APPOINTMENT_NO_SHOW_FOLLOWUP: ["MC", "PHYSICIAN"],
  RESPIRATORY_ORDER_PENDING: ["RESP", "TERAPISTA", "NURSE"],
  NUTRITION_ORDER_PENDING:   ["NUTRI", "MC"],
  STUDY_TO_SCHEDULE:         ["RAD", "RADIOLOGO", "ADM"],
  PARTOGRAMA_OVERDUE:        ["OBSTETRA", "MC", "NURSE", "ENF"],
  RN_APGAR_PENDING:          ["NEONATOLOGO", "MC", "NURSE", "ENF"],
  NRP_POSTEVENT_DEBRIEF:     ["NEONATOLOGO", "MC", "ENF"],
  BLOOD_VERIFY_PENDING:      ["NURSE", "ENF", "BB"],
  BLOOD_REACTION_REPORT:     ["MC", "PHYSICIAN", "BB"],
  // Ola 3
  MPI_MERGE_PENDING:         ["ADM", "ADMIN", "DPO"],
  PATIENT_NN_TO_RESOLVE:     ["ADM", "NURSE", "ENF"],
  ARCO_REQUEST_PENDING:      ["DPO", "DIR", "ADMIN"],
  ADR_REPORT_PENDING:        ["PHARM", "MC", "PHYSICIAN", "FARMACO"],
  INCIDENT_TO_REVIEW:        ["CALIDAD", "DIR", "ADMIN"],
  GS1_INBOUND_PENDING:       ["BODEGA", "ADMIN"],
  GS1_TRANSFER_PENDING:      ["BODEGA"],
  GS1_RETURN_PENDING:        ["BODEGA"],
  GS1_RECALL_TO_PURGE:       ["BODEGA", "PHARM", "ADMIN"],
  COLD_CHAIN_BREACH:         ["PHARM", "MANTENIMIENTO", "BODEGA"],
  EQUIPMENT_CALIBRATION_DUE: ["BIOMEDICA", "MANTENIMIENTO"],
  EQUIPMENT_MAINTENANCE_DUE: ["BIOMEDICA", "MANTENIMIENTO"],
  EQUIPMENT_OUT_OF_SERVICE_RETURN: ["BIOMEDICA", "MANTENIMIENTO"],
  INVENTORY_LOW_STOCK:       ["BODEGA", "ADMIN"],
  INVENTORY_EXPIRING_SOON:   ["BODEGA", "PHARM"],
  DEATH_CERT_PENDING:        ["MC", "PHYSICIAN"],
  CLAIM_PENDING_SUBMISSION:  ["ADM", "FACTURACION", "ADMIN"],
  CLAIM_REJECTED_TO_APPEAL:  ["ADM", "FACTURACION", "ADMIN"],
};

/** Label legible en español por tipo. */
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  PRESCRIPTION_TO_SIGN:      "Firmar receta",
  PRESCRIPTION_TO_DISPENSE:  "Dispensar medicación",
  TRIAGE_IN_PROGRESS:        "Completar triage",
  LAB_TO_PROCESS:            "Procesar muestra de laboratorio",
  LAB_TO_VALIDATE:           "Validar resultado de laboratorio",
  IMAGING_TO_REPORT:         "Reportar estudio de imagen",
  IMAGING_TO_VALIDATE:       "Validar reporte de imagen",
  MED_TO_ADMINISTER:         "Administrar medicamento bedside",

  HC_TO_SIGN:                "Firmar Historia Clínica",
  EPICRISIS_TO_SIGN:         "Firmar Epicrisis",
  EVOLUTION_TO_WRITE:        "Escribir evolución médica",
  VALORACION_INICIAL_PENDING: "Valoración inicial enfermería",
  MEDICAL_CONSENT_PENDING:   "Firmar consentimiento médico",
  ORDEN_INGRESO_PENDING:     "Firmar orden de ingreso",
  ATENCION_EMERGENCIA_PENDING: "Documentar atención emergencia",
  RRI_PENDING:               "Responder referencia/interconsulta",
  ISSS_CERT_PENDING:         "Emitir certificado ISSS",
  ECE_RECTIFICACION_PENDING: "Aprobar rectificación ECE",
  ECE_DOC_TO_CERTIFY:        "Certificar documento ECE",

  VERBAL_ORDER_TO_CONFIRM:   "Confirmar orden verbal (IPSG.2)",
  CRITICAL_RESULT_TO_NOTIFY: "Notificar resultado crítico (IPSG.2)",
  DOUBLE_CHECK_PENDING:      "Doble verificación high-alert (IPSG.3)",
  WHO_CHECKLIST_INCOMPLETE:  "Completar WHO Checklist (IPSG.4)",
  FALL_REPORT_PENDING:       "Notificar caída a JCI (IPSG.6)",
  MORSE_REEVALUATE:          "Reevaluar Morse riesgo caída",
  WRISTBAND_MISSING:         "Colocar pulsera GSRN paciente (IPSG.1)",

  SURGERY_PREOP_PENDING:     "Completar valoración preoperatoria",
  SURGERY_CONSENT_PENDING:   "Firmar consentimiento quirúrgico",
  ANESTHESIA_RECORD_OPEN:    "Cerrar registro anestésico",
  URPA_DISCHARGE_PENDING:    "Egreso URPA",
  SURGERY_NOTE_PENDING:      "Escribir nota operatoria",

  // Ola 2
  BED_TO_CLEAN:              "Limpiar cama (post-alta)",
  BED_TO_RELEASE:            "Liberar cama (alta firmada)",
  TRANSFER_PENDING_ACCEPT:   "Aceptar traslado entrante",
  ADMISSION_VITALS_MISSING:  "Capturar signos vitales al ingreso",
  APPOINTMENT_TO_CHECKIN:    "Check-in de cita próxima",
  CONSULTATION_NOTE_PENDING: "Documentar consulta atendida",
  APPOINTMENT_NO_SHOW_FOLLOWUP: "Seguimiento por no-asistencia",
  RESPIRATORY_ORDER_PENDING: "Ejecutar orden respiratoria",
  NUTRITION_ORDER_PENDING:   "Aprobar orden nutricional",
  STUDY_TO_SCHEDULE:         "Programar estudio de imagen",
  PARTOGRAMA_OVERDUE:        "Actualizar partograma (>30min)",
  RN_APGAR_PENDING:          "Registrar APGAR del RN",
  NRP_POSTEVENT_DEBRIEF:     "Debrief post reanimación neonatal",
  BLOOD_VERIFY_PENDING:      "Verificar 2-IDs para transfusión",
  BLOOD_REACTION_REPORT:     "Reportar reacción transfusional",
  // Ola 3
  MPI_MERGE_PENDING:         "Resolver candidatos de merge MPI",
  PATIENT_NN_TO_RESOLVE:     "Identificar paciente NN (>48h)",
  ARCO_REQUEST_PENDING:      "Responder solicitud ARCO (GDPR)",
  ADR_REPORT_PENDING:        "Reportar reacción adversa medicamentosa",
  INCIDENT_TO_REVIEW:        "Revisar evento adverso de calidad",
  GS1_INBOUND_PENDING:       "Validar recepción de mercadería",
  GS1_TRANSFER_PENDING:      "Recepcionar transferencia interna",
  GS1_RETURN_PENDING:        "Validar devolución",
  GS1_RECALL_TO_PURGE:       "Purgar lote retirado del stock",
  COLD_CHAIN_BREACH:         "Quiebre cadena de frío (acción inmediata)",
  EQUIPMENT_CALIBRATION_DUE: "Calibrar equipo biomédico",
  EQUIPMENT_MAINTENANCE_DUE: "Mantenimiento preventivo de equipo",
  EQUIPMENT_OUT_OF_SERVICE_RETURN: "Equipo en reparación >7d",
  INVENTORY_LOW_STOCK:       "Reposición de stock crítico",
  INVENTORY_EXPIRING_SOON:   "Lote por vencer en 30 días",
  DEATH_CERT_PENDING:        "Emitir certificado de defunción",
  CLAIM_PENDING_SUBMISSION:  "Enviar reclamo a aseguradora",
  CLAIM_REJECTED_TO_APPEAL:  "Apelar reclamo rechazado",
};

export const taskSchema = z.object({
  id: z.string(),
  type: taskTypeEnum,
  typeLabel: z.string(),
  priority: taskPriorityEnum,
  patientName: z.string().nullable(),
  patientMrn: z.string().nullable(),
  description: z.string(),
  createdAt: z.date(),
  ageMinutes: z.number(),
  remainingMinutes: z.number().nullable(),
  isOverdue: z.boolean(),
  deepLink: z.string(),
  requiredRoles: z.array(z.string()),
});
export type Task = z.infer<typeof taskSchema>;

export const inboxResponseSchema = z.object({
  serverNow: z.date(),
  totalTasks: z.number().int().nonnegative(),
  overdueTasks: z.number().int().nonnegative(),
  countsByType: z.array(
    z.object({
      type: taskTypeEnum,
      typeLabel: z.string(),
      count: z.number().int().nonnegative(),
      overdueCount: z.number().int().nonnegative(),
    }),
  ),
  tasks: z.array(taskSchema),
});
export type InboxResponse = z.infer<typeof inboxResponseSchema>;

export const inboxFiltersSchema = z.object({
  types: z.array(taskTypeEnum).optional(),
  onlyOverdue: z.boolean().default(false),
  priority: taskPriorityEnum.optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
export type InboxFilters = z.infer<typeof inboxFiltersSchema>;
