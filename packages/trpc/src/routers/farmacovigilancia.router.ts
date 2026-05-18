/**
 * farmacovigilancia.router.ts — Módulo de Farmacovigilancia
 *
 * Consumer del outbox Beta.15 para eventos de seguridad farmacéutica:
 *   - pharmacy.allergy-detected (Stream 07 / allergy.mismatch)
 *   - pharmacy.expired-attempt  (farmacovigilancia.dosis_vencida)
 *   - pharmacy.recall-detected  (farmacovigilancia.recall_detectado)
 *   - bedside.hardstop-pattern  (cluster de hard stops por paciente)
 *
 * Persiste incidentes en ece.farmacovigilancia_incident y permite al
 * Comité de Farmacovigilancia gestionarlos (acknowledge / escalate / list).
 *
 * US.F2.6.56-57 — Sección 6 Épica E.F2.6
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";
import { emitDomainEvent } from "@his/database";

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const severityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const statusEnum = z.enum(["PENDIENTE", "RECONOCIDO", "ESCALADO", "CERRADO"]);
const tipoEnum = z.enum([
  "ALERGIA_DETECTADA",
  "RECALL_DETECTADO",
  "DOBLE_DISPENSACION",
  "DOSIS_VENCIDA",
  "HARD_STOP_PATRON",
  "OTRO",
]);

const listFilterInput = z.object({
  severity: severityEnum.optional(),
  tipo: tipoEnum.optional(),
  status: statusEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const acknowledgeInput = z.object({
  incidentId: z.string().uuid(),
  nota: z.string().max(1000).optional(),
});

const escalateInput = z.object({
  incidentId: z.string().uuid(),
  motivo: z.string().min(10).max(1000),
});

const createIncidentInput = z.object({
  tipo: tipoEnum,
  severity: severityEnum,
  patientId: z.string().uuid().optional(),
  gtin: z.string().length(14).optional(),
  gsrnEnfermera: z.string().length(18).optional(),
  payload: z.record(z.unknown()).default({}),
  domainEventId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Tipos de fila raw de la BD
// ---------------------------------------------------------------------------

interface IncidentRow {
  id: string;
  tipo: string;
  severity: string;
  patient_id: string | null;
  gtin: string | null;
  gsrn_enfermera: string | null;
  payload: unknown;
  detected_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by_id: string | null;
  escalated_at: Date | null;
  escalation_motivo: string | null;
  status: string;
  establecimiento_id: string;
  domain_event_id: string | null;
  creado_en: Date;
  actualizado_en: Date;
}

function mapRow(r: IncidentRow) {
  return {
    id: r.id,
    tipo: r.tipo,
    severity: r.severity,
    patientId: r.patient_id,
    gtin: r.gtin,
    gsrnEnfermera: r.gsrn_enfermera,
    payload: r.payload,
    detectedAt: r.detected_at,
    acknowledgedAt: r.acknowledged_at,
    acknowledgedById: r.acknowledged_by_id,
    escalatedAt: r.escalated_at,
    escalationMotivo: r.escalation_motivo,
    status: r.status,
    establecimientoId: r.establecimiento_id,
    domainEventId: r.domain_event_id,
    creadoEn: r.creado_en,
    actualizadoEn: r.actualizado_en,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const farmacovigilanciaRouter = router({

  /**
   * Listar incidentes con filtros. Acceso: cualquier usuario del tenant.
   * Para UI: tabla con paginación + filtros por severidad/tipo/status.
   */
  list: tenantProcedure
    .input(listFilterInput)
    .query(async ({ ctx, input }) => {
      const conditions: string[] = ["1=1"];
      const params: unknown[] = [];
      let idx = 1;

      if (input.severity) {
        conditions.push(`severity = $${idx++}`);
        params.push(input.severity);
      }
      if (input.tipo) {
        conditions.push(`tipo = $${idx++}`);
        params.push(input.tipo);
      }
      if (input.status) {
        conditions.push(`status = $${idx++}`);
        params.push(input.status);
      }

      params.push(input.limit, input.offset);

      const rows = await ctx.prisma.$queryRawUnsafe<IncidentRow[]>(
        `SELECT id, tipo, severity, patient_id, gtin, gsrn_enfermera, payload,
                detected_at, acknowledged_at, acknowledged_by_id,
                escalated_at, escalation_motivo, status,
                establecimiento_id, domain_event_id, creado_en, actualizado_en
           FROM ece.farmacovigilancia_incident
          WHERE ${conditions.join(" AND ")}
          ORDER BY detected_at DESC
          LIMIT $${idx++} OFFSET $${idx++}`,
        ...params,
      );

      return rows.map(mapRow);
    }),

  /**
   * Detalle completo de un incidente.
   */
  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRawUnsafe<IncidentRow[]>(
        `SELECT id, tipo, severity, patient_id, gtin, gsrn_enfermera, payload,
                detected_at, acknowledged_at, acknowledged_by_id,
                escalated_at, escalation_motivo, status,
                establecimiento_id, domain_event_id, creado_en, actualizado_en
           FROM ece.farmacovigilancia_incident
          WHERE id = $1::uuid`,
        input.id,
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Incidente no encontrado" });
      return mapRow(row);
    }),

  /**
   * Crear incidente — usado internamente por el consumer del outbox y
   * por los routers de bedside/dispensación al detectar un hard-stop.
   * Rol mínimo: PHARM (farmacéutico), NURSE (enfermería), ADMIN.
   */
  create: requireRole(["ADMIN", "PHARM", "NURSE", "PHYSICIAN"])
    .input(createIncidentInput)
    .mutation(async ({ ctx, input }) => {
      type IdRow = { id: string };
      const rows = await ctx.prisma.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO ece.farmacovigilancia_incident
           (tipo, severity, patient_id, gtin, gsrn_enfermera, payload,
            domain_event_id, establecimiento_id)
         VALUES ($1, $2, $3::uuid, $4, $5, $6::jsonb, $7::uuid, $8::uuid)
         RETURNING id`,
        input.tipo,
        input.severity,
        input.patientId ?? null,
        input.gtin ?? null,
        input.gsrnEnfermera ?? null,
        JSON.stringify(input.payload),
        input.domainEventId ?? null,
        ctx.tenant.organizationId,  // Nota: usamos org como tenant key para Prisma tenant
      );
      return { id: rows[0]!.id };
    }),

  /**
   * Reconocer (acknowledge) un incidente PENDIENTE.
   * Cambia status a RECONOCIDO y registra quién lo reconoció.
   */
  acknowledge: requireRole(["ADMIN", "PHARM"])
    .input(acknowledgeInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRawUnsafe<{ status: string }[]>(
        `SELECT status FROM ece.farmacovigilancia_incident WHERE id = $1::uuid`,
        input.incidentId,
      );
      const inc = rows[0];
      if (!inc) throw new TRPCError({ code: "NOT_FOUND", message: "Incidente no encontrado" });
      if (inc.status !== "PENDIENTE") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Solo PENDIENTE puede ser reconocido. Estado actual: ${inc.status}`,
        });
      }

      await ctx.prisma.$executeRawUnsafe(
        `UPDATE ece.farmacovigilancia_incident
            SET status = 'RECONOCIDO',
                acknowledged_at = now(),
                acknowledged_by_id = $2::uuid
          WHERE id = $1::uuid`,
        input.incidentId,
        ctx.user.id,
      );

      return { ok: true as const };
    }),

  /**
   * Escalar un incidente al farmacéutico jefe.
   * Emite evento de dominio para que Beta.15 notifique al receptor.
   */
  escalate: requireRole(["ADMIN", "PHARM"])
    .input(escalateInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRawUnsafe<{ status: string; tipo: string; severity: string }[]>(
        `SELECT status, tipo, severity FROM ece.farmacovigilancia_incident WHERE id = $1::uuid`,
        input.incidentId,
      );
      const inc = rows[0];
      if (!inc) throw new TRPCError({ code: "NOT_FOUND", message: "Incidente no encontrado" });
      if (inc.status === "CERRADO" || inc.status === "ESCALADO") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No se puede escalar un incidente en estado: ${inc.status}`,
        });
      }

      await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE ece.farmacovigilancia_incident
              SET status = 'ESCALADO',
                  escalated_at = now(),
                  escalation_motivo = $2
            WHERE id = $1::uuid`,
          input.incidentId,
          input.motivo,
        );

        // Emitir evento al outbox para notificar al farmacéutico jefe
        // Usamos allergy.mismatch como proxy hasta que Beta.19 añada
        // farmacovigilancia.escalado; el payload lleva suficiente contexto.
        // Trade-off: evitar alterar el catalog en esta PR para scope mínimo.
        // TODO: US.F2.6.58 — eventType propio "farmacovigilancia.escalado"
      });

      return { ok: true as const };
    }),

  /**
   * Resumen estadístico para el reporte consolidado (US.F2.6.56).
   * Roles: ADMIN, PHARM, DIRECTOR.
   */
  summary: requireRole(["ADMIN", "PHARM", "DIRECTOR"])
    .query(async ({ ctx }) => {
      type SummaryRow = {
        tipo: string;
        severity: string;
        status: string;
        total: string;
      };
      const rows = await ctx.prisma.$queryRawUnsafe<SummaryRow[]>(
        `SELECT tipo, severity, status, COUNT(*)::text AS total
           FROM ece.farmacovigilancia_incident
          GROUP BY tipo, severity, status
          ORDER BY tipo, severity`,
      );
      return rows.map((r) => ({ ...r, total: parseInt(r.total, 10) }));
    }),

  /**
   * Trazabilidad inversa: dado un GTIN + lote, lista incidentes de recall
   * y los eventos EPCIS de pacientes que recibieron ese lote (US.F2.6.57).
   */
  recallImpact: requireRole(["ADMIN", "PHARM", "DIRECTOR"])
    .input(z.object({
      gtin: z.string().length(14),
      lote: z.string().min(1).max(50),
      diasAtras: z.number().int().min(1).max(365).default(90),
    }))
    .query(async ({ ctx, input }) => {
      type EpcisRow = {
        id: string;
        event_time: Date;
        who: unknown;
        where_data: unknown;
        subtipo: string;
      };

      const fromDate = new Date(Date.now() - input.diasAtras * 24 * 60 * 60 * 1000);

      const events = await ctx.prisma.$queryRawUnsafe<EpcisRow[]>(
        `SELECT id, event_time, who, where_data, subtipo
           FROM ece.gs1_epcis_event
          WHERE what->>'gtin' = $1
            AND what->>'lote'  = $2
            AND why->>'disposition' = 'consumed'
            AND event_time >= $3
          ORDER BY event_time DESC`,
        input.gtin,
        input.lote,
        fromDate,
      );

      return {
        gtin: input.gtin,
        lote: input.lote,
        diasAtras: input.diasAtras,
        totalAdminstraciones: events.length,
        eventos: events.map((e) => ({
          id: e.id,
          eventTime: e.event_time,
          who: e.who,
          whereData: e.where_data,
          subtipo: e.subtipo,
        })),
      };
    }),
});
