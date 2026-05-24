/**
 * Router tRPC: Medicamentos GTIN — US.F2.6.4.
 *
 * Extiende la entidad gs1_gtin con:
 *   - Filtros de lista: recallStatus, vencimientos próximos.
 *   - Campos ricos: principios activos (array), excipientes alergénicos (array),
 *     sustituciones (pares de GTIN), recallStatus / recallMotivo.
 *   - Mutaciones: update, markRecall, linkSubstitute.
 *
 * Los datos de principios activos y excipientes se almacenan como JSONB
 * en las columnas `principios_activos` y `excipientes_alergenos` de gs1_gtin.
 * Si esas columnas no existen aún en la BD, las queries hacen COALESCE con '[]'::jsonb.
 *
 * Seguridad:
 *   Lectura:   tenantProcedure.
 *   Escritura: requireRole(["ADMIN","PHARM","LOGISTIC"]) salvo markRecall que requiere ADMIN.
 *   withTenantContext en todas las mutaciones.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

import { gs1CheckDigitValid } from "@his/contracts";

const gtinSchema = z
  .string()
  .length(14)
  .regex(/^\d{14}$/, "GTIN-14: 14 dígitos numéricos")
  .refine(gs1CheckDigitValid, "Dígito verificador GS1 inválido");

const recallStatusEnum = z.enum(["NONE", "ALERTA", "RECALL_VOLUNTARIO", "RECALL_REGULATORIO"]);

const medicationFilterSchema = z.object({
  recallStatus:       recallStatusEnum.optional(),
  vencimientosDias:   z.number().int().min(1).max(365).optional(),
  limit:              z.number().int().min(1).max(200).default(50),
  offset:             z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Tipos internos de BD
// ---------------------------------------------------------------------------

interface MedicationRow {
  id: string;
  codigo: string;
  descripcion: string;
  fabricante: string;
  presentacion: string;
  contenido_unidades: string;
  principio_activo: string | null;
  codigo_atc: string | null;
  activo: boolean;
  creado_en: Date;
  // Columnas extendidas — pueden ser null si la migración aún no las tiene.
  principios_activos: unknown;
  excipientes_alergenos: unknown;
  recall_status: string | null;
  recall_motivo: string | null;
  recall_fecha: Date | null;
  lote_vencimiento: Date | null;
}

function mapMedicationRow(r: MedicationRow) {
  return {
    id: r.id,
    codigo: r.codigo,
    descripcion: r.descripcion,
    fabricante: r.fabricante,
    presentacion: r.presentacion,
    contenidoUnidades: parseFloat(r.contenido_unidades),
    principioActivo: r.principio_activo,
    codigoAtc: r.codigo_atc,
    activo: r.activo,
    creadoEn: r.creado_en,
    principiosActivos: (r.principios_activos as string[] | null) ?? [],
    excipientesAlergenos: (r.excipientes_alergenos as string[] | null) ?? [],
    recallStatus: (r.recall_status as z.infer<typeof recallStatusEnum> | null) ?? "NONE",
    recallMotivo: r.recall_motivo,
    recallFecha: r.recall_fecha,
    loteVencimiento: r.lote_vencimiento,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const gs1MedicationRouter = router({
  /**
   * list — tabla GTIN con filtros opcionales de recall y vencimientos próximos.
   */
  list: tenantProcedure
    .input(medicationFilterSchema)
    .query(async ({ ctx, input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (input.recallStatus) {
        conditions.push(`COALESCE(recall_status, 'NONE') = $${idx++}`);
        params.push(input.recallStatus);
      }
      if (input.vencimientosDias !== undefined) {
        conditions.push(
          `lote_vencimiento IS NOT NULL AND lote_vencimiento <= (now() + ($${idx++} || ' days')::interval)`,
        );
        params.push(input.vencimientosDias);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(input.limit, input.offset);

      const rows = await ctx.prisma.$queryRawUnsafe<MedicationRow[]>(
        `SELECT id, codigo, descripcion, fabricante, presentacion,
                contenido_unidades, principio_activo, codigo_atc, activo, creado_en,
                COALESCE(principios_activos, '[]'::jsonb) AS principios_activos,
                COALESCE(excipientes_alergenos, '[]'::jsonb) AS excipientes_alergenos,
                COALESCE(recall_status, 'NONE') AS recall_status,
                recall_motivo, recall_fecha, lote_vencimiento
           FROM ece.gs1_gtin
          ${where}
          ORDER BY descripcion
          LIMIT $${idx++} OFFSET $${idx++}`,
        ...params,
      );

      return rows.map(mapMedicationRow);
    }),

  /**
   * get — detalle completo de un GTIN por id.
   */
  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRawUnsafe<MedicationRow[]>(
        `SELECT id, codigo, descripcion, fabricante, presentacion,
                contenido_unidades, principio_activo, codigo_atc, activo, creado_en,
                COALESCE(principios_activos, '[]'::jsonb) AS principios_activos,
                COALESCE(excipientes_alergenos, '[]'::jsonb) AS excipientes_alergenos,
                COALESCE(recall_status, 'NONE') AS recall_status,
                recall_motivo, recall_fecha, lote_vencimiento
           FROM ece.gs1_gtin WHERE id = $1::uuid`,
        input.id,
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Medicamento no encontrado" });
      return mapMedicationRow(row);
    }),

  /**
   * update — actualiza campos básicos + principios activos + excipientes.
   */
  update: requireRole(["ADMIN", "PHARM", "LOGISTIC"])
    .input(
      z.object({
        id:                   z.string().uuid(),
        descripcion:          z.string().min(1).max(500).optional(),
        fabricante:           z.string().min(1).max(300).optional(),
        presentacion:         z.string().min(1).max(200).optional(),
        contenidoUnidades:    z.number().positive().optional(),
        principioActivo:      z.string().max(300).optional(),
        codigoAtc:            z.string().regex(/^[A-Z]\d{2}[A-Z]{2}\d{2}$/).optional(),
        principiosActivos:    z.array(z.string().min(1).max(200)).optional(),
        excipientesAlergenos: z.array(z.string().min(1).max(200)).optional(),
        loteVencimiento:      z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      if (Object.keys(fields).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sin campos a actualizar" });
      }

      await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const sets: string[] = [];
        const params: unknown[] = [];
        let idx = 1;

        if (fields.descripcion !== undefined)          { sets.push(`descripcion = $${idx++}`);          params.push(fields.descripcion); }
        if (fields.fabricante !== undefined)           { sets.push(`fabricante = $${idx++}`);           params.push(fields.fabricante); }
        if (fields.presentacion !== undefined)         { sets.push(`presentacion = $${idx++}`);         params.push(fields.presentacion); }
        if (fields.contenidoUnidades !== undefined)    { sets.push(`contenido_unidades = $${idx++}`);   params.push(fields.contenidoUnidades); }
        if (fields.principioActivo !== undefined)      { sets.push(`principio_activo = $${idx++}`);     params.push(fields.principioActivo); }
        if (fields.codigoAtc !== undefined)            { sets.push(`codigo_atc = $${idx++}`);           params.push(fields.codigoAtc); }
        if (fields.principiosActivos !== undefined)    { sets.push(`principios_activos = $${idx++}::jsonb`);    params.push(JSON.stringify(fields.principiosActivos)); }
        if (fields.excipientesAlergenos !== undefined) { sets.push(`excipientes_alergenos = $${idx++}::jsonb`); params.push(JSON.stringify(fields.excipientesAlergenos)); }
        if (fields.loteVencimiento !== undefined)      { sets.push(`lote_vencimiento = $${idx++}`);     params.push(fields.loteVencimiento); }

        sets.push(`actualizado_en = now()`);
        params.push(id);

        await tx.$executeRawUnsafe(
          `UPDATE ece.gs1_gtin SET ${sets.join(", ")} WHERE id = $${idx}::uuid`,
          ...params,
        );
      });

      return { ok: true as const };
    }),

  /**
   * markRecall — marca un GTIN con estado de recall y motivo.
   * Solo ADMIN puede iniciar un recall regulatorio.
   */
  markRecall: requireRole(["ADMIN"])
    .input(
      z.object({
        id:     z.string().uuid(),
        status: recallStatusEnum.exclude(["NONE"]),
        motivo: z.string().min(10).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE ece.gs1_gtin
              SET recall_status  = $1,
                  recall_motivo  = $2,
                  recall_fecha   = now(),
                  actualizado_en = now()
            WHERE id = $3::uuid`,
          input.status,
          input.motivo,
          input.id,
        );
      });
      return { ok: true as const };
    }),

  /**
   * linkSubstitute — vincula dos GTINs como sustitutos.
   * Escribe en la tabla ece.gs1_gtin_sustitutos (si existe) o en JSONB sustituciones.
   * Implementación actual: tabla de relación con columna `autorizada`.
   */
  linkSubstitute: requireRole(["ADMIN", "PHARM"])
    .input(
      z.object({
        gtinAId:   z.string().uuid(),
        gtinBId:   z.string().uuid(),
        autorizada: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.gtinAId === input.gtinBId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Los GTINs deben ser distintos" });
      }

      await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Upsert en tabla de sustitutos. Si no existe, la mutación falla con
        // 42P01 y el error se propaga hacia el cliente con código INTERNAL_SERVER_ERROR.
        // El stream de schema (dependencia declarada) debe crear esta tabla.
        await tx.$executeRawUnsafe(
          `INSERT INTO ece.gs1_gtin_sustitutos (gtin_a_id, gtin_b_id, autorizada)
           VALUES ($1::uuid, $2::uuid, $3)
           ON CONFLICT (gtin_a_id, gtin_b_id)
           DO UPDATE SET autorizada = EXCLUDED.autorizada, actualizado_en = now()`,
          input.gtinAId,
          input.gtinBId,
          input.autorizada,
        );
      });

      return { ok: true as const };
    }),
});
