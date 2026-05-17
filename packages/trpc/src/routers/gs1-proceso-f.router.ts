/**
 * gs1ProcesoF — Proceso F GS1: Logística inversa / Devoluciones de inventario.
 *
 * Procedimientos:
 *   solicitarDevolucion      — cualquier usuario tenant (crea en estado 'solicitado')
 *   autorizarDevolucion      — rol ARCH o admin (→ 'autorizado')
 *   registrarRecepcionDevolucion — rol ARCH o admin (→ 'recibido' | 'rechazado')
 *   listSolicitudesPendientes — tenant (lista según filtro de estado)
 *
 * Eventos de dominio emitidos (via notifications outbox):
 *   gs1.devolucion.solicitada
 *   gs1.devolucion.autorizada
 *   gs1.devolucion.recibida
 *
 * RLS: la tabla ece.devolucion_inventario usa Cat-E (establecimiento_id).
 * El router escribe directamente con prisma.$executeRaw dentro del contexto
 * de la sesión — el campo establecimiento_id se resuelve desde ctx.tenant.
 */
import { TRPCError } from "@trpc/server";
import {
  gs1DevolucionSolicitarSchema,
  gs1DevolucionAutorizarSchema,
  gs1DevolucionRecepcionSchema,
  gs1DevolucionListSchema,
  gs1DevolucionGetSchema,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";

// ece.devolucion_inventario no está en schema.prisma — usamos $queryRawUnsafe
// con parámetros posicionales para evitar inyección SQL.
// Decisión: no añadir al schema.prisma en este PR para no generar un generate
// costoso; la tabla existe en BD y se accede via raw.

export const gs1ProcesoFRouter = router({
  /**
   * Solicitar una devolución de inventario.
   * Cualquier usuario con sesión tenant puede solicitar.
   * El establecimiento se obtiene de ctx.tenant.establishmentId cuando existe,
   * o queda NULL (el router de UI deberá proveerlo si aplica multi-establecimiento).
   */
  solicitarDevolucion: tenantProcedure
    .input(gs1DevolucionSolicitarSchema)
    .mutation(async ({ ctx, input }) => {
      const fechaDev = input.fechaDevolucion ?? new Date();

      // Resolución de establecimiento_id: si el tenant tiene un establishment
      // único, úsalo; si no, dejamos NULL y RLS lo gestionará.
      const establecimientoId =
        "establishmentId" in ctx.tenant && typeof ctx.tenant.establishmentId === "string"
          ? ctx.tenant.establishmentId
          : null;

      const rows = await ctx.prisma.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO ece.devolucion_inventario
           (origen_gln, destino_gln, motivo, productos, fecha_devolucion,
            establecimiento_id, estado, notas, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'solicitado', $7, $8)
         RETURNING id`,
        input.origenGln,
        input.destinoGln,
        input.motivo,
        JSON.stringify(input.productos),
        fechaDev,
        establecimientoId,
        input.notas ?? null,
        ctx.user.id,
      );

      const devolucionId = rows[0]?.id;
      if (!devolucionId) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert fallido." });
      }

      // Emit evento de dominio via notifications outbox.
      await emitEvento(ctx, "gs1.devolucion.solicitada", {
        devolucionId,
        motivo: input.motivo,
        productos: input.productos,
        origenGln: input.origenGln,
        destinoGln: input.destinoGln,
      });

      return { id: devolucionId };
    }),

  /**
   * Autorizar una devolución (solo ARCH o admin).
   * Transición: solicitado → autorizado.
   */
  autorizarDevolucion: requireRole(["ARCH", "ADMIN"])
    .input(gs1DevolucionAutorizarSchema)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRawUnsafe<{ id: string; estado: string }[]>(
        `UPDATE ece.devolucion_inventario
            SET estado = 'autorizado',
                autorizado_por = $1,
                notas = COALESCE($2, notas),
                updated_at = now()
          WHERE id = $3
            AND estado = 'solicitado'
         RETURNING id, estado`,
        ctx.user.id,
        input.notas ?? null,
        input.devolucionId,
      );

      if (rows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Devolución no encontrada o no está en estado 'solicitado'.",
        });
      }

      await emitEvento(ctx, "gs1.devolucion.autorizada", {
        devolucionId: input.devolucionId,
        autorizadoPor: ctx.user.id,
      });

      return { id: input.devolucionId, estado: "autorizado" };
    }),

  /**
   * Registrar recepción (o rechazo) de la devolución (solo ARCH o admin).
   * Transición: en_transito → recibido | rechazado
   *             (también desde 'autorizado' si se omite despacho intermedio)
   */
  registrarRecepcionDevolucion: requireRole(["ARCH", "ADMIN"])
    .input(gs1DevolucionRecepcionSchema)
    .mutation(async ({ ctx, input }) => {
      const nuevoEstado = input.recibidoConforme ? "recibido" : "rechazado";

      const rows = await ctx.prisma.$queryRawUnsafe<{ id: string; estado: string }[]>(
        `UPDATE ece.devolucion_inventario
            SET estado = $1,
                notas = COALESCE($2, notas),
                updated_at = now()
          WHERE id = $3
            AND estado IN ('autorizado', 'en_transito')
         RETURNING id, estado`,
        nuevoEstado,
        input.notas ?? null,
        input.devolucionId,
      );

      if (rows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Devolución no encontrada o no está en estado 'autorizado'/'en_transito'.",
        });
      }

      await emitEvento(ctx, "gs1.devolucion.recibida", {
        devolucionId: input.devolucionId,
        estado: nuevoEstado,
        recibidoPor: ctx.user.id,
      });

      return { id: input.devolucionId, estado: nuevoEstado };
    }),

  /**
   * Listar solicitudes según filtro de estado.
   * Paginación por cursor (id DESC).
   */
  listSolicitudesPendientes: tenantProcedure
    .input(gs1DevolucionListSchema)
    .query(async ({ ctx, input }) => {
      // Construimos la WHERE dinámicamente pero con params posicionales.
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input.estado) {
        conditions.push(`estado = $${paramIdx++}`);
        params.push(input.estado);
      }
      if (input.motivo) {
        conditions.push(`motivo = $${paramIdx++}`);
        params.push(input.motivo);
      }
      if (input.cursor) {
        conditions.push(`id < $${paramIdx++}::uuid`);
        params.push(input.cursor);
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      params.push(input.limit + 1); // +1 para saber si hay nextCursor
      const limitParam = `$${paramIdx}`;

      const rows = await ctx.prisma.$queryRawUnsafe<
        {
          id: string;
          origen_gln: string;
          destino_gln: string;
          motivo: string;
          productos: unknown;
          fecha_devolucion: string;
          autorizado_por: string | null;
          establecimiento_id: string | null;
          estado: string;
          notas: string | null;
          created_at: string;
          updated_at: string;
          created_by: string;
        }[]
      >(
        `SELECT id, origen_gln, destino_gln, motivo, productos,
                fecha_devolucion, autorizado_por, establecimiento_id,
                estado, notas, created_at, updated_at, created_by
           FROM ece.devolucion_inventario
           ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limitParam}`,
        ...params,
      );

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

      return { items, nextCursor };
    }),

  /** Obtener una devolución por ID. */
  get: tenantProcedure
    .input(gs1DevolucionGetSchema)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRawUnsafe<
        {
          id: string;
          origen_gln: string;
          destino_gln: string;
          motivo: string;
          productos: unknown;
          fecha_devolucion: string;
          autorizado_por: string | null;
          establecimiento_id: string | null;
          estado: string;
          notas: string | null;
          created_at: string;
          updated_at: string;
          created_by: string;
        }[]
      >(
        `SELECT id, origen_gln, destino_gln, motivo, productos,
                fecha_devolucion, autorizado_por, establecimiento_id,
                estado, notas, created_at, updated_at, created_by
           FROM ece.devolucion_inventario
          WHERE id = $1`,
        input.id,
      );

      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Devolución no encontrada." });
      }
      return row;
    }),
});

// ---------------------------------------------------------------------------
// Helper interno: emit evento de dominio via notifications outbox
// ---------------------------------------------------------------------------

type RouterCtx = Parameters<Parameters<typeof tenantProcedure.mutation>[0]>[0]["ctx"];

async function emitEvento(
  ctx: RouterCtx,
  tipo: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await ctx.prisma.$executeRawUnsafe(
      `INSERT INTO public.notifications_outbox (event_type, payload, organization_id)
       VALUES ($1, $2::jsonb, $3)`,
      tipo,
      JSON.stringify(payload),
      ctx.tenant.organizationId,
    );
  } catch {
    // El fallo en el outbox no debe bloquear la operación principal.
    // El poller de outbox reintentará en el próximo ciclo.
  }
}
