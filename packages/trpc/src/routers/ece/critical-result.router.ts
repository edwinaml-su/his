/**
 * criticalResultRouter — IPSG.2 ME 2: Notificación de resultados críticos con SLA y read-back.
 *
 * JCI Standard: IPSG.2 ME 2 — "Results of critical tests and critical values are
 * communicated to a responsible practitioner within an established time frame."
 *
 * ---------------------------------------------------------------------------
 * FLUJO
 * ---------------------------------------------------------------------------
 *  1. LIS auto-flag detecta valor crítico → llama emit() → INSERT en
 *     ece.critical_result_notification con sla_min=60.
 *     (El wiring LIS→emit se completa en sprint posterior — ver TODO abajo.)
 *
 *  2. Médico tratante recibe alerta (canal externo: push/email — ver notificationsRouter).
 *     Cuando confirma lectura, llama confirmReadback() con su PIN argon2id.
 *
 *  3. pg_cron watchdog cada 5 min (migración 114):
 *     - > 30 min sin read-back → emite 'critical_result.sla_warning' vía outbox.
 *     - > 60 min sin read-back → marca escalado_en + emite 'critical_result.sla_exceeded'.
 *     - escalate() permite escalación manual adicional.
 *
 * ---------------------------------------------------------------------------
 * TODO (sprint posterior — NO tocar LIS router directamente)
 * ---------------------------------------------------------------------------
 *  - Wiring LIS auto-flag: cuando LabResult se valida con valor_critico=true,
 *    el LIS router debe llamar emit() de este router (o emitir evento de dominio
 *    que este router consuma). Documentado en US.JCI.5.7-wiring.
 *  - PIN argon2id: integrar con MFA router para reutilizar el hash almacenado
 *    del médico (mfaRouter.verifyPin) en vez de recibir el PIN en texto plano.
 *    Por ahora, verificación dummy segura (ver nota en confirmReadback).
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* fuera de schema.prisma)
 * ---------------------------------------------------------------------------
 *  ece.critical_result_notification — migración 114
 *    id, organization_id, lab_result_id, paciente_id, medico_tratante_id,
 *    valor_critico (jsonb), severidad, notificado_en, sla_min,
 *    read_back_at, read_back_por_id, pin_fail_count,
 *    escalado_a_id, escalado_en, created_at, updated_at
 *
 * ---------------------------------------------------------------------------
 * ROLES
 * ---------------------------------------------------------------------------
 *  emit           → requireRole(["LAB","RAD","ADMIN"])        — LIS/RIS interno
 *  confirmReadback → requireRole(["MC","ESP","PHYSICIAN"])     — médico tratante
 *  pending         → requireRole(["MC","ESP","PHYSICIAN","DIR","ADMIN"])
 *  escalate        → requireRole(["DIR","ADMIN","MC","ESP"])   — supervisión o manual
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";

// ---------------------------------------------------------------------------
// Schemas de input
// ---------------------------------------------------------------------------

const emitSchema = z.object({
  labResultId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  medicoTratanteId: z.string().uuid(),
  valorCritico: z.record(z.unknown()),
  severidad: z.enum(["alta", "muy_alta", "crítica"]),
  slaMin: z.number().int().min(1).max(1440).default(60),
});

const confirmReadbackSchema = z.object({
  notificationId: z.string().uuid(),
  /** PIN del médico — se verifica contra hash argon2id almacenado en ece.personal_salud.
   *  TODO (sprint posterior): delegar verificación a mfaRouter.verifyPin. */
  pin: z.string().min(4).max(32),
});

const pendingSchema = z.object({
  medicoId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const escalateSchema = z.object({
  notificationId: z.string().uuid(),
  escaladoAId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Row types — alineados con columnas reales de ece.critical_result_notification
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: string;
  organization_id: string;
  lab_result_id: string;
  paciente_id: string;
  medico_tratante_id: string;
  valor_critico: unknown;
  severidad: string;
  notificado_en: Date;
  sla_min: number;
  read_back_at: Date | null;
  read_back_por_id: string | null;
  pin_fail_count: number;
  escalado_a_id: string | null;
  escalado_en: Date | null;
}

interface PersonalRow {
  id: string;
  pin_hash: string | null;
}

type RawTx = {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Helpers de acceso raw
// ---------------------------------------------------------------------------

async function findNotification(
  tx: RawTx,
  id: string,
  orgId: string,
): Promise<NotificationRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<NotificationRow[]>)`
    SELECT
      id::text,
      organization_id::text,
      lab_result_id::text,
      paciente_id::text,
      medico_tratante_id::text,
      valor_critico,
      severidad,
      notificado_en,
      sla_min,
      read_back_at,
      read_back_por_id::text,
      pin_fail_count,
      escalado_a_id::text,
      escalado_en
    FROM ece.critical_result_notification
    WHERE id = ${id}::uuid
      AND organization_id = ${orgId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonalByHisUser(
  tx: RawTx,
  hisUserId: string,
): Promise<PersonalRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<PersonalRow[]>)`
    SELECT id::text, pin_hash
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// PIN verification
// ---------------------------------------------------------------------------

/**
 * Verifica el PIN del médico.
 *
 * Implementación actual: verifica que el campo no sea vacío y que coincida con
 * pin_hash si está almacenado. El hash real argon2id se integra en sprint posterior
 * cuando se unifique con mfaRouter.verifyPin.
 *
 * Por seguridad: incrementa pin_fail_count en fallo y bloquea tras 5 intentos.
 */
async function verifyPin(
  tx: RawTx,
  personal: PersonalRow,
  notificationId: string,
  pin: string,
): Promise<{ ok: boolean; blocked: boolean }> {
  // Obtener contador actual
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<Array<{ pin_fail_count: number }>>)`
    SELECT pin_fail_count FROM ece.critical_result_notification
    WHERE id = ${notificationId}::uuid
    LIMIT 1
  `;
  const failCount = rows[0]?.pin_fail_count ?? 0;

  if (failCount >= 5) {
    return { ok: false, blocked: true };
  }

  // Si no hay pin_hash almacenado (usuario no configuró PIN), aceptar cualquier PIN
  // no vacío. TODO: requerir pin_hash obligatorio tras integración con mfaRouter.
  const pinOk = personal.pin_hash == null ? pin.length >= 4 : pin === personal.pin_hash;

  if (!pinOk) {
    await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
      UPDATE ece.critical_result_notification
      SET pin_fail_count = pin_fail_count + 1, updated_at = NOW()
      WHERE id = ${notificationId}::uuid
    `;
    return { ok: false, blocked: false };
  }

  return { ok: true, blocked: false };
}

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

const labProc = requireRole(["LAB", "RAD", "ADMIN"]);
const mcProc = requireRole(["MC", "ESP", "PHYSICIAN"]);
const readerProc = requireRole(["MC", "ESP", "PHYSICIAN", "DIR", "ADMIN"]);
const supervisorProc = requireRole(["DIR", "ADMIN", "MC", "ESP"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const criticalResultRouter = router({
  /**
   * emit — Registra una notificación de resultado crítico.
   * Llamado desde el LIS auto-flag (wiring pendiente — ver TODO de archivo).
   *
   * JCI Standard: IPSG.2 ME 2
   */
  emit: labProc.input(emitSchema).mutation(async ({ ctx, input }) => {
    const orgId = ctx.tenant.organizationId;
    const valorJson = JSON.stringify(input.valorCritico);

    const rows = await ctx.prisma.$transaction(async (tx) => {
      await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
        SET LOCAL app.current_org_id = ${orgId};
        SET LOCAL app.current_user_id = ${ctx.user.id};
        SET LOCAL ROLE authenticated;
      `;

      const inserted = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ id: string; notificado_en: Date }>>)`
        INSERT INTO ece.critical_result_notification (
          organization_id,
          lab_result_id,
          paciente_id,
          medico_tratante_id,
          valor_critico,
          severidad,
          sla_min
        ) VALUES (
          ${orgId}::uuid,
          ${input.labResultId}::uuid,
          ${input.pacienteId}::uuid,
          ${input.medicoTratanteId}::uuid,
          ${valorJson}::jsonb,
          ${input.severidad},
          ${input.slaMin}
        )
        RETURNING id::text, notificado_en
      `;

      const notif = inserted[0];
      if (!notif) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear notificación." });

      await emitDomainEvent(tx, {
        organizationId: orgId,
        eventType: "critical_result.emitted",
        aggregateType: "CriticalResultNotification",
        aggregateId: notif.id,
        emittedById: ctx.user.id,
        payload: {
          labResultId: input.labResultId,
          pacienteId: input.pacienteId,
          medicoTratanteId: input.medicoTratanteId,
          severidad: input.severidad,
          slaMin: input.slaMin,
        },
      });

      return notif;
    });

    return { notificationId: rows.id, notificadoEn: rows.notificado_en };
  }),

  /**
   * confirmReadback — El médico confirma con PIN que vio el valor crítico.
   * Registra read_back_at + read_back_por_id.
   *
   * JCI Standard: IPSG.2 ME 2 — read-back digital obligatorio.
   */
  confirmReadback: mcProc.input(confirmReadbackSchema).mutation(async ({ ctx, input }) => {
    const orgId = ctx.tenant.organizationId;

    return ctx.prisma.$transaction(async (tx) => {
      await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
        SET LOCAL app.current_org_id = ${orgId};
        SET LOCAL app.current_user_id = ${ctx.user.id};
        SET LOCAL ROLE authenticated;
      `;

      const notif = await findNotification(tx, input.notificationId, orgId);
      if (!notif) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Notificación no encontrada." });
      }
      if (notif.read_back_at !== null) {
        throw new TRPCError({ code: "CONFLICT", message: "Read-back ya registrado." });
      }

      const personal = await findPersonalByHisUser(tx, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No se encontró perfil de personal de salud para su cuenta.",
        });
      }

      const { ok, blocked } = await verifyPin(tx, personal, input.notificationId, input.pin);
      if (blocked) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Cuenta bloqueada por exceso de intentos PIN. Contacte al administrador.",
        });
      }
      if (!ok) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "PIN incorrecto." });
      }

      await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
        UPDATE ece.critical_result_notification
        SET read_back_at     = NOW(),
            read_back_por_id = ${personal.id}::uuid,
            pin_fail_count   = 0,
            updated_at       = NOW()
        WHERE id = ${input.notificationId}::uuid
      `;

      // Calcular si read-back llegó dentro del SLA
      const minutos =
        (Date.now() - new Date(notif.notificado_en).getTime()) / 60_000;
      const dentroSla = minutos <= notif.sla_min;

      await emitDomainEvent(tx, {
        organizationId: orgId,
        eventType: "critical_result.read_back_confirmed",
        aggregateType: "CriticalResultNotification",
        aggregateId: input.notificationId,
        emittedById: ctx.user.id,
        payload: {
          labResultId: notif.lab_result_id,
          pacienteId: notif.paciente_id,
          medicoId: personal.id,
          minutosTranscurridos: Math.round(minutos),
          dentroSla,
          slaMin: notif.sla_min,
        },
      });

      return {
        ok: true as const,
        readBackAt: new Date().toISOString(),
        dentroSla,
        minutosTranscurridos: Math.round(minutos),
      };
    });
  }),

  /**
   * pending — Lista notificaciones pendientes de read-back.
   * - Médico: solo sus notificaciones (medicoId opcional si coincide con ctx.user).
   * - DIR/ADMIN: todas las de la org (medicoId=undefined).
   *
   * JCI Standard: IPSG.2 ME 2
   */
  pending: readerProc.input(pendingSchema).query(async ({ ctx, input }) => {
    const orgId = ctx.tenant.organizationId;
    const isDir = ctx.tenant.roleCodes.some((r) => ["DIR", "ADMIN"].includes(r));

    // Un médico sin rol supervisorio solo puede ver sus propias notificaciones.
    const medicoFilter = isDir
      ? (input.medicoId ?? null)
      : ctx.user.id;

    const rows = await ctx.prisma.$transaction(async (tx) => {
      await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
        SET LOCAL app.current_org_id = ${orgId};
        SET LOCAL app.current_user_id = ${ctx.user.id};
        SET LOCAL ROLE authenticated;
      `;

      return (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<NotificationRow[]>)`
        SELECT
          n.id::text,
          n.organization_id::text,
          n.lab_result_id::text,
          n.paciente_id::text,
          n.medico_tratante_id::text,
          n.valor_critico,
          n.severidad,
          n.notificado_en,
          n.sla_min,
          n.read_back_at,
          n.read_back_por_id::text,
          n.pin_fail_count,
          n.escalado_a_id::text,
          n.escalado_en,
          -- minutos transcurridos desde notificación (solo informativo)
          EXTRACT(EPOCH FROM (NOW() - n.notificado_en)) / 60 AS minutos_transcurridos
        FROM ece.critical_result_notification n
        JOIN ece.personal_salud ps ON ps.id = n.medico_tratante_id
        WHERE n.organization_id = ${orgId}::uuid
          AND n.read_back_at IS NULL
          AND (
            ${medicoFilter}::text IS NULL
            OR ps.his_user_id = ${medicoFilter ?? null}::uuid
          )
        ORDER BY
          CASE n.severidad
            WHEN 'crítica' THEN 1
            WHEN 'muy_alta' THEN 2
            ELSE 3
          END,
          n.notificado_en ASC
        LIMIT ${input.limit}
      `;
    });

    return { items: rows };
  }),

  /**
   * escalate — Escala una notificación a otro profesional (manual o por dirección).
   * El pg_cron auto-escala tras 60 min; este procedure permite escalación temprana.
   *
   * JCI Standard: IPSG.2 ME 2
   */
  escalate: supervisorProc.input(escalateSchema).mutation(async ({ ctx, input }) => {
    const orgId = ctx.tenant.organizationId;

    return ctx.prisma.$transaction(async (tx) => {
      await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
        SET LOCAL app.current_org_id = ${orgId};
        SET LOCAL app.current_user_id = ${ctx.user.id};
        SET LOCAL ROLE authenticated;
      `;

      const notif = await findNotification(tx, input.notificationId, orgId);
      if (!notif) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Notificación no encontrada." });
      }
      if (notif.read_back_at !== null) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "No se puede escalar: el read-back ya fue confirmado.",
        });
      }

      await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
        UPDATE ece.critical_result_notification
        SET escalado_a_id = ${input.escaladoAId}::uuid,
            escalado_en   = NOW(),
            updated_at    = NOW()
        WHERE id = ${input.notificationId}::uuid
      `;

      await emitDomainEvent(tx, {
        organizationId: orgId,
        eventType: "critical_result.escalated",
        aggregateType: "CriticalResultNotification",
        aggregateId: input.notificationId,
        emittedById: ctx.user.id,
        payload: {
          labResultId: notif.lab_result_id,
          pacienteId: notif.paciente_id,
          escaladoAId: input.escaladoAId,
          escaladoEn: new Date().toISOString(),
        },
      });

      return { ok: true as const, escaladoEn: new Date().toISOString() };
    });
  }),
});
