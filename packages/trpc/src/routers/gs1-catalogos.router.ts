/**
 * Router tRPC: Catálogos GS1 Healthcare Standards.
 *
 * Cubre las 5 entidades GS1 del schema ece:
 *   gs1_gtin  — Global Trade Item Number (productos/medicamentos)
 *   gs1_gln   — Global Location Number (ubicaciones físicas)
 *   gs1_sscc  — Serial Shipping Container Code (pallets/containers)
 *   gs1_gsrn  — Global Service Relation Number (pacientes y staff)
 *   gs1_giai  — Global Individual Asset Identifier (equipos médicos)
 *
 * Seguridad:
 *   Lectura (list/get):  tenantProcedure — cualquier usuario del tenant.
 *   Escritura (create/update/deactivate): requireRole(["ADMIN","PHARM","LOGISTIC"]).
 *
 * Todas las mutaciones corren dentro de withTenantContext para que RLS
 * se aplique al rol `authenticated` (BYPASSRLS no aplica a authenticated).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";

// ---------------------------------------------------------------------------
// Schemas Zod compartidos
// ---------------------------------------------------------------------------

/** Valida dígito verificador GS1 Módulo-10 en cliente (espeja la función SQL). */
function gs1CheckDigitValid(code: string): boolean {
  const len = code.length;
  let sum = 0;
  for (let i = 0; i < len - 1; i++) {
    const weight = (len - 1 - i) % 2 === 0 ? 3 : 1;
    sum += parseInt(code[i]!, 10) * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === parseInt(code[len - 1]!, 10);
}

const gtinSchema = z
  .string()
  .length(14)
  .regex(/^\d{14}$/, "GTIN-14: 14 dígitos numéricos")
  .refine(gs1CheckDigitValid, "Dígito verificador GS1 inválido");

const glnSchema = z
  .string()
  .length(13)
  .regex(/^\d{13}$/, "GLN-13: 13 dígitos numéricos")
  .refine(gs1CheckDigitValid, "Dígito verificador GS1 inválido");

const ssccSchema = z
  .string()
  .length(18)
  .regex(/^\d{18}$/, "SSCC-18: 18 dígitos numéricos")
  .refine(gs1CheckDigitValid, "Dígito verificador GS1 inválido");

const gsrnSchema = z
  .string()
  .length(18)
  .regex(/^\d{18}$/, "GSRN-18: 18 dígitos numéricos")
  .refine(gs1CheckDigitValid, "Dígito verificador GS1 inválido");

const giaiSchema = z
  .string()
  .min(1)
  .max(30)
  .regex(/^[0-9A-Za-z\-.]+$/, "GIAI: caracteres alfanuméricos, guión y punto");

const paginationSchema = z.object({
  limit:  z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Sub-routers por entidad GS1
// ---------------------------------------------------------------------------

// ── GTIN ────────────────────────────────────────────────────────────────────

const gtinCreateInput = z.object({
  codigo:           gtinSchema,
  descripcion:      z.string().min(1).max(500),
  fabricante:       z.string().min(1).max(300),
  presentacion:     z.string().min(1).max(200),
  contenidoUnidades: z.number().positive(),
  principioActivo:  z.string().max(300).optional(),
  codigoAtc:        z
    .string()
    .regex(/^[A-Z]\d{2}[A-Z]{2}\d{2}$/, "Código ATC inválido (ej. A02BC01)")
    .optional(),
});

const gtinUpdateInput = gtinCreateInput.partial().extend({
  id: z.string().uuid(),
});

const gtinRouter = router({
  list: tenantProcedure
    .input(paginationSchema)
    .query(async ({ ctx, input }) => {
      type GtinRow = {
        id: string; codigo: string; descripcion: string; fabricante: string;
        presentacion: string; contenido_unidades: string; principio_activo: string | null;
        codigo_atc: string | null; activo: boolean; creado_en: Date;
      };
      const rows = await ctx.prisma.$queryRawUnsafe<GtinRow[]>(
        `SELECT id, codigo, descripcion, fabricante, presentacion,
                contenido_unidades, principio_activo, codigo_atc, activo, creado_en
           FROM ece.gs1_gtin
          ORDER BY descripcion
          LIMIT $1 OFFSET $2`,
        input.limit, input.offset,
      );
      return rows.map((r) => ({
        id: r.id, codigo: r.codigo, descripcion: r.descripcion,
        fabricante: r.fabricante, presentacion: r.presentacion,
        contenidoUnidades: parseFloat(r.contenido_unidades),
        principioActivo: r.principio_activo, codigoAtc: r.codigo_atc,
        activo: r.activo, creadoEn: r.creado_en,
      }));
    }),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      type GtinRow = {
        id: string; codigo: string; descripcion: string; fabricante: string;
        presentacion: string; contenido_unidades: string; principio_activo: string | null;
        codigo_atc: string | null; activo: boolean; creado_en: Date;
      };
      const rows = await ctx.prisma.$queryRawUnsafe<GtinRow[]>(
        `SELECT id, codigo, descripcion, fabricante, presentacion,
                contenido_unidades, principio_activo, codigo_atc, activo, creado_en
           FROM ece.gs1_gtin WHERE id = $1::uuid`,
        input.id,
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "GTIN no encontrado" });
      return {
        id: row.id, codigo: row.codigo, descripcion: row.descripcion,
        fabricante: row.fabricante, presentacion: row.presentacion,
        contenidoUnidades: parseFloat(row.contenido_unidades),
        principioActivo: row.principio_activo, codigoAtc: row.codigo_atc,
        activo: row.activo, creadoEn: row.creado_en,
      };
    }),

  create: requireRole(["ADMIN", "PHARM", "LOGISTIC"])
    .input(gtinCreateInput)
    .mutation(async ({ ctx, input }) => {
      type IdRow = { id: string };
      const rows = await ctx.prisma.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO ece.gs1_gtin
           (codigo, descripcion, fabricante, presentacion,
            contenido_unidades, principio_activo, codigo_atc)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        input.codigo, input.descripcion, input.fabricante, input.presentacion,
        input.contenidoUnidades, input.principioActivo ?? null, input.codigoAtc ?? null,
      );
      return { id: rows[0]!.id };
    }),

  update: requireRole(["ADMIN", "PHARM", "LOGISTIC"])
    .input(gtinUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      if (Object.keys(fields).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sin campos a actualizar" });
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (fields.codigo !== undefined)            { sets.push(`codigo = $${idx++}`);             params.push(fields.codigo); }
      if (fields.descripcion !== undefined)       { sets.push(`descripcion = $${idx++}`);        params.push(fields.descripcion); }
      if (fields.fabricante !== undefined)        { sets.push(`fabricante = $${idx++}`);         params.push(fields.fabricante); }
      if (fields.presentacion !== undefined)      { sets.push(`presentacion = $${idx++}`);       params.push(fields.presentacion); }
      if (fields.contenidoUnidades !== undefined) { sets.push(`contenido_unidades = $${idx++}`); params.push(fields.contenidoUnidades); }
      if (fields.principioActivo !== undefined)   { sets.push(`principio_activo = $${idx++}`);   params.push(fields.principioActivo); }
      if (fields.codigoAtc !== undefined)         { sets.push(`codigo_atc = $${idx++}`);         params.push(fields.codigoAtc); }
      sets.push(`actualizado_en = now()`);
      params.push(id);
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE ece.gs1_gtin SET ${sets.join(", ")} WHERE id = $${idx}::uuid`,
        ...params,
      );
      return { ok: true as const };
    }),

  deactivate: requireRole(["ADMIN"])
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE ece.gs1_gtin SET activo = false, actualizado_en = now() WHERE id = $1::uuid`,
        input.id,
      );
      return { ok: true as const };
    }),
});

// ── GLN ─────────────────────────────────────────────────────────────────────

const tipoGlnEnum = z.enum(["proveedor", "deposito", "farmacia", "servicio", "cama"]);

const glnCreateInput = z.object({
  codigo:             glnSchema,
  descripcion:        z.string().min(1).max(500),
  tipo:               tipoGlnEnum,
  establecimientoId:  z.string().uuid().optional(),
});

const glnRouter = router({
  list: tenantProcedure
    .input(paginationSchema.extend({ tipo: tipoGlnEnum.optional() }))
    .query(async ({ ctx, input }) => {
      type GlnRow = {
        id: string; codigo: string; descripcion: string; tipo: string;
        establecimiento_id: string | null; activo: boolean;
      };
      const conditions = ["1=1"];
      const params: unknown[] = [];
      let idx = 1;
      if (input.tipo) { conditions.push(`tipo = $${idx++}`); params.push(input.tipo); }
      params.push(input.limit, input.offset);
      const rows = await ctx.prisma.$queryRawUnsafe<GlnRow[]>(
        `SELECT id, codigo, descripcion, tipo, establecimiento_id, activo
           FROM ece.gs1_gln
          WHERE ${conditions.join(" AND ")}
          ORDER BY descripcion
          LIMIT $${idx++} OFFSET $${idx++}`,
        ...params,
      );
      return rows.map((r) => ({
        id: r.id, codigo: r.codigo, descripcion: r.descripcion,
        tipo: r.tipo, establecimientoId: r.establecimiento_id, activo: r.activo,
      }));
    }),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      type GlnRow = {
        id: string; codigo: string; descripcion: string; tipo: string;
        establecimiento_id: string | null; activo: boolean;
      };
      const rows = await ctx.prisma.$queryRawUnsafe<GlnRow[]>(
        `SELECT id, codigo, descripcion, tipo, establecimiento_id, activo
           FROM ece.gs1_gln WHERE id = $1::uuid`,
        input.id,
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "GLN no encontrado" });
      return { id: row.id, codigo: row.codigo, descripcion: row.descripcion,
               tipo: row.tipo, establecimientoId: row.establecimiento_id, activo: row.activo };
    }),

  create: requireRole(["ADMIN", "LOGISTIC"])
    .input(glnCreateInput)
    .mutation(async ({ ctx, input }) => {
      type IdRow = { id: string };
      const rows = await ctx.prisma.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO ece.gs1_gln (codigo, descripcion, tipo, establecimiento_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        input.codigo, input.descripcion, input.tipo, input.establecimientoId ?? null,
      );
      return { id: rows[0]!.id };
    }),

  deactivate: requireRole(["ADMIN"])
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE ece.gs1_gln SET activo = false, actualizado_en = now() WHERE id = $1::uuid`,
        input.id,
      );
      return { ok: true as const };
    }),
});

// ── SSCC ────────────────────────────────────────────────────────────────────

const estadoSsccEnum = z.enum(["activo", "en_transito", "recibido", "anulado"]);

const ssccCreateInput = z.object({
  codigo:         ssccSchema,
  tipoContenedor: z.string().min(1).max(200),
  origenGln:      glnSchema.optional(),
  destinoGln:     glnSchema.optional(),
  contenido:      z.array(z.record(z.unknown())).default([]),
});

const ssccRouter = router({
  list: tenantProcedure
    .input(paginationSchema.extend({ estado: estadoSsccEnum.optional() }))
    .query(async ({ ctx, input }) => {
      type SsccRow = {
        id: string; codigo: string; tipo_contenedor: string;
        origen_gln: string | null; destino_gln: string | null;
        contenido: unknown; estado: string; creado_en: Date;
      };
      const conditions = ["1=1"];
      const params: unknown[] = [];
      let idx = 1;
      if (input.estado) { conditions.push(`estado = $${idx++}`); params.push(input.estado); }
      params.push(input.limit, input.offset);
      const rows = await ctx.prisma.$queryRawUnsafe<SsccRow[]>(
        `SELECT id, codigo, tipo_contenedor, origen_gln, destino_gln,
                contenido, estado, creado_en
           FROM ece.gs1_sscc
          WHERE ${conditions.join(" AND ")}
          ORDER BY creado_en DESC
          LIMIT $${idx++} OFFSET $${idx++}`,
        ...params,
      );
      return rows.map((r) => ({
        id: r.id, codigo: r.codigo, tipoContenedor: r.tipo_contenedor,
        origenGln: r.origen_gln, destinoGln: r.destino_gln,
        contenido: r.contenido, estado: r.estado, creadoEn: r.creado_en,
      }));
    }),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      type SsccRow = {
        id: string; codigo: string; tipo_contenedor: string;
        origen_gln: string | null; destino_gln: string | null;
        contenido: unknown; estado: string; creado_en: Date;
      };
      const rows = await ctx.prisma.$queryRawUnsafe<SsccRow[]>(
        `SELECT id, codigo, tipo_contenedor, origen_gln, destino_gln,
                contenido, estado, creado_en
           FROM ece.gs1_sscc WHERE id = $1::uuid`,
        input.id,
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "SSCC no encontrado" });
      return { id: row.id, codigo: row.codigo, tipoContenedor: row.tipo_contenedor,
               origenGln: row.origen_gln, destinoGln: row.destino_gln,
               contenido: row.contenido, estado: row.estado, creadoEn: row.creado_en };
    }),

  create: requireRole(["ADMIN", "LOGISTIC"])
    .input(ssccCreateInput)
    .mutation(async ({ ctx, input }) => {
      type IdRow = { id: string };
      const rows = await ctx.prisma.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO ece.gs1_sscc
           (codigo, tipo_contenedor, origen_gln, destino_gln, contenido)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        input.codigo, input.tipoContenedor,
        input.origenGln ?? null, input.destinoGln ?? null,
        JSON.stringify(input.contenido),
      );
      return { id: rows[0]!.id };
    }),

  updateEstado: requireRole(["ADMIN", "LOGISTIC"])
    .input(z.object({ id: z.string().uuid(), estado: estadoSsccEnum }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE ece.gs1_sscc SET estado = $1, actualizado_en = now() WHERE id = $2::uuid`,
        input.estado, input.id,
      );
      return { ok: true as const };
    }),
});

// ── GSRN ────────────────────────────────────────────────────────────────────

const tipoGsrnEnum = z.enum(["paciente", "profesional"]);

const gsrnCreateInput = z.object({
  codigo:             gsrnSchema,
  tipo:               tipoGsrnEnum,
  referenciaId:       z.string().uuid(),
  establecimientoId:  z.string().uuid().optional(),
});

const gsrnRouter = router({
  list: tenantProcedure
    .input(paginationSchema.extend({ tipo: tipoGsrnEnum.optional() }))
    .query(async ({ ctx, input }) => {
      type GsrnRow = {
        id: string; codigo: string; tipo: string;
        referencia_id: string; establecimiento_id: string | null; activo: boolean;
      };
      const conditions = ["1=1"];
      const params: unknown[] = [];
      let idx = 1;
      if (input.tipo) { conditions.push(`tipo = $${idx++}`); params.push(input.tipo); }
      params.push(input.limit, input.offset);
      const rows = await ctx.prisma.$queryRawUnsafe<GsrnRow[]>(
        `SELECT id, codigo, tipo, referencia_id, establecimiento_id, activo
           FROM ece.gs1_gsrn
          WHERE ${conditions.join(" AND ")}
          ORDER BY codigo
          LIMIT $${idx++} OFFSET $${idx++}`,
        ...params,
      );
      return rows.map((r) => ({
        id: r.id, codigo: r.codigo, tipo: r.tipo,
        referenciaId: r.referencia_id, establecimientoId: r.establecimiento_id, activo: r.activo,
      }));
    }),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      type GsrnRow = {
        id: string; codigo: string; tipo: string;
        referencia_id: string; establecimiento_id: string | null; activo: boolean;
      };
      const rows = await ctx.prisma.$queryRawUnsafe<GsrnRow[]>(
        `SELECT id, codigo, tipo, referencia_id, establecimiento_id, activo
           FROM ece.gs1_gsrn WHERE id = $1::uuid`,
        input.id,
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "GSRN no encontrado" });
      return { id: row.id, codigo: row.codigo, tipo: row.tipo,
               referenciaId: row.referencia_id, establecimientoId: row.establecimiento_id,
               activo: row.activo };
    }),

  create: requireRole(["ADMIN"])
    .input(gsrnCreateInput)
    .mutation(async ({ ctx, input }) => {
      type IdRow = { id: string };
      const rows = await ctx.prisma.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO ece.gs1_gsrn (codigo, tipo, referencia_id, establecimiento_id)
         VALUES ($1, $2, $3::uuid, $4::uuid)
         RETURNING id`,
        input.codigo, input.tipo, input.referenciaId, input.establecimientoId ?? null,
      );
      return { id: rows[0]!.id };
    }),

  deactivate: requireRole(["ADMIN"])
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE ece.gs1_gsrn SET activo = false WHERE id = $1::uuid`,
        input.id,
      );
      return { ok: true as const };
    }),
});

// ── GIAI ────────────────────────────────────────────────────────────────────

const giaiCreateInput = z.object({
  codigo:      giaiSchema,
  descripcion: z.string().min(1).max(500),
  fabricante:  z.string().min(1).max(300),
  modelo:      z.string().min(1).max(200),
  serial:      z.string().min(1).max(200),
});

const giaiRouter = router({
  list: tenantProcedure
    .input(paginationSchema)
    .query(async ({ ctx, input }) => {
      type GiaiRow = {
        id: string; codigo: string; descripcion: string;
        fabricante: string; modelo: string; serial: string; activo: boolean;
      };
      const rows = await ctx.prisma.$queryRawUnsafe<GiaiRow[]>(
        `SELECT id, codigo, descripcion, fabricante, modelo, serial, activo
           FROM ece.gs1_giai
          ORDER BY descripcion
          LIMIT $1 OFFSET $2`,
        input.limit, input.offset,
      );
      return rows;
    }),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      type GiaiRow = {
        id: string; codigo: string; descripcion: string;
        fabricante: string; modelo: string; serial: string; activo: boolean;
      };
      const rows = await ctx.prisma.$queryRawUnsafe<GiaiRow[]>(
        `SELECT id, codigo, descripcion, fabricante, modelo, serial, activo
           FROM ece.gs1_giai WHERE id = $1::uuid`,
        input.id,
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "GIAI no encontrado" });
      return row;
    }),

  create: requireRole(["ADMIN", "EQUIPOS"])
    .input(giaiCreateInput)
    .mutation(async ({ ctx, input }) => {
      type IdRow = { id: string };
      const rows = await ctx.prisma.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO ece.gs1_giai (codigo, descripcion, fabricante, modelo, serial)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        input.codigo, input.descripcion, input.fabricante, input.modelo, input.serial,
      );
      return { id: rows[0]!.id };
    }),

  update: requireRole(["ADMIN", "EQUIPOS"])
    .input(giaiCreateInput.partial().extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      if (Object.keys(fields).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sin campos a actualizar" });
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (fields.codigo !== undefined)      { sets.push(`codigo = $${idx++}`);      params.push(fields.codigo); }
      if (fields.descripcion !== undefined) { sets.push(`descripcion = $${idx++}`); params.push(fields.descripcion); }
      if (fields.fabricante !== undefined)  { sets.push(`fabricante = $${idx++}`);  params.push(fields.fabricante); }
      if (fields.modelo !== undefined)      { sets.push(`modelo = $${idx++}`);      params.push(fields.modelo); }
      if (fields.serial !== undefined)      { sets.push(`serial = $${idx++}`);      params.push(fields.serial); }
      sets.push(`actualizado_en = now()`);
      params.push(id);
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE ece.gs1_giai SET ${sets.join(", ")} WHERE id = $${idx}::uuid`,
        ...params,
      );
      return { ok: true as const };
    }),

  deactivate: requireRole(["ADMIN"])
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE ece.gs1_giai SET activo = false, actualizado_en = now() WHERE id = $1::uuid`,
        input.id,
      );
      return { ok: true as const };
    }),
});

// ---------------------------------------------------------------------------
// Router principal agregado
// ---------------------------------------------------------------------------

export const gs1CatalogosRouter = router({
  gtin: gtinRouter,
  gln:  glnRouter,
  sscc: ssccRouter,
  gsrn: gsrnRouter,
  giai: giaiRouter,
});
