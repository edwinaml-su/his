/**
 * medication-window.router — Alerta ventana terapéutica próxima a cerrar (US.F2.6.52)
 *
 * Lógica:
 * - getProximasACerrar: retorna indicaciones cuya próxima administración
 *   está dentro de los próximos 15 minutos (o ya vencidas pero pendientes).
 * - markAttended: marca una alerta como atendida (enfermera la vio).
 * - emitWindowClosingAlerts: persiste alertas + outbox event "medication.window-closing"
 *   para indicaciones < 15 min. Llamado desde cron / Edge Function cada 2 min.
 *
 * Seguridad: tenantProcedure → withTenantContext obligatorio para RLS.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

const WINDOW_ALERT_MINUTES = 15;

// ---------------------------------------------------------------------------
// Tipos de fila raw de Postgres
// ---------------------------------------------------------------------------

interface IndicacionProximaRow {
  indication_id: string;
  patient_id: string;
  patient_gsrn: string | null;
  gtin_medicamento: string | null;
  nombre_medicamento: string | null;
  proxima_administracion: Date;
  minutos_restantes: number;
}

interface AlertaRow {
  id: string;
  indication_id: string;
  organization_id: string;
  ventana_cierre_en: Date;
  enviado_en: Date;
  atendido_en: Date | null;
  atendido_por_id: string | null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const medicationWindowRouter = router({
  /**
   * Retorna indicaciones del turno cuya ventana terapéutica cierra en ≤ 15 min.
   * Incluye también las ya alertadas pero no atendidas (para badge de contador).
   */
  getProximasACerrar: tenantProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const orgId  = ctx.tenant.organizationId;
      const establishmentId = ctx.tenant.establishmentId;
      const userId = ctx.user.id;
      const now    = new Date();
      const cutoff = new Date(now.getTime() + WINDOW_ALERT_MINUTES * 60_000);

      // Administraciones programadas pendientes cuya ventana terapéutica está
      // dentro del umbral (o ya vencida). Fuente real: ece.administracion_medicamento
      // (hora_programada/hora_aplicada) → indicacion_item → indicaciones_medicas →
      // episodio_atencion. Se filtra por establecimiento activo del tenant.
      const rows = establishmentId
        ? await ctx.prisma.$queryRawUnsafe<IndicacionProximaRow[]>(
            `SELECT
               am.id::text                   AS indication_id,
               ea.paciente_id::text          AS patient_id,
               NULL::text                    AS patient_gsrn,
               NULL::text                    AS gtin_medicamento,
               it.descripcion                AS nombre_medicamento,
               am.hora_programada            AS proxima_administracion,
               EXTRACT(EPOCH FROM (am.hora_programada - $3::timestamptz)) / 60
                                             AS minutos_restantes
             FROM ece.administracion_medicamento am
             JOIN ece.indicacion_item        it ON it.id = am.indicacion_item_id
             JOIN ece.indicaciones_medicas   im ON im.id = it.indicacion_id
             JOIN ece.episodio_atencion      ea ON ea.id = im.episodio_id
             WHERE ea.establecimiento_id = $1::uuid
               AND am.hora_aplicada IS NULL
               AND am.hora_programada IS NOT NULL
               AND am.hora_programada <= $2::timestamptz
             ORDER BY am.hora_programada ASC
             LIMIT 50`,
            establishmentId,
            cutoff.toISOString(),
            now.toISOString(),
          )
        : [];

      // Alertas no atendidas para el turno (para mostrar badge)
      const alertasRows = await ctx.prisma.$queryRawUnsafe<AlertaRow[]>(
        `SELECT id, indication_id, organization_id, ventana_cierre_en,
                enviado_en, atendido_en, atendido_por_id
           FROM ece.medication_window_alert
          WHERE organization_id = $1::uuid
            AND atendido_en IS NULL
            AND enviado_en >= now() - interval '2 hours'
          ORDER BY ventana_cierre_en ASC
          LIMIT 50`,
        orgId,
      );

      return {
        indicaciones: rows.map((r) => ({
          indicationId:       r.indication_id,
          patientId:          r.patient_id,
          patientGsrn:        r.patient_gsrn,
          gtinMedicamento:    r.gtin_medicamento,
          nombreMedicamento:  r.nombre_medicamento,
          proximaAdminIso:    new Date(r.proxima_administracion).toISOString(),
          minutosRestantes:   Math.round(Number(r.minutos_restantes)),
        })),
        alertasPendientes: alertasRows.map((a) => ({
          alertId:         a.id,
          indicationId:    a.indication_id,
          ventanaCierreEn: new Date(a.ventana_cierre_en).toISOString(),
          enviadoEn:       new Date(a.enviado_en).toISOString(),
        })),
      };
    }),

  /**
   * Marca una alerta como atendida. Idempotente (ya atendida → sin error).
   */
  markAttended: tenantProcedure
    .input(z.object({ alertId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId  = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      const updated = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
          `UPDATE ece.medication_window_alert
              SET atendido_en = now(), atendido_por_id = $2::uuid
            WHERE id = $1::uuid
              AND organization_id = $3::uuid
              AND atendido_en IS NULL
            RETURNING id`,
          input.alertId,
          userId,
          orgId,
        );
        return rows[0] ?? null;
      });

      // Si ya estaba atendida: OK silencioso (idempotente)
      return { attended: updated !== null };
    }),

  /**
   * Genera alertas para indicaciones próximas a cerrar ventana.
   * Destinado a ser llamado desde Edge Function / cron job cada 2 min.
   * Evita duplicados: no inserta si ya hay alerta no atendida para la indicación
   * creada en los últimos 3 minutos.
   */
  emitWindowClosingAlerts: tenantProcedure
    .input(z.object({}).optional())
    .mutation(async ({ ctx }) => {
      const orgId  = ctx.tenant.organizationId;
      const now    = new Date();
      const cutoff = new Date(now.getTime() + WINDOW_ALERT_MINUTES * 60_000);

      // Indicaciones próximas sin alerta reciente
      const rows = await ctx.prisma.$queryRawUnsafe<{
        indication_id: string;
        proxima_administracion: Date;
      }[]>(
        `SELECT i.id AS indication_id, i.proxima_administracion
           FROM ece.indicaciones_medicas i
          WHERE i.organization_id = $1::uuid
            AND i.estado = 'ACTIVA'
            AND i.proxima_administracion IS NOT NULL
            AND i.proxima_administracion <= $2::timestamptz
            AND NOT EXISTS (
              SELECT 1 FROM ece.medication_window_alert a
               WHERE a.indication_id = i.id::text
                 AND a.organization_id = $1::uuid
                 AND a.atendido_en IS NULL
                 AND a.enviado_en >= now() - interval '3 minutes'
            )
          LIMIT 30`,
        orgId,
        cutoff.toISOString(),
      );

      if (rows.length === 0) return { emitted: 0 };

      const emitted = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        let count = 0;
        for (const row of rows) {
          // Insertar alerta
          await tx.$executeRawUnsafe(
            `INSERT INTO ece.medication_window_alert
               (indication_id, organization_id, ventana_cierre_en)
             VALUES ($1, $2::uuid, $3::timestamptz)
             ON CONFLICT DO NOTHING`,
            row.indication_id,
            orgId,
            new Date(row.proxima_administracion).toISOString(),
          );

          // Outbox event "medication.window-closing" → Beta.15 dispatcher.
          // Columnas camelCase quoted (Prisma convention). Dedup vía
          // uq_domain_event_pending_dedup (SQL 97): solo 1 evento pendiente
          // por (organizationId, aggregateId, eventType) WHERE publishedAt IS NULL.
          await tx.$executeRawUnsafe(
            `INSERT INTO "DomainEvent"
               ("organizationId", "eventType", "aggregateType", "aggregateId", payload, "occurredAt")
             VALUES ($1::uuid, 'medication.window-closing', 'Indication', $2::uuid, $3::jsonb, now())
             ON CONFLICT ("organizationId", "aggregateId", "eventType") WHERE "publishedAt" IS NULL DO NOTHING`,
            orgId,
            // indicationId puede ser TEXT no UUID en ece — cast defensivo
            row.indication_id,
            JSON.stringify({
              indicationId:    row.indication_id,
              organizationId:  orgId,
              ventanaCierreEn: new Date(row.proxima_administracion).toISOString(),
              minutosRestantes: WINDOW_ALERT_MINUTES,
            }),
          );

          count++;
        }
        return count;
      });

      return { emitted };
    }),
});
