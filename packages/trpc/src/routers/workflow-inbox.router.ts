/**
 * Router tRPC — Workflow Inbox (Bandeja BPM centralizada).
 *
 * Ola 1 P1: 29 fuentes BPM activas.
 *   - Base: receta, triage, lab, imagen, dispensación, medicación bedside (6)
 *   - Documentos NTEC: HC, epicrisis, evolución, valoración ENF, consentimiento
 *     médico, orden ingreso, atención emergencia, RRI, ISSS, rectificación,
 *     certificación DIR (11)
 *   - JCI: verbal order, critical result, double-check, WHO incomplete,
 *     fall report, Morse, wristband (7)
 *   - Quirófano: preop, consent Qx, anestésico abierto, URPA egreso, nota
 *     operatoria (5)
 *
 * Estrategia: queries paralelas con Promise.all + batch fetch único de
 * Patient. Drift pattern para tablas del schema `ece` que no están en
 * schema.prisma — usan $queryRawUnsafe.
 *
 * Spec: ver packages/contracts/src/schemas/workflow-inbox.ts
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  inboxFiltersSchema,
  reassignTaskInput,
  escalateTaskInput,
  completeTaskInput,
  commentTaskInput,
  type InboxResponse,
  type Task,
  type TaskPriority,
  type TaskType,
  TASK_REQUIRED_ROLES,
  TASK_SLA_MINUTES,
  TASK_TYPE_LABEL,
} from "@his/contracts/schemas/workflow-inbox";
import { router, tenantProcedure } from "../trpc";

function derivePriority(ageMinutes: number, slaMinutes: number | null): TaskPriority {
  if (slaMinutes === null) return "NORMAL";
  if (slaMinutes === 0) return "CRITICAL";
  const pct = ageMinutes / slaMinutes;
  if (pct > 1) return "CRITICAL";
  if (pct > 0.7) return "HIGH";
  if (pct > 0.4) return "NORMAL";
  return "LOW";
}

function ageInMinutes(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 60_000) * 10) / 10;
}

function userHasAnyRole(userRoles: string[], required: string[]): boolean {
  return required.some((r) => userRoles.includes(r));
}

interface PatientMini {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
}

/** Fila genérica de una query raw sobre ece.documento_instancia. */
interface NtecDocRow {
  id: string;
  paciente_id: string;
  creado_en: Date;
  creado_por: string;
  episodio_id: string | null;
}

/** Wrapper para queries NTEC: filtra por código de tipo y estado del documento. */
function buildNtecQuery(tipoCode: string, estadoCode: string) {
  return `
    SELECT di.id::text AS id,
           di.paciente_id::text AS paciente_id,
           di.creado_en,
           di.creado_por::text AS creado_por,
           di.episodio_id::text AS episodio_id
    FROM ece.documento_instancia di
    JOIN ece.tipo_documento td ON td.id = di.tipo_documento_id
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
    WHERE td.codigo = $1 AND fe.codigo = $2
      AND di.estado_registro = 'vigente'
    ORDER BY di.creado_en ASC
    LIMIT 100
  `;
}

export const workflowInboxRouter = router({
  miBandeja: tenantProcedure
    .input(inboxFiltersSchema.optional())
    .query(async ({ ctx, input }): Promise<InboxResponse> => {
      const filters = input ?? inboxFiltersSchema.parse({});
      const { prisma, tenant, user } = ctx;
      const userRoles = tenant.roleCodes;
      const orgId = tenant.organizationId;
      const now = new Date();

      // RBAC enforcement de scope: ALL solo para admins/directivos.
      if (
        filters.scope === "ALL" &&
        !userRoles.some((r) => ["ADMIN", "ADMIN_CLINICO", "DIR", "GERENTE"].includes(r))
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo roles ADMIN/DIR pueden ver la cola completa.",
        });
      }

      // Filtros que dependen del scope. MINE incluye prescriberId=user.id;
      // TEAM/ALL lo dejan abierto a quien tenga el rol.
      const isPersonalScope = filters.scope === "MINE";

      function isEnabled(type: TaskType): boolean {
        if (filters.types && filters.types.length > 0 && !filters.types.includes(type)) {
          return false;
        }
        // En scope ALL, mostramos TODAS las fuentes; el usuario admin/DIR las ve aunque
        // no tenga el rol clínico específico (vista supervisora).
        if (filters.scope === "ALL") return true;
        return userHasAnyRole(userRoles, TASK_REQUIRED_ROLES[type]);
      }

      // ═══════════════════════════════════════════════════════════════════════
      // BASE V1 (6 fuentes)
      // ═══════════════════════════════════════════════════════════════════════

      const rxToSign = isEnabled("PRESCRIPTION_TO_SIGN")
        ? await prisma.prescription.findMany({
            where: {
              organizationId: orgId,
              status: "DRAFT",
              ...(isPersonalScope ? { prescriberId: user.id } : {}),
            },
            select: { id: true, prescribedAt: true, notes: true, patientId: true },
            orderBy: { prescribedAt: "asc" },
            take: 100,
          })
        : [];

      const rxToDispense = isEnabled("PRESCRIPTION_TO_DISPENSE")
        ? await prisma.prescription.findMany({
            where: { organizationId: orgId, status: "SIGNED" },
            select: { id: true, signedAt: true, prescribedAt: true, patientId: true },
            orderBy: { signedAt: "asc" },
            take: 100,
          })
        : [];

      const triages = isEnabled("TRIAGE_IN_PROGRESS")
        ? await prisma.triageEvaluation.findMany({
            where: {
              organizationId: orgId,
              ...(tenant.establishmentId ? { establishmentId: tenant.establishmentId } : {}),
              status: "IN_PROGRESS",
            },
            select: {
              id: true,
              startedAt: true,
              patientId: true,
              assignedLevel: { select: { name: true } },
            },
            orderBy: { startedAt: "asc" },
            take: 100,
          })
        : [];

      const labs = isEnabled("LAB_TO_PROCESS")
        ? await prisma.labOrder.findMany({
            where: { organizationId: orgId, status: { in: ["ORDERED", "COLLECTED"] } },
            select: { id: true, orderedAt: true, patientId: true },
            orderBy: { orderedAt: "asc" },
            take: 100,
          })
        : [];

      const labsToValidate = isEnabled("LAB_TO_VALIDATE")
        ? await prisma.labOrder.findMany({
            where: { organizationId: orgId, status: "RESULTED" },
            select: { id: true, orderedAt: true, patientId: true },
            orderBy: { orderedAt: "asc" },
            take: 100,
          })
        : [];

      const images = isEnabled("IMAGING_TO_REPORT")
        ? await prisma.imagingOrder.findMany({
            where: { organizationId: orgId, status: "COMPLETED" },
            select: { id: true, orderedAt: true, patientId: true },
            orderBy: { orderedAt: "asc" },
            take: 100,
          })
        : [];

      const imagesToValidate = isEnabled("IMAGING_TO_VALIDATE")
        ? await prisma.imagingOrder.findMany({
            where: { organizationId: orgId, status: "REPORTED" },
            select: { id: true, orderedAt: true, patientId: true },
            orderBy: { orderedAt: "asc" },
            take: 100,
          })
        : [];

      const meds = isEnabled("MED_TO_ADMINISTER")
        ? await prisma.medicationAdministration.findMany({
            where: {
              organizationId: orgId,
              status: "SCHEDULED",
              administeredAt: { lte: new Date(now.getTime() + 4 * 60 * 60_000) },
            },
            select: { id: true, administeredAt: true, prescriptionItemId: true },
            orderBy: { administeredAt: "asc" },
            take: 100,
          })
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // SPRINT A — Documentos NTEC (queries raw sobre schema `ece`)
      // ═══════════════════════════════════════════════════════════════════════

      const ntecQuery = async (
        type: TaskType,
        tipoCode: string,
        estadoCode: string,
      ): Promise<NtecDocRow[]> => {
        if (!isEnabled(type)) return [];
        return prisma.$queryRawUnsafe<NtecDocRow[]>(
          buildNtecQuery(tipoCode, estadoCode),
          tipoCode,
          estadoCode,
        );
      };

      const [
        hcDocs,
        epicrisisDocs,
        consentMedDocs,
        ordIngDocs,
        atnEmergDocs,
        rriDocs,
        isssDocs,
        consentQxDocs,
      ] = await Promise.all([
        ntecQuery("HC_TO_SIGN", "HC", "borrador"),
        ntecQuery("EPICRISIS_TO_SIGN", "EPICRISIS", "borrador"),
        ntecQuery("MEDICAL_CONSENT_PENDING", "CONSENT_MED", "borrador"),
        ntecQuery("ORDEN_INGRESO_PENDING", "ORD_ING", "borrador"),
        ntecQuery("ATENCION_EMERGENCIA_PENDING", "ATN_EMERG", "borrador"),
        ntecQuery("RRI_PENDING", "RRI", "pendiente_respuesta"),
        ntecQuery("ISSS_CERT_PENDING", "CERT_INC", "borrador"),
        ntecQuery("SURGERY_CONSENT_PENDING", "CONSENT_QX", "borrador"),
      ]);

      // EVOLUTION_TO_WRITE: encuentros INPATIENT activos >24h sin evolución del día
      const evolutionsPending: Array<{ id: string; admittedAt: Date; patientId: string }> =
        isEnabled("EVOLUTION_TO_WRITE")
          ? await prisma.encounter.findMany({
              where: {
                organizationId: orgId,
                dischargedAt: null,
                admissionType: { in: ["EMERGENCY", "SCHEDULED"] },
                admittedAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) },
              },
              select: { id: true, admittedAt: true, patientId: true },
              take: 100,
            })
          : [];

      // VALORACION_INICIAL_PENDING: episodio hospitalario sin valoración ENF firmada
      const valoracionPending: Array<{
        id: string;
        episodio_hospitalario_id: string;
        admitted_at: Date;
        paciente_id: string;
      }> = isEnabled("VALORACION_INICIAL_PENDING")
        ? await prisma.$queryRawUnsafe(`
            SELECT eh.id::text AS id,
                   eh.id::text AS episodio_hospitalario_id,
                   eh.fecha_ingreso AS admitted_at,
                   ea.paciente_id::text AS paciente_id
            FROM ece.episodio_hospitalario eh
            JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_atencion_id
            LEFT JOIN ece.valoracion_inicial_enfermeria vie
              ON vie.episodio_hospitalario_id = eh.id
              AND vie.estado_registro IN ('firmado','validado')
            WHERE eh.fecha_egreso IS NULL
              AND vie.id IS NULL
              AND eh.fecha_ingreso > now() - interval '7 days'
            ORDER BY eh.fecha_ingreso ASC
            LIMIT 100
          `)
        : [];

      // ECE_RECTIFICACION_PENDING: rectificaciones recientes (heurística — el modelo
      // no tiene estado pendiente/aprobada explícito; mostramos las últimas 24h
      // que el DIR debe revisar).
      const rectifPending: Array<{ id: string; ejecutada_en: Date; paciente_id: string }> =
        isEnabled("ECE_RECTIFICACION_PENDING")
          ? await prisma.$queryRawUnsafe(`
              SELECT r.id::text AS id,
                     r.ejecutada_en,
                     di.paciente_id::text AS paciente_id
              FROM ece.rectificacion r
              JOIN ece.documento_instancia di ON di.id = r.instancia_id
              WHERE r.ejecutada_en > now() - interval '7 days'
              ORDER BY r.ejecutada_en DESC
              LIMIT 100
            `)
          : [];

      // ECE_DOC_TO_CERTIFY: documentos en estado 'validado' que esperan certificación DIR
      const docsToCertify = await ntecQuery("ECE_DOC_TO_CERTIFY", "HC", "validado");

      // ═══════════════════════════════════════════════════════════════════════
      // SPRINT B — JCI / Seguridad del paciente
      // ═══════════════════════════════════════════════════════════════════════

      // VERBAL_ORDER_TO_CONFIRM: ece.verbal_order estado='dictada' + confirmado_en NULL
      const verbalOrders: Array<{ id: string; dictado_en: Date; paciente_id: string }> =
        isEnabled("VERBAL_ORDER_TO_CONFIRM")
          ? await prisma.$queryRawUnsafe(`
              SELECT id::text AS id, dictado_en, paciente_id::text AS paciente_id
              FROM ece.verbal_order
              WHERE estado = 'dictada' AND confirmado_en IS NULL
              ORDER BY dictado_en ASC
              LIMIT 100
            `)
          : [];

      // CRITICAL_RESULT_TO_NOTIFY: ece.critical_result_notification sin notificación
      const criticalResults: Array<{ id: string; detectado_en: Date; paciente_id: string }> =
        isEnabled("CRITICAL_RESULT_TO_NOTIFY")
          ? await (prisma.$queryRawUnsafe(`
              SELECT id::text AS id,
                     detectado_en,
                     paciente_id::text AS paciente_id
              FROM ece.critical_result_notification
              WHERE notificado_en IS NULL
              ORDER BY detectado_en ASC
              LIMIT 100
            `) as Promise<Array<{ id: string; detectado_en: Date; paciente_id: string }>>).catch(
              () => [] as Array<{ id: string; detectado_en: Date; paciente_id: string }>,
            )
          : [];

      // DOUBLE_CHECK_PENDING: med admin high-alert sin doubleCheckBy
      const doubleCheck = isEnabled("DOUBLE_CHECK_PENDING")
        ? await prisma.medicationAdministration.findMany({
            where: {
              organizationId: orgId,
              status: "SCHEDULED",
              doubleCheckBy: null,
              administeredAt: { lte: new Date(now.getTime() + 60 * 60_000) },
            },
            select: { id: true, administeredAt: true, prescriptionItemId: true },
            orderBy: { administeredAt: "asc" },
            take: 100,
          })
        : [];

      // WHO_CHECKLIST_INCOMPLETE: cirugía IN_PROGRESS sin signIn/timeOut/signOut
      const whoIncomplete = isEnabled("WHO_CHECKLIST_INCOMPLETE")
        ? await prisma.surgeryCase.findMany({
            where: {
              organizationId: orgId,
              status: "IN_PROGRESS",
              OR: [{ signInAt: null }, { timeOutAt: null }, { signOutAt: null }],
            },
            select: {
              id: true,
              scheduledStart: true,
              patientId: true,
              procedureDescription: true,
            },
            orderBy: { scheduledStart: "asc" },
            take: 50,
          })
        : [];

      // FALL_REPORT_PENDING: caídas no notificadas a JCI
      type FallRow = { id: string; fecha_hora: Date; episodio_id: string };
      const fallsPending: FallRow[] = isEnabled("FALL_REPORT_PENDING")
        ? await (prisma.$queryRawUnsafe(`
              SELECT id::text AS id, fecha_hora, episodio_id::text AS episodio_id
              FROM ece.fall_event
              WHERE notificado_jci = false
                AND lesion_resultante IN ('moderada','grave','muy_grave')
              ORDER BY fecha_hora ASC
              LIMIT 100
            `) as Promise<FallRow[]>).catch(() => [] as FallRow[])
        : [];

      // MORSE_REEVALUATE: valoraciones con escala_morse > 45 (alto riesgo) sin reeval 24h
      type MorseRow = {
        id: string;
        registrado_en: Date;
        episodio_hospitalario_id: string;
      };
      const morseHigh: MorseRow[] = isEnabled("MORSE_REEVALUATE")
        ? await (prisma.$queryRawUnsafe(`
            SELECT vie.id::text AS id,
                   vie.registrado_en,
                   vie.episodio_hospitalario_id::text AS episodio_hospitalario_id
            FROM ece.valoracion_inicial_enfermeria vie
            JOIN ece.episodio_hospitalario eh ON eh.id = vie.episodio_hospitalario_id
            WHERE vie.escala_morse > 45
              AND eh.fecha_egreso IS NULL
              AND vie.registrado_en < now() - interval '24 hours'
            ORDER BY vie.registrado_en ASC
            LIMIT 100
          `) as Promise<MorseRow[]>).catch(() => [] as MorseRow[])
        : [];

      // WRISTBAND_MISSING: encounter activo INPATIENT/EMERGENCY sin gsrn registrado.
      // Heurística: chequeamos asignacion_cama sin un valor de pulsera bedside.
      const wristbandMissing = isEnabled("WRISTBAND_MISSING")
        ? await prisma.encounter.findMany({
            where: {
              organizationId: orgId,
              dischargedAt: null,
              admissionType: { in: ["EMERGENCY", "SCHEDULED"] },
              admittedAt: {
                gte: new Date(now.getTime() - 60 * 60_000), // últimas 1h
              },
            },
            select: { id: true, admittedAt: true, patientId: true },
            take: 100,
          })
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // SPRINT C — Quirófano
      // ═══════════════════════════════════════════════════════════════════════

      // SURGERY_PREOP_PENDING: cirugía próximas 24h sin preopNotes
      const preopPending = isEnabled("SURGERY_PREOP_PENDING")
        ? await prisma.surgeryCase.findMany({
            where: {
              organizationId: orgId,
              status: "SCHEDULED",
              scheduledStart: {
                gte: now,
                lte: new Date(now.getTime() + 24 * 60 * 60_000),
              },
              OR: [{ preopNotes: null }, { preopNotes: "" }],
            },
            select: {
              id: true,
              scheduledStart: true,
              patientId: true,
              procedureDescription: true,
            },
            orderBy: { scheduledStart: "asc" },
            take: 50,
          })
        : [];

      // ANESTHESIA_RECORD_OPEN: cirugía con actualEnd seteado pero anesthesiaEndAt NULL
      const anesthOpen = isEnabled("ANESTHESIA_RECORD_OPEN")
        ? await prisma.surgeryCase.findMany({
            where: {
              organizationId: orgId,
              actualEnd: { not: null },
              anesthesiaEndAt: null,
              anesthesiaStartAt: { not: null },
            },
            select: {
              id: true,
              actualEnd: true,
              patientId: true,
              procedureDescription: true,
            },
            orderBy: { actualEnd: "asc" },
            take: 50,
          })
        : [];

      // URPA_DISCHARGE_PENDING: registros URPA en borrador (heurística — no hay campo
      // explícito "criterios cumplidos"). El médico revisa y completa el egreso.
      type UrpaRow = { id: string; registrado_en: Date; episodio_id: string };
      const urpaPending: UrpaRow[] = isEnabled("URPA_DISCHARGE_PENDING")
        ? await (prisma.$queryRawUnsafe(`
              SELECT u.id::text AS id,
                     u.registrado_en,
                     u.episodio_id::text AS episodio_id
              FROM ece.urpa_recovery u
              WHERE u.estado_registro = 'borrador'
                AND u.registrado_en > now() - interval '2 days'
              ORDER BY u.registrado_en ASC
              LIMIT 50
            `) as Promise<UrpaRow[]>).catch(() => [] as UrpaRow[])
        : [];

      // SURGERY_NOTE_PENDING: cirugía con actualEnd seteado pero postopNotes vacío
      const surgNotePending = isEnabled("SURGERY_NOTE_PENDING")
        ? await prisma.surgeryCase.findMany({
            where: {
              organizationId: orgId,
              actualEnd: { not: null },
              OR: [{ postopNotes: null }, { postopNotes: "" }],
            },
            select: {
              id: true,
              actualEnd: true,
              patientId: true,
              procedureDescription: true,
            },
            orderBy: { actualEnd: "asc" },
            take: 50,
          })
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 2 — Camas / Flujo paciente (4)
      // ═══════════════════════════════════════════════════════════════════════

      // BED_TO_CLEAN: Bed.status=DIRTY
      const bedsToClean = isEnabled("BED_TO_CLEAN")
        ? await prisma.bed.findMany({
            where: {
              organizationId: orgId,
              ...(tenant.establishmentId ? { establishmentId: tenant.establishmentId } : {}),
              status: "DIRTY",
              active: true,
            },
            select: { id: true, code: true, updatedAt: true },
            orderBy: { updatedAt: "asc" },
            take: 100,
          })
        : [];

      // BED_TO_RELEASE: InpatientAdmission status=DISCHARGE_PENDING (alta firmada sin liberar)
      const bedsToRelease = isEnabled("BED_TO_RELEASE")
        ? await prisma.inpatientAdmission.findMany({
            where: {
              organizationId: orgId,
              status: "DISCHARGE_PENDING",
              dischargedAt: null,
              deletedAt: null,
            },
            select: { id: true, updatedAt: true, patientId: true, bedId: true },
            orderBy: { updatedAt: "asc" },
            take: 100,
          })
        : [];

      // ADMISSION_VITALS_MISSING: InpatientAdmission ACTIVE sin signos vitales en 30min
      const admissionsNoVitals = isEnabled("ADMISSION_VITALS_MISSING")
        ? await prisma.inpatientAdmission.findMany({
            where: {
              organizationId: orgId,
              status: "ACTIVE",
              physicalAdmittedAt: {
                gte: new Date(now.getTime() - 12 * 60 * 60_000), // últimas 12h
                lte: new Date(now.getTime() - 30 * 60_000),       // hace >30min
              },
              vitalsLog: { none: {} }, // sin ningún registro de vitals
            },
            select: { id: true, physicalAdmittedAt: true, patientId: true },
            orderBy: { physicalAdmittedAt: "asc" },
            take: 100,
          })
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 2 — Consulta externa (3)
      // ═══════════════════════════════════════════════════════════════════════

      // APPOINTMENT_TO_CHECKIN: cita próxima sin check-in (entre -30m y +120m)
      const appointmentsToCheckin = isEnabled("APPOINTMENT_TO_CHECKIN")
        ? await prisma.outpatientAppointment.findMany({
            where: {
              organizationId: orgId,
              ...(tenant.establishmentId ? { establishmentId: tenant.establishmentId } : {}),
              status: { in: ["SCHEDULED", "CONFIRMED"] },
              scheduledAt: {
                gte: new Date(now.getTime() - 30 * 60_000),
                lte: new Date(now.getTime() + 120 * 60_000),
              },
              deletedAt: null,
            },
            select: { id: true, scheduledAt: true, patientId: true, reason: true },
            orderBy: { scheduledAt: "asc" },
            take: 100,
          })
        : [];

      // CONSULTATION_NOTE_PENDING: cita COMPLETED >2h sin nota EHR
      const consultsNoNote = isEnabled("CONSULTATION_NOTE_PENDING")
        ? await prisma.outpatientAppointment.findMany({
            where: {
              organizationId: orgId,
              status: "COMPLETED",
              scheduledAt: {
                gte: new Date(now.getTime() - 7 * 24 * 60 * 60_000), // semana
                lte: new Date(now.getTime() - 2 * 60 * 60_000),       // >2h
              },
              consultations: { none: {} },
              deletedAt: null,
            },
            select: { id: true, scheduledAt: true, patientId: true, reason: true },
            orderBy: { scheduledAt: "asc" },
            take: 100,
          })
        : [];

      // APPOINTMENT_NO_SHOW_FOLLOWUP: NO_SHOW últimas 24h
      const appointmentsNoShow = isEnabled("APPOINTMENT_NO_SHOW_FOLLOWUP")
        ? await prisma.outpatientAppointment.findMany({
            where: {
              organizationId: orgId,
              status: "NO_SHOW",
              scheduledAt: {
                gte: new Date(now.getTime() - 24 * 60 * 60_000),
              },
              deletedAt: null,
            },
            select: { id: true, scheduledAt: true, patientId: true, reason: true },
            orderBy: { scheduledAt: "asc" },
            take: 100,
          })
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 2 — Estudios pendientes (3)
      // ═══════════════════════════════════════════════════════════════════════

      // RESPIRATORY_ORDER_PENDING: RespiratoryOrder ACTIVE en última hora
      const respPending = isEnabled("RESPIRATORY_ORDER_PENDING")
        ? await prisma.respiratoryOrder.findMany({
            where: {
              organizationId: orgId,
              status: "ACTIVE",
              createdAt: { gte: new Date(now.getTime() - 60 * 60_000) },
            },
            select: { id: true, createdAt: true, patientId: true },
            orderBy: { createdAt: "asc" },
            take: 100,
          }).catch(() => [])
        : [];

      // NUTRITION_ORDER_PENDING: NutritionOrder ORDERED (pendiente aprobación)
      const nutriPending = isEnabled("NUTRITION_ORDER_PENDING")
        ? await prisma.nutritionOrder.findMany({
            where: { organizationId: orgId, status: "ORDERED" },
            select: { id: true, createdAt: true, patientId: true },
            orderBy: { createdAt: "asc" },
            take: 100,
          }).catch(() => [])
        : [];

      // STUDY_TO_SCHEDULE: ImagingOrder ORDERED sin SCHEDULED
      const studiesToSchedule = isEnabled("STUDY_TO_SCHEDULE")
        ? await prisma.imagingOrder.findMany({
            where: { organizationId: orgId, status: "ORDERED" },
            select: { id: true, orderedAt: true, patientId: true },
            orderBy: { orderedAt: "asc" },
            take: 100,
          })
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 2 — Maternidad (3) — queries raw sobre schema ece (resilientes)
      // ═══════════════════════════════════════════════════════════════════════

      type ParteRow = { id: string; ultima_actualizacion: Date; paciente_id: string };
      const partogramaOverdue: ParteRow[] = isEnabled("PARTOGRAMA_OVERDUE")
        ? await (prisma.$queryRawUnsafe(`
            SELECT p.id::text AS id,
                   p.actualizado_en AS ultima_actualizacion,
                   ea.paciente_id::text AS paciente_id
            FROM ece.partograma p
            JOIN ece.episodio_atencion ea ON ea.id = p.episodio_id
            WHERE p.estado_registro = 'borrador'
              AND p.actualizado_en < now() - interval '30 minutes'
            ORDER BY p.actualizado_en ASC
            LIMIT 100
          `) as Promise<ParteRow[]>).catch(() => [] as ParteRow[])
        : [];

      type RnRow = { id: string; nacimiento_en: Date; paciente_id: string };
      const rnApgarPending: RnRow[] = isEnabled("RN_APGAR_PENDING")
        ? await (prisma.$queryRawUnsafe(`
            SELECT rn.id::text AS id,
                   rn.fecha_nacimiento AS nacimiento_en,
                   rn.paciente_id::text AS paciente_id
            FROM ece.atencion_rn rn
            WHERE (rn.apgar_1min IS NULL OR rn.apgar_5min IS NULL)
              AND rn.fecha_nacimiento > now() - interval '10 minutes'
            ORDER BY rn.fecha_nacimiento ASC
            LIMIT 50
          `) as Promise<RnRow[]>).catch(() => [] as RnRow[])
        : [];

      type NrpRow = { id: string; evento_en: Date; paciente_id: string };
      const nrpPostevent: NrpRow[] = isEnabled("NRP_POSTEVENT_DEBRIEF")
        ? await (prisma.$queryRawUnsafe(`
            SELECT n.id::text AS id,
                   n.fecha_hora AS evento_en,
                   rn.paciente_id::text AS paciente_id
            FROM ece.reanimacion_neonatal n
            LEFT JOIN ece.atencion_rn rn ON rn.id = n.atencion_rn_id
            WHERE n.debrief_completado = false
              AND n.fecha_hora < now() - interval '24 hours'
              AND n.fecha_hora > now() - interval '7 days'
            ORDER BY n.fecha_hora ASC
            LIMIT 50
          `) as Promise<NrpRow[]>).catch(() => [] as NrpRow[])
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 2 — Banco de sangre (2)
      // ═══════════════════════════════════════════════════════════════════════

      // BLOOD_VERIFY_PENDING: TransfusionRequest APPROVED sin Transfusion asociada
      const bloodVerifyPending = isEnabled("BLOOD_VERIFY_PENDING")
        ? await prisma.transfusionRequest.findMany({
            where: {
              organizationId: orgId,
              status: "APPROVED",
            },
            select: { id: true, createdAt: true, patientId: true },
            orderBy: { createdAt: "asc" },
            take: 100,
          }).catch(() => [])
        : [];

      // BLOOD_REACTION_REPORT: Transfusion con adverseReactions JSONB no nulo sin reporte
      // Heurística: status=COMPLETED + adverseReactions IS NOT NULL en últimas 7d
      type BloodReactRow = {
        id: string;
        started_at: Date;
        encounter_id: string;
      };
      const bloodReactPending: BloodReactRow[] = isEnabled("BLOOD_REACTION_REPORT")
        ? await (prisma.$queryRawUnsafe(`
            SELECT id::text AS id,
                   "startedAt" AS started_at,
                   "encounterId"::text AS encounter_id
            FROM "Transfusion"
            WHERE "organizationId" = $1::uuid
              AND "adverseReactions" IS NOT NULL
              AND "completedAt" > now() - interval '7 days'
            ORDER BY "startedAt" ASC
            LIMIT 50
          `, orgId) as Promise<BloodReactRow[]>).catch(() => [] as BloodReactRow[])
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 3 — MPI / Identidad / Privacidad
      // ═══════════════════════════════════════════════════════════════════════

      // PATIENT_NN_TO_RESOLVE: pacientes isUnknown=true con encounter >48h
      const nnToResolve = isEnabled("PATIENT_NN_TO_RESOLVE")
        ? await prisma.patient.findMany({
            where: {
              organizationId: orgId,
              isUnknown: true,
              active: true,
              createdAt: { lt: new Date(now.getTime() - 48 * 60 * 60_000) },
            },
            select: { id: true, firstName: true, lastName: true, mrn: true, createdAt: true },
            orderBy: { createdAt: "asc" },
            take: 50,
          })
        : [];

      // ARCO_REQUEST_PENDING: solicitud ARCO con estado=PENDIENTE
      type ArcoRow = { id: string; creado_en: Date; paciente_id: string };
      const arcoPending: ArcoRow[] = isEnabled("ARCO_REQUEST_PENDING")
        ? await (prisma.$queryRawUnsafe(`
            SELECT id::text AS id, creado_en, paciente_id::text AS paciente_id
            FROM ece.solicitud_arco
            WHERE estado = 'PENDIENTE' AND organizacion_id = $1::uuid
            ORDER BY creado_en ASC LIMIT 100
          `, orgId) as Promise<ArcoRow[]>).catch(() => [] as ArcoRow[])
        : [];

      // MPI_MERGE_PENDING: EcePatientMerge.estado=PENDIENTE
      const mpiMergePending = isEnabled("MPI_MERGE_PENDING")
        ? await prisma.ecePatientMerge.findMany({
            where: { organizationId: orgId, estado: "PENDIENTE" },
            select: {
              id: true,
              creadoEn: true,
              canonicalPatientId: true,
              mergedPatientId: true,
            },
            orderBy: { creadoEn: "asc" },
            take: 50,
          })
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 3 — Farmacovigilancia / Calidad (activados: ece.farmacovigilancia_incident)
      // ═══════════════════════════════════════════════════════════════════════

      type FarmaRow = {
        id: string;
        detected_at: Date;
        patient_id: string | null;
        severity: string;
        description: string;
      };
      // ADR: HIGH/CRITICAL severity (reacciones adversas — reporte regulatorio)
      const adrPending: FarmaRow[] = isEnabled("ADR_REPORT_PENDING")
        ? await (prisma.$queryRawUnsafe(`
            SELECT id::text AS id,
                   detected_at,
                   patient_id::text AS patient_id,
                   severity,
                   COALESCE(payload->>'description', payload->>'reason', 'Reacción adversa') AS description
            FROM ece.farmacovigilancia_incident
            WHERE status = 'PENDIENTE' AND severity IN ('HIGH','CRITICAL')
            ORDER BY detected_at ASC LIMIT 100
          `) as Promise<FarmaRow[]>).catch(() => [] as FarmaRow[])
        : [];

      // INCIDENT: LOW/MEDIUM severity (revisión de calidad rutinaria)
      const incidentToReview: FarmaRow[] = isEnabled("INCIDENT_TO_REVIEW")
        ? await (prisma.$queryRawUnsafe(`
            SELECT id::text AS id,
                   detected_at,
                   patient_id::text AS patient_id,
                   severity,
                   COALESCE(payload->>'description', payload->>'reason', 'Evento adverso') AS description
            FROM ece.farmacovigilancia_incident
            WHERE status = 'PENDIENTE' AND severity IN ('LOW','MEDIUM')
            ORDER BY detected_at ASC LIMIT 100
          `) as Promise<FarmaRow[]>).catch(() => [] as FarmaRow[])
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 3 — Cold chain (1 activa)
      // ═══════════════════════════════════════════════════════════════════════

      type ColdRow = { id: string; ocurrido_en: Date; equipo_id: string };
      const coldChainBreach: ColdRow[] = isEnabled("COLD_CHAIN_BREACH")
        ? await (prisma.$queryRawUnsafe(`
            SELECT id::text AS id,
                   COALESCE(resuelta_en, creada_en) AS ocurrido_en,
                   equipo_id::text AS equipo_id
            FROM ece.cold_chain_alerta
            WHERE resuelta = false
            ORDER BY creada_en ASC LIMIT 50
          `) as Promise<ColdRow[]>).catch(() => [] as ColdRow[])
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 3 — Equipos / Mantenimiento (2 activas, 1 placeholder)
      // ═══════════════════════════════════════════════════════════════════════

      // EQUIPMENT_CALIBRATION_DUE: certificación vencida o próxima (<30d)
      const calibDue = isEnabled("EQUIPMENT_CALIBRATION_DUE")
        ? await prisma.biomedicalEquipment.findMany({
            where: {
              organizationId: orgId,
              active: true,
              certificationExpiresAt: {
                lte: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
              },
            },
            select: { id: true, assetTag: true, name: true, certificationExpiresAt: true },
            orderBy: { certificationExpiresAt: "asc" },
            take: 50,
          })
        : [];

      // EQUIPMENT_OUT_OF_SERVICE_RETURN: UNDER_MAINTENANCE/BROKEN/OUT_OF_SERVICE >7d
      const equipOutOfService = isEnabled("EQUIPMENT_OUT_OF_SERVICE_RETURN")
        ? await prisma.biomedicalEquipment.findMany({
            where: {
              organizationId: orgId,
              active: true,
              status: { in: ["UNDER_MAINTENANCE", "BROKEN", "OUT_OF_SERVICE"] },
              updatedAt: {
                lt: new Date(now.getTime() - 7 * 24 * 60 * 60_000),
              },
            },
            select: { id: true, assetTag: true, name: true, updatedAt: true, status: true },
            orderBy: { updatedAt: "asc" },
            take: 50,
          })
        : [];

      // EQUIPMENT_MAINTENANCE_DUE: PmSchedule.status=PLANNED + scheduledAt vencido o en 7d
      const maintDue = isEnabled("EQUIPMENT_MAINTENANCE_DUE")
        ? await prisma.pmSchedule.findMany({
            where: {
              status: "PLANNED",
              scheduledAt: { lte: new Date(now.getTime() + 7 * 24 * 60 * 60_000) },
              equipment: { organizationId: orgId, active: true },
            },
            select: {
              id: true,
              scheduledAt: true,
              equipment: { select: { id: true, assetTag: true, name: true } },
            },
            orderBy: { scheduledAt: "asc" },
            take: 50,
          })
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 3 — Inventario (2 activas)
      // ═══════════════════════════════════════════════════════════════════════

      // INVENTORY_LOW_STOCK: StockLot.quantityOnHand < StockItem.reorderLevel
      type LowStockRow = {
        id: string;
        lot_number: string;
        item_name: string;
        quantity_on_hand: number;
        reorder_level: number;
        updated_at: Date;
      };
      const lowStock: LowStockRow[] = isEnabled("INVENTORY_LOW_STOCK")
        ? await (prisma.$queryRawUnsafe(`
            SELECT sl.id::text AS id,
                   sl."lotNumber" AS lot_number,
                   si.name AS item_name,
                   sl."quantityOnHand"::float8 AS quantity_on_hand,
                   COALESCE(si."reorderLevel", 0)::float8 AS reorder_level,
                   sl."updatedAt" AS updated_at
            FROM "StockLot" sl
            JOIN "StockItem" si ON si.id = sl."itemId"
            WHERE sl."organizationId" = $1::uuid
              AND sl.active = true
              AND si."reorderLevel" IS NOT NULL
              AND sl."quantityOnHand" < si."reorderLevel"
            ORDER BY (si."reorderLevel" - sl."quantityOnHand") DESC
            LIMIT 50
          `, orgId) as Promise<LowStockRow[]>).catch(() => [] as LowStockRow[])
        : [];

      // INVENTORY_EXPIRING_SOON: StockLot.expiryDate < now + 30d con qty > 0
      const expiringSoon = isEnabled("INVENTORY_EXPIRING_SOON")
        ? await prisma.stockLot.findMany({
            where: {
              organizationId: orgId,
              active: true,
              quantityOnHand: { gt: 0 },
              expiryDate: {
                gte: now,
                lte: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
              },
            },
            select: { id: true, lotNumber: true, expiryDate: true, item: { select: { name: true } } },
            orderBy: { expiryDate: "asc" },
            take: 50,
          })
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 3 — GS1 / Logística (2 activadas + 2 placeholder)
      // ═══════════════════════════════════════════════════════════════════════

      // GS1_INBOUND_PENDING: placeholder (sin tabla ece.recepcion_inbound aún)
      const gs1Inbound: Array<{ id: string; createdAt: Date }> = [];

      // GS1_TRANSFER_PENDING: ece.transferencia_inventario en programado/en_transito
      type TransferRow = { id: string; fecha_envio: Date; origen_gln: string; destino_gln: string };
      const gs1Transfer: TransferRow[] = isEnabled("GS1_TRANSFER_PENDING")
        ? await (prisma.$queryRawUnsafe(`
            SELECT id::text AS id,
                   COALESCE(fecha_envio, NOW()) AS fecha_envio,
                   origen_gln,
                   destino_gln
            FROM ece.transferencia_inventario
            WHERE estado IN ('programado','en_transito')
            ORDER BY fecha_envio ASC NULLS FIRST LIMIT 50
          `) as Promise<TransferRow[]>).catch(() => [] as TransferRow[])
        : [];

      // GS1_RETURN_PENDING: ece.devolucion_inventario en borrador
      type ReturnRow = { id: string; registrado_en: Date };
      const gs1Return: ReturnRow[] = isEnabled("GS1_RETURN_PENDING")
        ? await (prisma.$queryRawUnsafe(`
            SELECT id::text AS id, registrado_en
            FROM ece.devolucion_inventario
            WHERE estado_registro = 'borrador'
              AND registrado_en > now() - interval '30 days'
            ORDER BY registrado_en ASC LIMIT 50
          `) as Promise<ReturnRow[]>).catch(() => [] as ReturnRow[])
        : [];

      // GS1_RECALL_TO_PURGE: placeholder (no hay tabla específica de recalls)
      const gs1Recall: Array<{ id: string; createdAt: Date }> = [];

      // ═══════════════════════════════════════════════════════════════════════
      // OLA 3 — Defunciones / Reclamos (3 activas)
      // ═══════════════════════════════════════════════════════════════════════

      // DEATH_CERT_PENDING: Encounter dischargeType=DEATH sin DeathCertificate
      type DeathPendingRow = {
        encounter_id: string;
        discharged_at: Date;
        patient_id: string;
      };
      const deathCertPending: DeathPendingRow[] = isEnabled("DEATH_CERT_PENDING")
        ? await (prisma.$queryRawUnsafe(`
            SELECT e.id::text AS encounter_id,
                   e."dischargedAt" AS discharged_at,
                   e."patientId"::text AS patient_id
            FROM "Encounter" e
            LEFT JOIN "DeathCertificate" dc ON dc."patientId" = e."patientId"
            WHERE e."organizationId" = $1::uuid
              AND e."dischargeType" = 'DEATH'::"DischargeType"
              AND e."dischargedAt" IS NOT NULL
              AND e."dischargedAt" > now() - interval '7 days'
              AND dc.id IS NULL
            ORDER BY e."dischargedAt" ASC
            LIMIT 50
          `, orgId) as Promise<DeathPendingRow[]>).catch(() => [] as DeathPendingRow[])
        : [];

      // CLAIM_REJECTED_TO_APPEAL: InsuranceClaim status=REJECTED
      const claimsRejected = isEnabled("CLAIM_REJECTED_TO_APPEAL")
        ? await prisma.insuranceClaim.findMany({
            where: {
              status: "REJECTED",
              invoice: { organizationId: orgId },
              respondedAt: {
                gte: new Date(now.getTime() - 30 * 24 * 60 * 60_000),
              },
            },
            select: { id: true, claimNumber: true, respondedAt: true, rejectionReason: true },
            orderBy: { respondedAt: "asc" },
            take: 50,
          })
        : [];

      // CLAIM_PENDING_SUBMISSION: facturas últimos 7d con PatientCoverage activa
      // del paciente del encounter, sin InsuranceClaim asociado.
      type ClaimPendingRow = {
        id: string;
        created_at: Date;
        insurer_name: string;
      };
      const claimsPendingSubmission: ClaimPendingRow[] = isEnabled("CLAIM_PENDING_SUBMISSION")
        ? await (prisma.$queryRawUnsafe(`
            SELECT inv.id::text AS id,
                   inv."createdAt" AS created_at,
                   ins."tradeName" AS insurer_name
            FROM "Invoice" inv
            JOIN "Encounter" e ON e.id = inv."encounterId"
            JOIN "PatientCoverage" pc
              ON pc."patientId" = e."patientId"
              AND pc.active = true
              AND (pc."validTo" IS NULL OR pc."validTo" >= now())
            JOIN "Insurer" ins ON ins.id = pc."insurerId"
            LEFT JOIN "InsuranceClaim" ic ON ic."invoiceId" = inv.id
            WHERE inv."organizationId" = $1::uuid
              AND inv."createdAt" > now() - interval '7 days'
              AND ic.id IS NULL
            ORDER BY inv."createdAt" ASC LIMIT 50
          `, orgId) as Promise<ClaimPendingRow[]>).catch(() => [] as ClaimPendingRow[])
        : [];

      // ═══════════════════════════════════════════════════════════════════════
      // Enriquecer Patient en batch único
      // ═══════════════════════════════════════════════════════════════════════

      const patientIds = new Set<string>([
        ...rxToSign.map((r) => r.patientId),
        ...rxToDispense.map((r) => r.patientId),
        ...triages.map((t) => t.patientId),
        ...labs.map((l) => l.patientId),
        ...labsToValidate.map((l) => l.patientId),
        ...images.map((i) => i.patientId),
        ...imagesToValidate.map((i) => i.patientId),
        ...evolutionsPending.map((e) => e.patientId),
        ...whoIncomplete.map((s) => s.patientId),
        ...wristbandMissing.map((e) => e.patientId),
        ...preopPending.map((s) => s.patientId),
        ...anesthOpen.map((s) => s.patientId),
        ...surgNotePending.map((s) => s.patientId),
        // Ola 2
        ...bedsToRelease.map((a) => a.patientId),
        ...admissionsNoVitals.map((a) => a.patientId),
        ...appointmentsToCheckin.map((a) => a.patientId),
        ...consultsNoNote.map((a) => a.patientId),
        ...appointmentsNoShow.map((a) => a.patientId),
        ...respPending.map((r) => r.patientId),
        ...nutriPending.map((n) => n.patientId),
        ...studiesToSchedule.map((s) => s.patientId),
        ...bloodVerifyPending.map((b) => b.patientId),
        // Ola 3
        ...nnToResolve.map((p) => p.id),
        ...deathCertPending.map((d) => d.patient_id),
      ]);
      for (const a of arcoPending) patientIds.add(a.paciente_id);
      for (const m of mpiMergePending) patientIds.add(m.canonicalPatientId);
      for (const a of adrPending) if (a.patient_id) patientIds.add(a.patient_id);
      for (const i of incidentToReview) if (i.patient_id) patientIds.add(i.patient_id);

      for (const p of partogramaOverdue) patientIds.add(p.paciente_id);
      for (const r of rnApgarPending) patientIds.add(r.paciente_id);
      for (const n of nrpPostevent) patientIds.add(n.paciente_id);

      // Patient IDs de tablas `ece` necesitan resolverse via ece.paciente → public.Patient
      // por bridge. Para simplificar, usamos las IDs raw como están (las tablas ece
      // contienen patient_id que apunta al MPI HIS).
      for (const d of hcDocs) patientIds.add(d.paciente_id);
      for (const d of epicrisisDocs) patientIds.add(d.paciente_id);
      for (const d of consentMedDocs) patientIds.add(d.paciente_id);
      for (const d of ordIngDocs) patientIds.add(d.paciente_id);
      for (const d of atnEmergDocs) patientIds.add(d.paciente_id);
      for (const d of rriDocs) patientIds.add(d.paciente_id);
      for (const d of isssDocs) patientIds.add(d.paciente_id);
      for (const d of consentQxDocs) patientIds.add(d.paciente_id);
      for (const d of docsToCertify) patientIds.add(d.paciente_id);
      for (const v of valoracionPending) patientIds.add(v.paciente_id);
      for (const r of rectifPending) patientIds.add(r.paciente_id);
      for (const v of verbalOrders) patientIds.add(v.paciente_id);
      for (const c of criticalResults) patientIds.add(c.paciente_id);

      // MedAdmin batch enrichment
      let medItemMap = new Map<
        string,
        { drugName: string; patientId: string | null }
      >();
      const allMedItemIds = [
        ...meds.map((m) => m.prescriptionItemId),
        ...doubleCheck.map((m) => m.prescriptionItemId),
      ];
      if (allMedItemIds.length > 0) {
        const items = await prisma.prescriptionItem.findMany({
          where: { id: { in: allMedItemIds } },
          select: { id: true, drugId: true, prescriptionId: true },
        });
        const [drugs, prescs] = await Promise.all([
          prisma.drug.findMany({
            where: { id: { in: items.map((i) => i.drugId) } },
            select: { id: true, brandName: true, genericName: true },
          }),
          prisma.prescription.findMany({
            where: { id: { in: items.map((i) => i.prescriptionId) } },
            select: { id: true, patientId: true },
          }),
        ]);
        const drugById = new Map(drugs.map((d) => [d.id, d.brandName ?? d.genericName]));
        const presById = new Map(prescs.map((p) => [p.id, p.patientId]));
        for (const it of items) {
          const pid = presById.get(it.prescriptionId) ?? null;
          if (pid) patientIds.add(pid);
          medItemMap.set(it.id, {
            drugName: drugById.get(it.drugId) ?? "Medicación",
            patientId: pid,
          });
        }
      }

      const patientsById = new Map<string, PatientMini>();
      if (patientIds.size > 0) {
        const patients = await prisma.patient.findMany({
          where: { id: { in: Array.from(patientIds) } },
          select: { id: true, firstName: true, lastName: true, mrn: true },
        });
        for (const p of patients) patientsById.set(p.id, p);
      }

      function getPatient(id: string | null | undefined): PatientMini | null {
        if (!id) return null;
        return patientsById.get(id) ?? null;
      }
      function fmtName(p: PatientMini | null): string | null {
        if (!p) return null;
        return `${p.firstName} ${p.lastName}`.trim() || null;
      }

      function buildTask(args: {
        type: TaskType;
        sourceId: string;
        createdAt: Date;
        patient: PatientMini | null;
        description: string;
        deepLink: string;
      }): Task {
        const age = ageInMinutes(args.createdAt, now);
        const sla = TASK_SLA_MINUTES[args.type];
        const remaining = sla === null ? null : sla - age;
        const isOverdue = remaining !== null && remaining < 0;
        return {
          id: `${args.type}:${args.sourceId}`,
          type: args.type,
          typeLabel: TASK_TYPE_LABEL[args.type],
          priority: derivePriority(age, sla),
          patientName: fmtName(args.patient),
          patientMrn: args.patient?.mrn ?? null,
          description: args.description,
          createdAt: args.createdAt,
          ageMinutes: age,
          remainingMinutes: remaining,
          isOverdue,
          deepLink: args.deepLink,
          requiredRoles: TASK_REQUIRED_ROLES[args.type],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // Mapeo a Task[]
      // ═══════════════════════════════════════════════════════════════════════

      const tasks: Task[] = [
        // Base V1
        ...rxToSign.map((r) =>
          buildTask({
            type: "PRESCRIPTION_TO_SIGN",
            sourceId: r.id,
            createdAt: r.prescribedAt,
            patient: getPatient(r.patientId),
            description: r.notes?.slice(0, 80) ?? "Receta borrador pendiente de firma",
            deepLink: `/pharmacy?prescription=${r.id}`,
          }),
        ),
        ...rxToDispense.map((r) =>
          buildTask({
            type: "PRESCRIPTION_TO_DISPENSE",
            sourceId: r.id,
            createdAt: r.signedAt ?? r.prescribedAt,
            patient: getPatient(r.patientId),
            description: "Receta firmada lista para dispensar",
            deepLink: `/pharmacy/dispense?prescription=${r.id}`,
          }),
        ),
        ...triages.map((t) =>
          buildTask({
            type: "TRIAGE_IN_PROGRESS",
            sourceId: t.id,
            createdAt: t.startedAt,
            patient: getPatient(t.patientId),
            description: `Triage ${t.assignedLevel.name} en curso`,
            deepLink: `/triage/${t.id}/discriminators`,
          }),
        ),
        ...labs.map((l) =>
          buildTask({
            type: "LAB_TO_PROCESS",
            sourceId: l.id,
            createdAt: l.orderedAt,
            patient: getPatient(l.patientId),
            description: "Orden de laboratorio pendiente de procesamiento",
            deepLink: `/lis/orders?id=${l.id}`,
          }),
        ),
        ...labsToValidate.map((l) =>
          buildTask({
            type: "LAB_TO_VALIDATE",
            sourceId: l.id,
            createdAt: l.orderedAt,
            patient: getPatient(l.patientId),
            description: "Resultado de laboratorio pendiente de validar",
            deepLink: `/lis/results?id=${l.id}`,
          }),
        ),
        ...images.map((i) =>
          buildTask({
            type: "IMAGING_TO_REPORT",
            sourceId: i.id,
            createdAt: i.orderedAt,
            patient: getPatient(i.patientId),
            description: "Estudio de imagen completado, pendiente de reporte",
            deepLink: `/imaging?id=${i.id}`,
          }),
        ),
        ...imagesToValidate.map((i) =>
          buildTask({
            type: "IMAGING_TO_VALIDATE",
            sourceId: i.id,
            createdAt: i.orderedAt,
            patient: getPatient(i.patientId),
            description: "Reporte de imagen pendiente de validar",
            deepLink: `/imaging?id=${i.id}`,
          }),
        ),
        ...meds.map((m) => {
          const item = medItemMap.get(m.prescriptionItemId);
          return buildTask({
            type: "MED_TO_ADMINISTER",
            sourceId: m.id,
            createdAt: m.administeredAt,
            patient: getPatient(item?.patientId ?? null),
            description: `Administrar ${item?.drugName ?? "medicación"}`,
            deepLink: `/emar?medAdmin=${m.id}`,
          });
        }),

        // Sprint A — NTEC
        ...hcDocs.map((d) =>
          buildTask({
            type: "HC_TO_SIGN",
            sourceId: d.id,
            createdAt: d.creado_en,
            patient: getPatient(d.paciente_id),
            description: "Historia clínica borrador pendiente de firma",
            deepLink: `/ece/historia-clinica?id=${d.id}`,
          }),
        ),
        ...epicrisisDocs.map((d) =>
          buildTask({
            type: "EPICRISIS_TO_SIGN",
            sourceId: d.id,
            createdAt: d.creado_en,
            patient: getPatient(d.paciente_id),
            description: "Epicrisis pendiente de firma al alta",
            deepLink: `/ece/epicrisis?id=${d.id}`,
          }),
        ),
        ...evolutionsPending.map((e) =>
          buildTask({
            type: "EVOLUTION_TO_WRITE",
            sourceId: e.id,
            createdAt: e.admittedAt,
            patient: getPatient(e.patientId),
            description: "Encuentro abierto >24h sin evolución del día",
            deepLink: `/ece/evolucion?encounterId=${e.id}`,
          }),
        ),
        ...valoracionPending.map((v) =>
          buildTask({
            type: "VALORACION_INICIAL_PENDING",
            sourceId: v.id,
            createdAt: v.admitted_at,
            patient: getPatient(v.paciente_id),
            description: "Valoración inicial enfermería pendiente al ingreso",
            deepLink: `/ece/valoracion-inicial-enfermeria/nueva?episodio=${v.episodio_hospitalario_id}`,
          }),
        ),
        ...consentMedDocs.map((d) =>
          buildTask({
            type: "MEDICAL_CONSENT_PENDING",
            sourceId: d.id,
            createdAt: d.creado_en,
            patient: getPatient(d.paciente_id),
            description: "Consentimiento médico pendiente de firma",
            deepLink: `/ece/consentimiento?id=${d.id}`,
          }),
        ),
        ...ordIngDocs.map((d) =>
          buildTask({
            type: "ORDEN_INGRESO_PENDING",
            sourceId: d.id,
            createdAt: d.creado_en,
            patient: getPatient(d.paciente_id),
            description: "Orden de ingreso pendiente de firma",
            deepLink: `/ece/orden-ingreso?id=${d.id}`,
          }),
        ),
        ...atnEmergDocs.map((d) =>
          buildTask({
            type: "ATENCION_EMERGENCIA_PENDING",
            sourceId: d.id,
            createdAt: d.creado_en,
            patient: getPatient(d.paciente_id),
            description: "Documento atención emergencia borrador",
            deepLink: `/ece/atencion-emergencia?id=${d.id}`,
          }),
        ),
        ...rriDocs.map((d) =>
          buildTask({
            type: "RRI_PENDING",
            sourceId: d.id,
            createdAt: d.creado_en,
            patient: getPatient(d.paciente_id),
            description: "Referencia/Interconsulta pendiente de respuesta",
            deepLink: `/ece/rri?id=${d.id}`,
          }),
        ),
        ...isssDocs.map((d) =>
          buildTask({
            type: "ISSS_CERT_PENDING",
            sourceId: d.id,
            createdAt: d.creado_en,
            patient: getPatient(d.paciente_id),
            description: "Certificado ISSS pendiente de emisión",
            deepLink: `/ece/certificado-incapacidad?id=${d.id}`,
          }),
        ),
        ...rectifPending.map((r) =>
          buildTask({
            type: "ECE_RECTIFICACION_PENDING",
            sourceId: r.id,
            createdAt: r.ejecutada_en,
            patient: getPatient(r.paciente_id),
            description: "Rectificación ECE para revisión DIR",
            deepLink: `/ece/rectificaciones/cola`,
          }),
        ),
        ...docsToCertify.map((d) =>
          buildTask({
            type: "ECE_DOC_TO_CERTIFY",
            sourceId: d.id,
            createdAt: d.creado_en,
            patient: getPatient(d.paciente_id),
            description: "Documento validado pendiente de certificación DIR",
            deepLink: `/ece/certificacion?id=${d.id}`,
          }),
        ),

        // Sprint B — JCI
        ...verbalOrders.map((v) =>
          buildTask({
            type: "VERBAL_ORDER_TO_CONFIRM",
            sourceId: v.id,
            createdAt: v.dictado_en,
            patient: getPatient(v.paciente_id),
            description: "Orden verbal sin confirmar (IPSG.2)",
            deepLink: `/ece/indicaciones?verbalOrder=${v.id}`,
          }),
        ),
        ...criticalResults.map((c) =>
          buildTask({
            type: "CRITICAL_RESULT_TO_NOTIFY",
            sourceId: c.id,
            createdAt: c.detectado_en,
            patient: getPatient(c.paciente_id),
            description: "Resultado crítico sin notificar al médico tratante",
            deepLink: `/lis/results?critical=${c.id}`,
          }),
        ),
        ...doubleCheck.map((m) => {
          const item = medItemMap.get(m.prescriptionItemId);
          return buildTask({
            type: "DOUBLE_CHECK_PENDING",
            sourceId: m.id,
            createdAt: m.administeredAt,
            patient: getPatient(item?.patientId ?? null),
            description: `High-alert sin 2da verificación: ${item?.drugName ?? "medicación"}`,
            deepLink: `/emar?medAdmin=${m.id}`,
          });
        }),
        ...whoIncomplete.map((s) =>
          buildTask({
            type: "WHO_CHECKLIST_INCOMPLETE",
            sourceId: s.id,
            createdAt: s.scheduledStart,
            patient: getPatient(s.patientId),
            description: `WHO incompleto: ${s.procedureDescription.slice(0, 60)}`,
            deepLink: `/ece/quirofano/who-check?id=${s.id}`,
          }),
        ),
        ...fallsPending.map((f) =>
          buildTask({
            type: "FALL_REPORT_PENDING",
            sourceId: f.id,
            createdAt: f.fecha_hora,
            patient: null,
            description: "Reporte de caída con lesión sin notificar a JCI",
            deepLink: `/ece/fall-event?id=${f.id}`,
          }),
        ),
        ...morseHigh.map((m) =>
          buildTask({
            type: "MORSE_REEVALUATE",
            sourceId: m.id,
            createdAt: m.registrado_en,
            patient: null,
            description: "Paciente con riesgo alto de caída sin reevaluación 24h",
            deepLink: `/ece/valoracion-inicial-enfermeria?episodio=${m.episodio_hospitalario_id}`,
          }),
        ),
        ...wristbandMissing.map((e) =>
          buildTask({
            type: "WRISTBAND_MISSING",
            sourceId: e.id,
            createdAt: e.admittedAt,
            patient: getPatient(e.patientId),
            description: "Paciente recién admitido — verificar pulsera GSRN",
            deepLink: `/patient-id?encounter=${e.id}`,
          }),
        ),

        // Sprint C — Quirófano
        ...preopPending.map((s) =>
          buildTask({
            type: "SURGERY_PREOP_PENDING",
            sourceId: s.id,
            createdAt: s.scheduledStart,
            patient: getPatient(s.patientId),
            description: `Preop pendiente: ${s.procedureDescription.slice(0, 60)}`,
            deepLink: `/ece/quirofano/preop?id=${s.id}`,
          }),
        ),
        ...consentQxDocs.map((d) =>
          buildTask({
            type: "SURGERY_CONSENT_PENDING",
            sourceId: d.id,
            createdAt: d.creado_en,
            patient: getPatient(d.paciente_id),
            description: "Consentimiento quirúrgico pendiente de firma",
            deepLink: `/ece/quirofano/consentimiento-qx?id=${d.id}`,
          }),
        ),
        ...anesthOpen.map((s) =>
          buildTask({
            type: "ANESTHESIA_RECORD_OPEN",
            sourceId: s.id,
            createdAt: s.actualEnd!,
            patient: getPatient(s.patientId),
            description: `Anestésico abierto post-cx: ${s.procedureDescription.slice(0, 50)}`,
            deepLink: `/ece/registro-anestesico?id=${s.id}`,
          }),
        ),
        ...urpaPending.map((u) =>
          buildTask({
            type: "URPA_DISCHARGE_PENDING",
            sourceId: u.id,
            createdAt: u.registrado_en,
            patient: null,
            description: "URPA pendiente de cerrar o evaluar criterios de egreso",
            deepLink: `/ece/urpa?id=${u.id}`,
          }),
        ),
        ...surgNotePending.map((s) =>
          buildTask({
            type: "SURGERY_NOTE_PENDING",
            sourceId: s.id,
            createdAt: s.actualEnd!,
            patient: getPatient(s.patientId),
            description: `Nota operatoria pendiente: ${s.procedureDescription.slice(0, 50)}`,
            deepLink: `/ece/quirofano/acto-quirurgico?id=${s.id}`,
          }),
        ),

        // ─── Ola 2 — Camas / Flujo (4) ─────────────────────────────────────
        ...bedsToClean.map((b) =>
          buildTask({
            type: "BED_TO_CLEAN",
            sourceId: b.id,
            createdAt: b.updatedAt,
            patient: null,
            description: `Cama ${b.code} en limpieza post-alta`,
            deepLink: `/beds`,
          }),
        ),
        ...bedsToRelease.map((a) =>
          buildTask({
            type: "BED_TO_RELEASE",
            sourceId: a.id,
            createdAt: a.updatedAt,
            patient: getPatient(a.patientId),
            description: "Alta firmada — liberar cama y trasladar paciente",
            deepLink: `/admission/${a.id}/timeline`,
          }),
        ),
        ...admissionsNoVitals.map((a) =>
          buildTask({
            type: "ADMISSION_VITALS_MISSING",
            sourceId: a.id,
            createdAt: a.physicalAdmittedAt!,
            patient: getPatient(a.patientId),
            description: "Admisión activa sin signos vitales iniciales",
            deepLink: `/inpatient?admission=${a.id}`,
          }),
        ),

        // ─── Ola 2 — Consulta externa (3) ──────────────────────────────────
        ...appointmentsToCheckin.map((a) =>
          buildTask({
            type: "APPOINTMENT_TO_CHECKIN",
            sourceId: a.id,
            createdAt: a.scheduledAt,
            patient: getPatient(a.patientId),
            description: a.reason ?? "Cita próxima — pendiente check-in",
            deepLink: `/outpatient?appointment=${a.id}`,
          }),
        ),
        ...consultsNoNote.map((a) =>
          buildTask({
            type: "CONSULTATION_NOTE_PENDING",
            sourceId: a.id,
            createdAt: a.scheduledAt,
            patient: getPatient(a.patientId),
            description: a.reason ?? "Consulta atendida — falta nota EHR",
            deepLink: `/outpatient?appointment=${a.id}`,
          }),
        ),
        ...appointmentsNoShow.map((a) =>
          buildTask({
            type: "APPOINTMENT_NO_SHOW_FOLLOWUP",
            sourceId: a.id,
            createdAt: a.scheduledAt,
            patient: getPatient(a.patientId),
            description: a.reason ?? "Cita perdida — seguimiento médico",
            deepLink: `/outpatient?appointment=${a.id}`,
          }),
        ),

        // ─── Ola 2 — Estudios (3) ──────────────────────────────────────────
        ...respPending.map((r) =>
          buildTask({
            type: "RESPIRATORY_ORDER_PENDING",
            sourceId: r.id,
            createdAt: r.createdAt,
            patient: getPatient(r.patientId),
            description: "Orden respiratoria activa — ejecutar terapia",
            deepLink: `/respiratory?id=${r.id}`,
          }),
        ),
        ...nutriPending.map((n) =>
          buildTask({
            type: "NUTRITION_ORDER_PENDING",
            sourceId: n.id,
            createdAt: n.createdAt,
            patient: getPatient(n.patientId),
            description: "Orden nutricional pendiente de aprobación",
            deepLink: `/nutrition?id=${n.id}`,
          }),
        ),
        ...studiesToSchedule.map((s) =>
          buildTask({
            type: "STUDY_TO_SCHEDULE",
            sourceId: s.id,
            createdAt: s.orderedAt,
            patient: getPatient(s.patientId),
            description: "Estudio de imagen sin programar",
            deepLink: `/imaging?id=${s.id}`,
          }),
        ),

        // ─── Ola 2 — Maternidad (3) ────────────────────────────────────────
        ...partogramaOverdue.map((p) =>
          buildTask({
            type: "PARTOGRAMA_OVERDUE",
            sourceId: p.id,
            createdAt: p.ultima_actualizacion,
            patient: getPatient(p.paciente_id),
            description: "Partograma sin actualización >30min",
            deepLink: `/ece/obstetricia/partograma?id=${p.id}`,
          }),
        ),
        ...rnApgarPending.map((r) =>
          buildTask({
            type: "RN_APGAR_PENDING",
            sourceId: r.id,
            createdAt: r.nacimiento_en,
            patient: getPatient(r.paciente_id),
            description: "RN sin APGAR a 1m/5m (críticamente urgente)",
            deepLink: `/ece/atencion-rn?id=${r.id}`,
          }),
        ),
        ...nrpPostevent.map((n) =>
          buildTask({
            type: "NRP_POSTEVENT_DEBRIEF",
            sourceId: n.id,
            createdAt: n.evento_en,
            patient: getPatient(n.paciente_id),
            description: "Reanimación neonatal sin debrief post-evento",
            deepLink: `/ece/reanimacion-neonatal?id=${n.id}`,
          }),
        ),

        // ─── Ola 2 — Banco de sangre (2) ───────────────────────────────────
        ...bloodVerifyPending.map((b) =>
          buildTask({
            type: "BLOOD_VERIFY_PENDING",
            sourceId: b.id,
            createdAt: b.createdAt,
            patient: getPatient(b.patientId),
            description: "Unidad lista — verificar 2-IDs antes de transfundir",
            deepLink: `/blood-bank?request=${b.id}`,
          }),
        ),
        ...bloodReactPending.map((b) =>
          buildTask({
            type: "BLOOD_REACTION_REPORT",
            sourceId: b.id,
            createdAt: b.started_at,
            patient: null,
            description: "Transfusión con reacción adversa — reportar hemovigilancia",
            deepLink: `/blood-bank?transfusion=${b.id}`,
          }),
        ),

        // ─── Ola 3 — MPI / Identidad / Privacidad ──────────────────────────
        ...nnToResolve.map((p) =>
          buildTask({
            type: "PATIENT_NN_TO_RESOLVE",
            sourceId: p.id,
            createdAt: p.createdAt,
            patient: getPatient(p.id),
            description: `Paciente NN sin identificar — ${p.mrn}`,
            deepLink: `/patients/${p.id}`,
          }),
        ),
        ...arcoPending.map((a) =>
          buildTask({
            type: "ARCO_REQUEST_PENDING",
            sourceId: a.id,
            createdAt: a.creado_en,
            patient: getPatient(a.paciente_id),
            description: "Solicitud ARCO (GDPR) pendiente de respuesta legal",
            deepLink: `/solicitudes-arco?id=${a.id}`,
          }),
        ),

        // ─── Ola 3 — Cold chain ────────────────────────────────────────────
        ...coldChainBreach.map((c) =>
          buildTask({
            type: "COLD_CHAIN_BREACH",
            sourceId: c.id,
            createdAt: c.ocurrido_en,
            patient: null,
            description: "Quiebre de cadena de frío sin resolver",
            deepLink: `/equipment?id=${c.equipo_id}`,
          }),
        ),

        // ─── Ola 3 — Equipos ───────────────────────────────────────────────
        ...calibDue.map((e) =>
          buildTask({
            type: "EQUIPMENT_CALIBRATION_DUE",
            sourceId: e.id,
            createdAt: e.certificationExpiresAt ?? now,
            patient: null,
            description: `Calibración vencida o próxima: ${e.assetTag} ${e.name}`,
            deepLink: `/equipment?id=${e.id}`,
          }),
        ),
        ...equipOutOfService.map((e) =>
          buildTask({
            type: "EQUIPMENT_OUT_OF_SERVICE_RETURN",
            sourceId: e.id,
            createdAt: e.updatedAt,
            patient: null,
            description: `Equipo en ${e.status} >7d: ${e.assetTag} ${e.name}`,
            deepLink: `/equipment?id=${e.id}`,
          }),
        ),

        // ─── Ola 3 — Inventario ────────────────────────────────────────────
        ...lowStock.map((l) =>
          buildTask({
            type: "INVENTORY_LOW_STOCK",
            sourceId: l.id,
            createdAt: l.updated_at,
            patient: null,
            description: `${l.item_name} (lote ${l.lot_number}): ${l.quantity_on_hand} < reorden ${l.reorder_level}`,
            deepLink: `/inventory?lot=${l.id}`,
          }),
        ),
        ...expiringSoon.map((l) =>
          buildTask({
            type: "INVENTORY_EXPIRING_SOON",
            sourceId: l.id,
            createdAt: l.expiryDate ?? now,
            patient: null,
            description: `${l.item?.name ?? "Insumo"} lote ${l.lotNumber} vence ${l.expiryDate?.toISOString().slice(0, 10) ?? ""}`,
            deepLink: `/inventory?lot=${l.id}`,
          }),
        ),

        // ─── Ola 3 — Defunciones / Reclamos ────────────────────────────────
        ...deathCertPending.map((d) =>
          buildTask({
            type: "DEATH_CERT_PENDING",
            sourceId: d.encounter_id,
            createdAt: d.discharged_at,
            patient: getPatient(d.patient_id),
            description: "Defunción registrada — emitir certificado CIE-10",
            deepLink: `/deaths?encounter=${d.encounter_id}`,
          }),
        ),
        ...claimsRejected.map((c) =>
          buildTask({
            type: "CLAIM_REJECTED_TO_APPEAL",
            sourceId: c.id,
            createdAt: c.respondedAt ?? now,
            patient: null,
            description: `Reclamo ${c.claimNumber} rechazado: ${c.rejectionReason?.slice(0, 60) ?? "sin motivo"}`,
            deepLink: `/finance/invoices?claim=${c.id}`,
          }),
        ),

        // ─── Ola 3 — Placeholders activados ────────────────────────────────
        ...mpiMergePending.map((m) =>
          buildTask({
            type: "MPI_MERGE_PENDING",
            sourceId: m.id,
            createdAt: m.creadoEn,
            patient: getPatient(m.canonicalPatientId),
            description: "Solicitud de merge MPI pendiente de aprobación DIR",
            deepLink: `/patients/${m.canonicalPatientId}/merge?merge=${m.id}`,
          }),
        ),
        ...adrPending.map((a) =>
          buildTask({
            type: "ADR_REPORT_PENDING",
            sourceId: a.id,
            createdAt: a.detected_at,
            patient: getPatient(a.patient_id),
            description: `RAM ${a.severity}: ${a.description.slice(0, 80)}`,
            deepLink: `/farmacovigilancia?id=${a.id}`,
          }),
        ),
        ...incidentToReview.map((i) =>
          buildTask({
            type: "INCIDENT_TO_REVIEW",
            sourceId: i.id,
            createdAt: i.detected_at,
            patient: getPatient(i.patient_id),
            description: `Incidente ${i.severity}: ${i.description.slice(0, 80)}`,
            deepLink: `/farmacovigilancia?id=${i.id}`,
          }),
        ),
        ...maintDue.map((m) =>
          buildTask({
            type: "EQUIPMENT_MAINTENANCE_DUE",
            sourceId: m.id,
            createdAt: m.scheduledAt,
            patient: null,
            description: `Mantto preventivo: ${m.equipment.assetTag} ${m.equipment.name}`,
            deepLink: `/equipment?id=${m.equipment.id}`,
          }),
        ),
        ...gs1Transfer.map((t) =>
          buildTask({
            type: "GS1_TRANSFER_PENDING",
            sourceId: t.id,
            createdAt: t.fecha_envio,
            patient: null,
            description: `Transfer ${t.origen_gln} → ${t.destino_gln}`,
            deepLink: `/gs1/transfers?id=${t.id}`,
          }),
        ),
        ...gs1Return.map((r) =>
          buildTask({
            type: "GS1_RETURN_PENDING",
            sourceId: r.id,
            createdAt: r.registrado_en,
            patient: null,
            description: "Devolución de inventario pendiente de validar",
            deepLink: `/gs1/devoluciones?id=${r.id}`,
          }),
        ),
        ...claimsPendingSubmission.map((c) =>
          buildTask({
            type: "CLAIM_PENDING_SUBMISSION",
            sourceId: c.id,
            createdAt: c.created_at,
            patient: null,
            description: `Factura con cobertura ${c.insurer_name} sin reclamo enviado`,
            deepLink: `/finance/invoices/${c.id}`,
          }),
        ),
      ];

      // ── Filtros adicionales ───────────────────────────────────────────────
      let filtered = tasks;
      if (filters.onlyOverdue) filtered = filtered.filter((t) => t.isOverdue);
      if (filters.priority) filtered = filtered.filter((t) => t.priority === filters.priority);

      const priorityRank: Record<TaskPriority, number> = {
        CRITICAL: 0,
        HIGH: 1,
        NORMAL: 2,
        LOW: 3,
      };
      filtered.sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        const pa = priorityRank[a.priority] - priorityRank[b.priority];
        if (pa !== 0) return pa;
        return b.ageMinutes - a.ageMinutes;
      });

      const allTypes = Object.keys(TASK_TYPE_LABEL) as TaskType[];
      const countsByType = allTypes
        .map((t) => {
          const items = tasks.filter((task) => task.type === t);
          return {
            type: t,
            typeLabel: TASK_TYPE_LABEL[t],
            count: items.length,
            overdueCount: items.filter((task) => task.isOverdue).length,
          };
        })
        .filter((c) => c.count > 0);

      return {
        serverNow: now,
        totalTasks: tasks.length,
        overdueTasks: tasks.filter((t) => t.isOverdue).length,
        countsByType,
        tasks: filtered.slice(0, filters.limit),
      };
    }),

  /**
   * Contador rápido para badge — count-only sobre las fuentes base + NTEC + JCI.
   */
  contadorBadge: tenantProcedure.query(
    async ({ ctx }): Promise<{ total: number; overdue: number }> => {
      const { prisma, tenant, user } = ctx;
      const userRoles = tenant.roleCodes;
      const orgId = tenant.organizationId;
      const now = new Date();

      function check(type: TaskType): boolean {
        return userHasAnyRole(userRoles, TASK_REQUIRED_ROLES[type]);
      }

      const counts = await Promise.all([
        check("PRESCRIPTION_TO_SIGN")
          ? prisma.prescription.count({
              where: { organizationId: orgId, status: "DRAFT", prescriberId: user.id },
            })
          : Promise.resolve(0),
        check("PRESCRIPTION_TO_DISPENSE")
          ? prisma.prescription.count({
              where: { organizationId: orgId, status: "SIGNED" },
            })
          : Promise.resolve(0),
        check("TRIAGE_IN_PROGRESS")
          ? prisma.triageEvaluation.count({
              where: {
                organizationId: orgId,
                ...(tenant.establishmentId
                  ? { establishmentId: tenant.establishmentId }
                  : {}),
                status: "IN_PROGRESS",
              },
            })
          : Promise.resolve(0),
        check("LAB_TO_PROCESS")
          ? prisma.labOrder.count({
              where: { organizationId: orgId, status: { in: ["ORDERED", "COLLECTED"] } },
            })
          : Promise.resolve(0),
        check("IMAGING_TO_REPORT")
          ? prisma.imagingOrder.count({
              where: { organizationId: orgId, status: "COMPLETED" },
            })
          : Promise.resolve(0),
        check("MED_TO_ADMINISTER")
          ? prisma.medicationAdministration.count({
              where: {
                organizationId: orgId,
                status: "SCHEDULED",
                administeredAt: { lte: new Date(now.getTime() + 4 * 60 * 60_000) },
              },
            })
          : Promise.resolve(0),
      ]);

      const total = counts.reduce((s, n) => s + n, 0);

      const overdueChecks = await Promise.all([
        check("PRESCRIPTION_TO_SIGN")
          ? prisma.prescription.count({
              where: {
                organizationId: orgId,
                status: "DRAFT",
                prescriberId: user.id,
                prescribedAt: {
                  lt: new Date(
                    now.getTime() - (TASK_SLA_MINUTES.PRESCRIPTION_TO_SIGN ?? 0) * 60_000,
                  ),
                },
              },
            })
          : Promise.resolve(0),
        check("TRIAGE_IN_PROGRESS")
          ? prisma.triageEvaluation.count({
              where: {
                organizationId: orgId,
                status: "IN_PROGRESS",
                startedAt: {
                  lt: new Date(
                    now.getTime() - (TASK_SLA_MINUTES.TRIAGE_IN_PROGRESS ?? 0) * 60_000,
                  ),
                },
              },
            })
          : Promise.resolve(0),
      ]);

      const overdue = overdueChecks.reduce((s, n) => s + n, 0);
      return { total, overdue };
    },
  ),

  // ═════════════════════════════════════════════════════════════════════════
  // Ola 4 — Consolidación: acciones sobre tareas + auditoría
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Reasigna una tarea a otro usuario. Registra acción REASSIGN en
   * WorkflowTaskAction. NO modifica el source (Prescription/LabOrder/etc.)
   * — el reassignment es informativo y se respeta por convención del equipo.
   */
  reasignar: tenantProcedure
    .input(reassignTaskInput)
    .mutation(async ({ ctx, input }) => {
      const { prisma, tenant, user } = ctx;
      // Verificar que el target user pertenezca a la org
      const target = await prisma.user.findFirst({
        where: {
          id: input.targetUserId,
          roles: { some: { organizationId: tenant.organizationId } },
        },
        select: { id: true, fullName: true },
      });
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "El usuario destino no existe en esta organización.",
        });
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WorkflowTaskAction"
          ("organizationId","taskId","taskType",action,"actorId","targetUserId",reason)
         VALUES ($1::uuid, $2, $3, 'REASSIGN', $4::uuid, $5::uuid, $6)`,
        tenant.organizationId,
        input.taskId,
        input.taskType,
        user.id,
        input.targetUserId,
        input.reason,
      );
      return { ok: true, targetName: target.fullName };
    }),

  /**
   * Escala una tarea — registra acción ESCALATE (típicamente al supervisor).
   * Si targetUserId se omite, queda como escalación abierta (notificación
   * para todos los roles supervisores).
   */
  escalar: tenantProcedure
    .input(escalateTaskInput)
    .mutation(async ({ ctx, input }) => {
      const { prisma, tenant, user } = ctx;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WorkflowTaskAction"
          ("organizationId","taskId","taskType",action,"actorId","targetUserId",reason)
         VALUES ($1::uuid, $2, $3, 'ESCALATE', $4::uuid, $5, $6)`,
        tenant.organizationId,
        input.taskId,
        input.taskType,
        user.id,
        input.targetUserId ?? null,
        input.reason,
      );
      return { ok: true };
    }),

  /**
   * Override manual de "completar" una tarea — útil para fuentes sin estado
   * cerrado natural o cuando el usuario decide marcarla como atendida fuera
   * del flujo normal. Registra solo la acción; NO modifica el source.
   */
  completar: tenantProcedure
    .input(completeTaskInput)
    .mutation(async ({ ctx, input }) => {
      const { prisma, tenant, user } = ctx;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WorkflowTaskAction"
          ("organizationId","taskId","taskType",action,"actorId",reason)
         VALUES ($1::uuid, $2, $3, 'COMPLETE', $4::uuid, $5)`,
        tenant.organizationId,
        input.taskId,
        input.taskType,
        user.id,
        input.reason,
      );
      return { ok: true };
    }),

  /**
   * Comentario libre sobre una tarea (no cambia estado). Útil para
   * coordinar entre roles que comparten visibilidad de la tarea.
   */
  comentar: tenantProcedure
    .input(commentTaskInput)
    .mutation(async ({ ctx, input }) => {
      const { prisma, tenant, user } = ctx;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WorkflowTaskAction"
          ("organizationId","taskId","taskType",action,"actorId",reason)
         VALUES ($1::uuid, $2, $3, 'COMMENT', $4::uuid, $5)`,
        tenant.organizationId,
        input.taskId,
        input.taskType,
        user.id,
        input.reason,
      );
      return { ok: true };
    }),

  /**
   * Devuelve el historial de acciones de una tarea específica
   * (drill-down para auditoría).
   */
  historialTarea: tenantProcedure
    .input(z.object({ taskId: z.string().min(3).max(120) }))
    .query(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;
      type Row = {
        id: string;
        taskId: string;
        taskType: string;
        action: string;
        actorId: string;
        actorName: string | null;
        targetUserId: string | null;
        targetName: string | null;
        reason: string;
        createdAt: Date;
      };
      const rows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT
           wta.id::text AS id,
           wta."taskId",
           wta."taskType",
           wta.action,
           wta."actorId"::text AS "actorId",
           u_actor."fullName" AS "actorName",
           wta."targetUserId"::text AS "targetUserId",
           u_target."fullName" AS "targetName",
           wta.reason,
           wta."createdAt"
         FROM "WorkflowTaskAction" wta
         JOIN "User" u_actor ON u_actor.id = wta."actorId"
         LEFT JOIN "User" u_target ON u_target.id = wta."targetUserId"
         WHERE wta."organizationId" = $1::uuid
           AND wta."taskId" = $2
         ORDER BY wta."createdAt" DESC
         LIMIT 100`,
        tenant.organizationId,
        input.taskId,
      );
      return rows;
    }),

  /**
   * Reporte de acciones recientes de TODO el equipo (admin/DIR).
   * Útil para detectar patrones de reasignación, escalaciones repetidas,
   * carga desigual entre miembros del equipo.
   */
  actividadEquipo: tenantProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(30).default(7),
        action: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;
      type Row = {
        id: string;
        taskId: string;
        taskType: string;
        action: string;
        actorName: string;
        targetName: string | null;
        reason: string;
        createdAt: Date;
      };
      const since = new Date(Date.now() - input.days * 24 * 60 * 60_000);
      const rows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT
           wta.id::text AS id,
           wta."taskId",
           wta."taskType",
           wta.action,
           u_actor."fullName" AS "actorName",
           u_target."fullName" AS "targetName",
           wta.reason,
           wta."createdAt"
         FROM "WorkflowTaskAction" wta
         JOIN "User" u_actor ON u_actor.id = wta."actorId"
         LEFT JOIN "User" u_target ON u_target.id = wta."targetUserId"
         WHERE wta."organizationId" = $1::uuid
           AND wta."createdAt" >= $2
           ${input.action ? `AND wta.action = $3` : ""}
         ORDER BY wta."createdAt" DESC
         LIMIT 200`,
        tenant.organizationId,
        since,
        ...(input.action ? [input.action] : []),
      );
      return rows;
    }),
});
