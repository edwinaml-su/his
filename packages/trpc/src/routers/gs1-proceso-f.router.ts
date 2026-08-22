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
 *
 * R02 (auditoría RLS externa) — decisión (a-ECE), evidencia 2026-08-22 (psql
 * read-only vía DIRECT_URL prod): `ece.devolucion_inventario` tiene RLS
 * activo con una única policy `devolucion_by_establecimiento` (polcmd='*',
 * cubre SELECT/INSERT/UPDATE/DELETE) `USING (establecimiento_id =
 * ece.current_establecimiento_id_safe())`, que lee el GUC ECE
 * `app.ece_establecimiento_id` — NO el de `withTenantContext`. `authenticated`
 * tiene INSERT/SELECT/UPDATE/DELETE (verificado). Antes de este cambio
 * NINGÚN procedure filtraba por establecimiento en JS —
 * `listSolicitudesPendientes`/`get` exponían devoluciones de CUALQUIER
 * establecimiento, y `solicitarDevolucion` dejaba `establecimiento_id` en
 * NULL si el tenant no tenía uno resuelto (comentario original: "RLS lo
 * gestionará" — falso, porque RLS nunca corría). Migrado a `withEceContext`
 * (packages/trpc/src/ece/rls-context.ts) en los 5 procedures, con
 * `establecimientoId` ahora REQUERIDO (antes opcional/NULL) porque la policy
 * es `establecimiento_id = current_establecimiento_id_safe()` — un NULL en
 * cualquiera de los dos lados nunca satisface el predicado (NULL = x es
 * NULL), así que dejar la columna en NULL bajo RLS real habría bloqueado el
 * INSERT por completo. `personalId` de `withEceContext` se pasa como
 * `ctx.user.id` (auth user) porque NINGUNA policy de esta tabla depende de
 * `app.ece_personal_id` — mismo patrón ya usado en gs1-proceso-c.router.ts.
 *
 * R03 (assessment externo, riesgo Alto, 2026-08-22) — FIX: `autorizado_por`
 * tiene FK a `ece.personal_salud(id)`, pero `autorizarDevolucion` le pasaba
 * `ctx.user.id` directo (el id de `public."User"`, un espacio de ids
 * DISTINTO al de `ece.personal_salud`). El UPDATE fallaba con violación de
 * FK siempre — no "salvo casualidad": `ece.personal_salud` tiene 0 filas en
 * prod (verificado 2026-08-22), así que ninguna coincidencia era posible.
 * Corregido resolviendo el `ece.personal_salud.id` real vía
 * `requirePersonalSalud` (`packages/trpc/src/lib/identity-resolver.ts`, el
 * resolver canónico introducido por R03) antes del UPDATE.
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
import { withEceContext } from "../ece/rls-context";
import { requirePersonalSalud } from "../lib/identity-resolver";

// ece.devolucion_inventario no está en schema.prisma — usamos $queryRawUnsafe
// con parámetros posicionales para evitar inyección SQL.
// Decisión: no añadir al schema.prisma en este PR para no generar un generate
// costoso; la tabla existe en BD y se accede via raw.

/** R02: exige establecimiento activo — la policy RLS de devolucion_inventario lo requiere no-NULL. */
function resolveEstablecimientoId(ctx: { tenant: { establishmentId?: string } }): string {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo en la sesión.",
    });
  }
  return ctx.tenant.establishmentId;
}

export const gs1ProcesoFRouter = router({
  /**
   * Solicitar una devolución de inventario.
   * Cualquier usuario con sesión tenant puede solicitar.
   * El establecimiento se obtiene de ctx.tenant.establishmentId — requerido
   * (R02: la policy RLS de ece.devolucion_inventario exige establecimiento_id
   * no-NULL, ver comentario de cabecera del archivo).
   */
  solicitarDevolucion: tenantProcedure
    .input(gs1DevolucionSolicitarSchema)
    .mutation(async ({ ctx, input }) => {
      const fechaDev = input.fechaDevolucion ?? new Date();
      const establecimientoId = resolveEstablecimientoId(ctx);

      const rows = await withEceContext(
        ctx.prisma,
        ctx.user.id,
        establecimientoId,
        (tx) =>
          tx.$queryRawUnsafe<{ id: string }[]>(
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
          ),
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
      const establecimientoId = resolveEstablecimientoId(ctx);
      const rows = await withEceContext(
        ctx.prisma,
        ctx.user.id,
        establecimientoId,
        async (tx) => {
          // R03: autorizado_por exige ece.personal_salud.id, no ctx.user.id.
          const personal = await requirePersonalSalud(tx, ctx.user.id, {
            action: "autorizar una devolución de inventario",
          });
          return tx.$queryRawUnsafe<{ id: string; estado: string }[]>(
            `UPDATE ece.devolucion_inventario
                SET estado = 'autorizado',
                    autorizado_por = $1,
                    notas = COALESCE($2, notas),
                    updated_at = now()
              WHERE id = $3
                AND estado = 'solicitado'
             RETURNING id, estado`,
            personal.id,
            input.notas ?? null,
            input.devolucionId,
          );
        },
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
      const establecimientoId = resolveEstablecimientoId(ctx);

      const rows = await withEceContext(
        ctx.prisma,
        ctx.user.id,
        establecimientoId,
        (tx) =>
          tx.$queryRawUnsafe<{ id: string; estado: string }[]>(
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
          ),
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
      const establecimientoId = resolveEstablecimientoId(ctx);

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

      const rows = await withEceContext(
        ctx.prisma,
        ctx.user.id,
        establecimientoId,
        (tx) =>
          tx.$queryRawUnsafe<
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
          ),
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
      const establecimientoId = resolveEstablecimientoId(ctx);
      const rows = await withEceContext(
        ctx.prisma,
        ctx.user.id,
        establecimientoId,
        (tx) =>
          tx.$queryRawUnsafe<
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
          ),
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
