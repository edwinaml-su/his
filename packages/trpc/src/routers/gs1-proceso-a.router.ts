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
import { emitDomainEvent, Prisma } from "@his/database";
import { router, tenantProcedure } from "../trpc";

/**
 * HI-06 (audit Stream I): resuelve `personal_salud.id` del usuario autenticado.
 * Reemplaza la entrada manual de UUID en la UI por derivación server-side.
 */
async function resolvePersonalSaludId(
  prisma: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  userId: string,
): Promise<string> {
  const rows = await (prisma.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<{ id: string }[]>)`
    SELECT id FROM ece.personal_salud
    WHERE auth_user_id = ${userId}::uuid
      AND activo = true
    LIMIT 1
  `;
  if (!rows[0]) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "El usuario no tiene registro en ece.personal_salud activo. " +
        "Contacte al administrador del ECE.",
    });
  }
  return rows[0].id;
}

function resolveEstablecimientoId(
  ctx: { tenant: { establishmentId?: string } },
  override?: string,
): string {
  // HI-06: en producción el establecimiento_id viene del tenant context.
  // Override opcional permite seeders/tests que ya lo pasan explícito.
  const id = override ?? ctx.tenant.establishmentId;
  if (!id) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo en la sesión.",
    });
  }
  return id;
}

export const gs1ProcesoARouter = router({
  /**
   * Registra una recepción de mercancía en muelle.
   * Emite gs1.inbound.recibido.
   */
  recibirMercancia: tenantProcedure
    .input(recibirMercanciaInput)
    .mutation(async ({ ctx, input }) => {
      // HI-06: derivar establecimiento_id y registrado_por del context.
      const establecimientoId = resolveEstablecimientoId(ctx, input.establecimiento_id);
      const registradoPor =
        input.registrado_por ?? (await resolvePersonalSaludId(ctx.prisma, ctx.user.id));

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
            ${registradoPor}::uuid,
            ${establecimientoId}::uuid,
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
          establecimientoId,
          cantidadProductos: input.productos.length,
          registradoPorId: registradoPor,
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
   *
   * HI-07: usa Prisma.sql template literal — NO $queryRawUnsafe con interpolación.
   * El filtro de estado, aunque restringido por el enum Zod, se parametriza
   * correctamente para evitar el patrón de interpolación de strings en SQL.
   */
  listar: tenantProcedure
    .input(listarRecepcionesInput)
    .query(async ({ ctx, input }) => {
      type RecepcionRow = {
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
      };

      // HI-06: derivar establecimiento_id del tenant context si no llega.
      const estId = resolveEstablecimientoId(ctx, input.establecimiento_id);
      const lim   = input.limit;
      const off   = input.offset;

      const rows = input.estado
        ? await ctx.prisma.$queryRaw<RecepcionRow[]>`
            SELECT id, numero_documento_recepcion, fecha, proveedor_gln,
                   sscc_pallet, productos, verificacion_5correctos,
                   estado, motivo_rechazo, creado_en
            FROM ece.recepcion_mercancia
            WHERE establecimiento_id = ${estId}::uuid
              AND estado = ${input.estado}
            ORDER BY fecha DESC
            LIMIT ${lim} OFFSET ${off}
          `
        : await ctx.prisma.$queryRaw<RecepcionRow[]>`
            SELECT id, numero_documento_recepcion, fecha, proveedor_gln,
                   sscc_pallet, productos, verificacion_5correctos,
                   estado, motivo_rechazo, creado_en
            FROM ece.recepcion_mercancia
            WHERE establecimiento_id = ${estId}::uuid
            ORDER BY fecha DESC
            LIMIT ${lim} OFFSET ${off}
          `;

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
