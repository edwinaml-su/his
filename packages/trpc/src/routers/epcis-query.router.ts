/**
 * EPCIS Query Layer — trazabilidad sobre ece.epcis_event_equipment (equipos).
 *
 * Fix (ADR 0019, hallazgo colateral "tabla ece.epcis_event duplicada y router
 * roto"): este router apuntaba a `ece.epcis_event`, una tabla huérfana sin
 * `CREATE TABLE` en ningún SQL numerado del repo (0 filas en producción,
 * verificado 2026-08-18) — `/admin/gs1/trazabilidad` devolvía siempre vacío.
 * La tabla real con datos es `ece.epcis_event_equipment` (82_equipment_gs1_extension.sql),
 * mismo shape de columnas (equipment_id, gln_destino, gln_origen, registrado_por,
 * registrado_en, notas) — reemplazo directo. NO extender este router al stream
 * de paciente de ADR 0019 (ece.gs1_epcis_patient_event): criterio de acceso y
 * shape de columnas distintos — ver gs1-patient-trace.router.ts.
 *
 * No hay GTIN, lote ni GSRN de paciente — las queries queryByGtin/queryByPatient
 * del spec original se reemplazan por queryByEquipment y queryByOrigin.
 *
 * Autorización: requireRole(["DIR","ARCH","ADMIN"]).
 *
 * R02 (auditoria RLS externa, 2026-09-27) - decision (a), MIGRADO a
 * withTenantContext. Verificado en prod (read-only): ece.epcis_event_equipment
 * tiene RLS con policies epcis_event_equipment_select/_insert que exigen
 * EXISTS (... "BiomedicalEquipment" be WHERE be.id = equipment_id AND
 * (be."organizationId" = current_org_id() OR is_break_glass())) - exactamente
 * el aislamiento por tenant que applyTenantContext setea via app.current_org_id.
 * Antes de este cambio las 4 queries corrian con ctx.prisma.$queryRawUnsafe
 * directo (rol BYPASSRLS de Supabase) sin ningun filtro de organizacion en el
 * WHERE - un DIR/ARCH/ADMIN de una organizacion podia leer trazabilidad de
 * equipos de OTRA organizacion con solo conocer el equipmentId/GLN. Ninguna
 * policy nueva fue necesaria: la existente ya cubre el caso una vez que el rol
 * se demota a authenticated.
 */
import { z } from "zod";
import { router, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ─── Tipos raw SQL ─────────────────────────────────────────────────────────────

export interface EpcisEventRow {
  id: string;
  equipment_id: string;
  gln_destino: string;
  gln_origen: string | null;
  registrado_por: string | null;
  registrado_en: Date;
  notas: string | null;
}

// ─── Inputs ────────────────────────────────────────────────────────────────────

const dateRangeInput = z.object({
  fechaDesde: z.coerce.date().optional(),
  fechaHasta: z.coerce.date().optional(),
});

const queryByGlnInput = dateRangeInput.extend({
  gln: z.string().min(1).max(13),
});

const queryByEquipmentInput = dateRangeInput.extend({
  equipmentId: z.string().uuid(),
});

const queryByOriginInput = dateRangeInput.extend({
  glnOrigen: z.string().min(1).max(13).optional(),
  glnDestino: z.string().min(1).max(13).optional(),
}).refine((d) => d.glnOrigen !== undefined || d.glnDestino !== undefined, {
  message: "Se requiere al menos glnOrigen o glnDestino.",
});

const queryRecentInput = dateRangeInput.extend({
  limit: z.number().int().min(1).max(200).default(50),
});

// ─── Router ────────────────────────────────────────────────────────────────────

const adminRole = requireRole(["DIR", "ARCH", "ADMIN"]);

export const epcisQueryRouter = router({
  /**
   * Historia completa de eventos en una ubicación GLN.
   * Busca tanto en gln_destino como en gln_origen.
   */
  queryByGln: adminRole.input(queryByGlnInput).query(async ({ ctx, input }) => {
    const conditions: string[] = [
      "(gln_destino = $1 OR gln_origen = $1)",
    ];
    const params: unknown[] = [input.gln];
    let idx = 2;

    if (input.fechaDesde) {
      conditions.push(`registrado_en >= $${idx++}`);
      params.push(input.fechaDesde);
    }
    if (input.fechaHasta) {
      conditions.push(`registrado_en <= $${idx++}`);
      params.push(input.fechaHasta);
    }

    return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
      tx.$queryRawUnsafe<EpcisEventRow[]>(
        `SELECT id, equipment_id, gln_destino, gln_origen, registrado_por, registrado_en, notas
         FROM ece.epcis_event_equipment
         WHERE ${conditions.join(" AND ")}
         ORDER BY registrado_en DESC
         LIMIT 200`,
        ...params,
      ),
    );
  }),

  /**
   * Historia completa de un equipo (reemplaza queryByGtin — no hay GTIN en schema legacy).
   */
  queryByEquipment: adminRole.input(queryByEquipmentInput).query(async ({ ctx, input }) => {
    const conditions: string[] = ["equipment_id = $1::uuid"];
    const params: unknown[] = [input.equipmentId];
    let idx = 2;

    if (input.fechaDesde) {
      conditions.push(`registrado_en >= $${idx++}`);
      params.push(input.fechaDesde);
    }
    if (input.fechaHasta) {
      conditions.push(`registrado_en <= $${idx++}`);
      params.push(input.fechaHasta);
    }

    return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
      tx.$queryRawUnsafe<EpcisEventRow[]>(
        `SELECT id, equipment_id, gln_destino, gln_origen, registrado_por, registrado_en, notas
         FROM ece.epcis_event_equipment
         WHERE ${conditions.join(" AND ")}
         ORDER BY registrado_en DESC
         LIMIT 200`,
        ...params,
      ),
    );
  }),

  /**
   * Trazabilidad origen→destino entre ubicaciones GLN.
   * Equivale a queryByPatient/queryRecall del spec — adaptado al schema disponible.
   */
  queryByOrigin: adminRole.input(queryByOriginInput).query(async ({ ctx, input }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (input.glnOrigen) {
      conditions.push(`gln_origen = $${idx++}`);
      params.push(input.glnOrigen);
    }
    if (input.glnDestino) {
      conditions.push(`gln_destino = $${idx++}`);
      params.push(input.glnDestino);
    }
    if (input.fechaDesde) {
      conditions.push(`registrado_en >= $${idx++}`);
      params.push(input.fechaDesde);
    }
    if (input.fechaHasta) {
      conditions.push(`registrado_en <= $${idx++}`);
      params.push(input.fechaHasta);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
      tx.$queryRawUnsafe<EpcisEventRow[]>(
        `SELECT id, equipment_id, gln_destino, gln_origen, registrado_por, registrado_en, notas
         FROM ece.epcis_event_equipment
         ${where}
         ORDER BY registrado_en DESC
         LIMIT 200`,
        ...params,
      ),
    );
  }),

  /**
   * Eventos recientes — vista dashboard / alertas de trazabilidad.
   */
  queryRecent: adminRole.input(queryRecentInput).query(async ({ ctx, input }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (input.fechaDesde) {
      conditions.push(`registrado_en >= $${idx++}`);
      params.push(input.fechaDesde);
    }
    if (input.fechaHasta) {
      conditions.push(`registrado_en <= $${idx++}`);
      params.push(input.fechaHasta);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
      tx.$queryRawUnsafe<EpcisEventRow[]>(
        `SELECT id, equipment_id, gln_destino, gln_origen, registrado_por, registrado_en, notas
         FROM ece.epcis_event_equipment
         ${where}
         ORDER BY registrado_en DESC
         LIMIT $${idx}`,
        ...params,
        input.limit,
      ),
    );
  }),
});
