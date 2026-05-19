/**
 * gs1-lote-trace.router.ts — Trazabilidad de lote y flujo de recall RTCA.
 *
 * HI-10 (P0): query `loteTrace` para trazabilidad completa de un número de lote.
 * HI-11 (P1): mutation `initiateRecall` con control de rol DIR/ADMIN.
 *
 * Fuente normativa: NTEC RTCA § Trazabilidad + TDR §19 Inventario GS1.
 *
 * Diseño:
 * - La tabla `ece.gs1_gtin` es el catálogo de productos GS1 del establecimiento.
 *   Su columna `recall_status` (VARCHAR 40, default 'NONE') registra el estado.
 * - `ece.gs1_epcis_event` contiene todos los eventos de movimiento (what/where/who/why).
 * - `ece.recepcion_mercancia.productos` (JSONB array) registra lotes en la recepción.
 * - `initiateRecall` solo modifica `recall_status`; la notificación downstream
 *   queda en el outbox como evento `gs1.recall.iniciado`.
 *
 * RLS: read usa tenantProcedure (sin demote porque no hay datos sensibles de
 * pacientes identificables — solo MRN anónimo si trackeable).
 * Mutation: requireRole(["ADMIN","DIRECTOR"]) + withTenantContext para audit trail.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";
import { emitDomainEvent } from "@his/database";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Enums + schemas
// ---------------------------------------------------------------------------

const severidadRecallEnum = z.enum(["VOLUNTARIO", "OBLIGATORIO", "RETIRO_MERCADO"]);

const loteTraceInput = z.object({
  lotNumber: z.string().min(1).max(50),
});

const initiateRecallInput = z.object({
  gtinId:    z.string().uuid("gtinId debe ser un UUID válido"),
  motivo:    z.string().min(10, "El motivo debe tener al menos 10 caracteres").max(1000),
  severidad: severidadRecallEnum,
});

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

interface GtinRow {
  id: string;
  codigo: string;
  descripcion: string;
  fabricante: string;
  recall_status: string | null;
  activo: boolean;
}

interface RecepcionRow {
  id: string;
  fecha: Date;
  numero_documento_recepcion: string;
  proveedor_gln: string;
  sscc_pallet: string | null;
}

interface EpcisEventRow {
  id: string;
  event_time: Date;
  subtipo: string;
  what: unknown;
  where_data: unknown;
  who: unknown;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const gs1LoteTraceRouter = router({

  /**
   * Trazabilidad completa de un número de lote.
   * Cruza: catálogo GTIN + recepciones + eventos EPCIS (movimientos).
   * Roles: cualquier usuario del tenant con acceso farmacéutico / logística.
   */
  loteTrace: requireRole(["ADMIN", "DIRECTOR", "PHARM", "REGENT"])
    .input(loteTraceInput)
    .query(async ({ ctx, input }) => {
      // 1. Buscar el GTIN en el catálogo ECE que tenga este lote en recepciones.
      //    Primero obtenemos el GTIN desde recepciones que contengan el lote.
      const gtinRows = await ctx.prisma.$queryRawUnsafe<GtinRow[]>(
        `SELECT DISTINCT g.id, g.codigo, g.descripcion,
                COALESCE(g.fabricante, '') AS fabricante,
                g.recall_status, g.activo
           FROM ece.gs1_gtin g
           JOIN ece.recepcion_mercancia r
             ON r.productos @> jsonb_build_array(jsonb_build_object('lote', $1::text))
              OR r.productos::text ILIKE $2
          WHERE g.codigo = (
            SELECT (p->>'gtin')
              FROM ece.recepcion_mercancia rm,
                   jsonb_array_elements(rm.productos) p
             WHERE p->>'lote' = $1
             LIMIT 1
          )
          LIMIT 1`,
        input.lotNumber,
        `%"lote":"${input.lotNumber}"%`,
      );

      const gtin = gtinRows[0] ?? null;

      // 2. Recepciones que contienen el lote
      const recepcionRows = await ctx.prisma.$queryRawUnsafe<RecepcionRow[]>(
        `SELECT r.id, r.fecha, r.numero_documento_recepcion,
                r.proveedor_gln, r.sscc_pallet
           FROM ece.recepcion_mercancia r
          WHERE r.productos::text ILIKE $1
          ORDER BY r.fecha DESC
          LIMIT 100`,
        `%"lote":"${input.lotNumber}"%`,
      );

      // 3. Eventos EPCIS que referencian este lote
      const movimientoRows = await ctx.prisma.$queryRawUnsafe<EpcisEventRow[]>(
        `SELECT id, event_time, subtipo, what, where_data, who
           FROM ece.gs1_epcis_event
          WHERE what->>'lote' = $1
          ORDER BY event_time ASC
          LIMIT 500`,
        input.lotNumber,
      );

      // 4. Dispensaciones — eventos EPCIS con disposition 'consumed' (bedside admin)
      const dispensacionRows = await ctx.prisma.$queryRawUnsafe<{
        id: string;
        event_time: Date;
        patient_id: string | null;
        prescripcion_id: string | null;
      }[]>(
        `SELECT id, event_time,
                who->>'patientId'     AS patient_id,
                why->>'prescripcionId' AS prescripcion_id
           FROM ece.gs1_epcis_event
          WHERE what->>'lote' = $1
            AND why->>'disposition' = 'consumed'
          ORDER BY event_time DESC
          LIMIT 200`,
        input.lotNumber,
      );

      return {
        gtin: gtin
          ? {
              id:            gtin.id,
              codigo:        gtin.codigo,
              descripcion:   gtin.descripcion,
              fabricante:    gtin.fabricante,
              recallStatus:  gtin.recall_status ?? "NONE",
            }
          : null,
        recepciones: recepcionRows.map((r) => ({
          fecha:                      r.fecha,
          cantidad:                   null, // calculable desde productos JSONB si necesario
          establecimientoOrigen:      r.proveedor_gln,
          sscc:                       r.sscc_pallet,
          numeroDocumentoRecepcion:   r.numero_documento_recepcion,
        })),
        movimientos: movimientoRows.map((e) => ({
          fecha:     e.event_time,
          tipo:      e.subtipo,
          ubicacion: e.where_data,
          cantidad:  null,
        })),
        dispensaciones: dispensacionRows.map((d) => ({
          fecha:          d.event_time,
          paciente_id:    d.patient_id,
          prescripcion_id: d.prescripcion_id,
        })),
      };
    }),

  /**
   * Inicia un proceso de recall sobre un GTIN.
   * Marca recall_status = 'INICIADO' + emite evento gs1.recall.iniciado.
   * Idempotente: si ya está en recall lanza CONFLICT.
   * Roles: ADMIN | DIRECTOR solamente (HI-11).
   */
  initiateRecall: requireRole(["ADMIN", "DIRECTOR"])
    .input(initiateRecallInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Verificar existencia y estado actual
        const rows = await tx.$queryRawUnsafe<{ recall_status: string | null }[]>(
          `SELECT recall_status FROM ece.gs1_gtin WHERE id = $1::uuid`,
          input.gtinId,
        );

        const current = rows[0];
        if (!current) {
          throw new TRPCError({ code: "NOT_FOUND", message: "GTIN no encontrado." });
        }

        const alreadyActive = current.recall_status !== null
          && current.recall_status !== "NONE"
          && current.recall_status !== "CERRADO";

        if (alreadyActive) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Este GTIN ya tiene un recall activo (estado: ${current.recall_status}).`,
          });
        }

        // Marcar recall
        await tx.$executeRawUnsafe(
          `UPDATE ece.gs1_gtin
              SET recall_status = 'INICIADO',
                  actualizado_en = now()
            WHERE id = $1::uuid`,
          input.gtinId,
        );

        // Emitir evento de dominio al outbox
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType:      "gs1.recall.iniciado",
          aggregateType:  "Gs1Gtin",
          aggregateId:    input.gtinId,
          emittedById:    ctx.user.id,
          payload: {
            gtinId:    input.gtinId,
            motivo:    input.motivo,
            severidad: input.severidad,
            iniciadoPorId: ctx.user.id,
          },
        });

        return { ok: true as const };
      });
    }),
});
