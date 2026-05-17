/**
 * EPCIS Query Layer — trazabilidad sobre ece.epcis_event (schema legacy).
 *
 * La tabla ece.epcis_event tiene schema de movimientos de equipo (legacy),
 * no EPCIS 2.0 completo. Las queries se adaptan a las columnas disponibles:
 *   equipment_id, gln_destino, gln_origen, registrado_por, registrado_en, notas
 *
 * No hay GTIN, lote ni GSRN de paciente — las queries queryByGtin/queryByPatient
 * del spec original se reemplazan por queryByEquipment y queryByOrigin.
 *
 * Autorización: requireRole(["DIR","ARCH","ADMIN"]).
 */
import { z } from "zod";
import { router, requireRole } from "../trpc";

// ─── Tipos raw SQL ─────────────────────────────────────────────────────────────

interface EpcisEventRow {
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

    const rows = await ctx.prisma.$queryRawUnsafe<EpcisEventRow[]>(
      `SELECT id, equipment_id, gln_destino, gln_origen, registrado_por, registrado_en, notas
       FROM ece.epcis_event
       WHERE ${conditions.join(" AND ")}
       ORDER BY registrado_en DESC
       LIMIT 200`,
      ...params,
    );

    return rows;
  }),

  /**
   * Historia completa de un equipo (reemplaza queryByGtin — no hay GTIN en schema legacy).
   */
  queryByEquipment: adminRole.input(queryByEquipmentInput).query(async ({ ctx, input }) => {
    const conditions: string[] = ["equipment_id = $1"];
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

    const rows = await ctx.prisma.$queryRawUnsafe<EpcisEventRow[]>(
      `SELECT id, equipment_id, gln_destino, gln_origen, registrado_por, registrado_en, notas
       FROM ece.epcis_event
       WHERE ${conditions.join(" AND ")}
       ORDER BY registrado_en DESC
       LIMIT 200`,
      ...params,
    );

    return rows;
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

    const rows = await ctx.prisma.$queryRawUnsafe<EpcisEventRow[]>(
      `SELECT id, equipment_id, gln_destino, gln_origen, registrado_por, registrado_en, notas
       FROM ece.epcis_event
       ${where}
       ORDER BY registrado_en DESC
       LIMIT 200`,
      ...params,
    );

    return rows;
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

    const rows = await ctx.prisma.$queryRawUnsafe<EpcisEventRow[]>(
      `SELECT id, equipment_id, gln_destino, gln_origen, registrado_por, registrado_en, notas
       FROM ece.epcis_event
       ${where}
       ORDER BY registrado_en DESC
       LIMIT $${idx}`,
      ...params,
      input.limit,
    );

    return rows;
  }),
});
