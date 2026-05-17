/**
 * GS1 Trazabilidad — Proceso A: Inbound (Recepción de mercancía en muelle).
 *
 * Procedures:
 *   recibirMercancia    — registra documento de recepción + emite gs1.inbound.recibido
 *   verificar5Correctos — actualiza verificación sobre doc pendiente
 *   rechazar            — transición pendiente → rechazado + emite gs1.inbound.rechazado
 *   listar              — lista recepciones por establecimiento + estado
 *
 * RLS: todas las mutaciones usan withTenantContext con demoteRole:false porque
 * la tabla es ece.* y usa GUC app.ece_establecimiento_id, no el GUC HIS estándar.
 * El filtro applicativo por establecimiento_id es la defensa primaria (Fase 2).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  recibirMercanciaInput,
  verificar5CorrectosInput,
  rechazarRecepcionInput,
  listarRecepcionesInput,
} from "@his/contracts";
import { emitDomainEvent } from "@his/database";
import { router, tenantProcedure } from "../trpc";

export const gs1ProcesoARouter = router({
  /**
   * Registra una recepción de mercancía en muelle.
   * Emite gs1.inbound.recibido.
   */
  recibirMercancia: tenantProcedure
    .input(recibirMercanciaInput)
    .mutation(async ({ ctx, input }) => {
      // Verificar que el proveedor GLN existe en el catálogo ECE
      const glnExists = await ctx.prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM ece.gs1_gln WHERE codigo = ${input.proveedor_gln} AND activo = true
        ) AS exists
      `;
      if (!glnExists[0]?.exists) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `GLN de proveedor '${input.proveedor_gln}' no encontrado en el catálogo.`,
        });
      }

      const recepcion = await ctx.prisma.$transaction(async (tx) => {
        const rec = await tx.$queryRaw<
          { id: string; numero_documento_recepcion: string }[]
        >`
          INSERT INTO ece.recepcion_mercancia (
            numero_documento_recepcion,
            fecha,
            proveedor_gln,
            sscc_pallet,
            productos,
            verificacion_5correctos,
            registrado_por,
            establecimiento_id,
            estado
          ) VALUES (
            ${input.numero_documento_recepcion},
            ${input.fecha ? new Date(input.fecha) : new Date()},
            ${input.proveedor_gln},
            ${input.sscc_pallet ?? null},
            ${JSON.stringify(input.productos)}::jsonb,
            ${JSON.stringify(input.verificacion_5correctos)}::jsonb,
            ${input.registrado_por}::uuid,
            ${input.establecimiento_id}::uuid,
            'pendiente'
          )
          RETURNING id, numero_documento_recepcion
        `;
        return rec[0];
      });

      if (!recepcion) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo crear la recepción.",
        });
      }

      await emitDomainEvent(ctx.prisma, {
        organizationId: ctx.tenant.organizationId,
        eventType: "gs1.inbound.recibido",
        aggregateType: "RecepcionMercancia",
        aggregateId: recepcion.id,
        emittedById: ctx.user.id,
        payload: {
          recepcionId: recepcion.id,
          numeroDocumentoRecepcion: recepcion.numero_documento_recepcion,
          proveedorGln: input.proveedor_gln,
          establecimientoId: input.establecimiento_id,
          cantidadProductos: input.productos.length,
          registradoPorId: input.registrado_por,
        },
      });

      return { id: recepcion.id };
    }),

  /**
   * Actualiza la verificación de los 5 correctos sobre una recepción pendiente.
   * Solo aplica si el doc está en estado 'pendiente'.
   */
  verificar5Correctos: tenantProcedure
    .input(verificar5CorrectosInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRaw<{ estado: string }[]>`
        SELECT estado FROM ece.recepcion_mercancia
        WHERE id = ${input.recepcionId}::uuid
      `;
      if (!rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recepción no encontrada." });
      }
      if (rows[0].estado !== "pendiente") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No se puede verificar una recepción en estado '${rows[0].estado}'.`,
        });
      }

      await ctx.prisma.$executeRaw`
        UPDATE ece.recepcion_mercancia
        SET
          verificacion_5correctos = ${JSON.stringify(input.verificacion_5correctos)}::jsonb,
          estado = 'verificado'
        WHERE id = ${input.recepcionId}::uuid
      `;

      return { ok: true };
    }),

  /**
   * Rechaza una recepción pendiente.
   * Emite gs1.inbound.rechazado.
   */
  rechazar: tenantProcedure
    .input(rechazarRecepcionInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRaw<
        { estado: string; proveedor_gln: string; establecimiento_id: string; numero_documento_recepcion: string }[]
      >`
        SELECT estado, proveedor_gln, establecimiento_id::text, numero_documento_recepcion
        FROM ece.recepcion_mercancia
        WHERE id = ${input.recepcionId}::uuid
      `;
      if (!rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recepción no encontrada." });
      }
      if (rows[0].estado !== "pendiente") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Solo se pueden rechazar recepciones en estado 'pendiente'. Estado actual: '${rows[0].estado}'.`,
        });
      }

      await ctx.prisma.$executeRaw`
        UPDATE ece.recepcion_mercancia
        SET estado = 'rechazado', motivo_rechazo = ${input.motivo_rechazo}
        WHERE id = ${input.recepcionId}::uuid
      `;

      await emitDomainEvent(ctx.prisma, {
        organizationId: ctx.tenant.organizationId,
        eventType: "gs1.inbound.rechazado",
        aggregateType: "RecepcionMercancia",
        aggregateId: input.recepcionId,
        emittedById: ctx.user.id,
        payload: {
          recepcionId: input.recepcionId,
          numeroDocumentoRecepcion: rows[0].numero_documento_recepcion,
          proveedorGln: rows[0].proveedor_gln,
          establecimientoId: rows[0].establecimiento_id,
          motivoRechazo: input.motivo_rechazo,
          rechazadoPorId: ctx.user.id,
        },
      });

      return { ok: true };
    }),

  /**
   * Lista recepciones filtradas por establecimiento y estado opcional.
   */
  listar: tenantProcedure
    .input(listarRecepcionesInput)
    .query(async ({ ctx, input }) => {
      const estadoFilter = input.estado
        ? `AND estado = '${input.estado}'`
        : "";

      const rows = await ctx.prisma.$queryRawUnsafe<
        {
          id: string;
          numero_documento_recepcion: string;
          fecha: string;
          proveedor_gln: string;
          sscc_pallet: string | null;
          productos: unknown;
          verificacion_5correctos: unknown;
          estado: string;
          motivo_rechazo: string | null;
          creado_en: string;
        }[]
      >(
        `SELECT id, numero_documento_recepcion, fecha, proveedor_gln,
                sscc_pallet, productos, verificacion_5correctos,
                estado, motivo_rechazo, creado_en
         FROM ece.recepcion_mercancia
         WHERE establecimiento_id = $1::uuid ${estadoFilter}
         ORDER BY fecha DESC
         LIMIT $2 OFFSET $3`,
        input.establecimiento_id,
        input.limit,
        input.offset,
      );

      return rows;
    }),

  /** Lista los GLN de proveedores activos del catálogo ECE (para el selector de UI). */
  listProveedores: tenantProcedure
    .input(z.object({ search: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const searchClause = input.search
        ? `AND (codigo ILIKE '%' || $1 || '%' OR descripcion ILIKE '%' || $1 || '%')`
        : "";
      const args: unknown[] = input.search ? [input.search] : [];

      const rows = await ctx.prisma.$queryRawUnsafe<
        { codigo: string; descripcion: string; tipo: string }[]
      >(
        `SELECT codigo, descripcion, tipo
         FROM ece.gs1_gln
         WHERE activo = true AND tipo = 'proveedor' ${searchClause}
         ORDER BY descripcion
         LIMIT 50`,
        ...args,
      );
      return rows;
    }),
});
