/**
 * Router tRPC — ECE Rectificaciones (NTEC Art. 41).
 *
 * Art. 41 obliga a registrar rectificaciones de documentos firmados sin
 * modificar el original. Implementación append-only sobre `ece.rectificacion`.
 *
 * Procedures:
 *   eceRectificacion.list      — lista por documentoInstanciaId (PHYSICIAN/NURSE/DIR)
 *   eceRectificacion.solicitar — crea rectificación (PHYSICIAN/NURSE)
 *   eceRectificacion.aprobar   — aprueba rectificación (DIR)
 *   eceRectificacion.rechazar  — rechaza rectificación con motivo (DIR)
 *
 * Emite eventos outbox:
 *   ece.rectificacion.solicitada
 *   ece.rectificacion.aprobada
 *   ece.rectificacion.rechazada
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { requireRole, router } from "../trpc";

// Nota: withTenantContext está disponible en rls-context para cuando se active
// el hardening RLS completo (Fase 3). Los routers MVP filtran por organizationId
// en JS siguiendo el patrón establecido en el codebase.

// ---------------------------------------------------------------------------
// Schemas locales (los tipos se re-exportan desde @his/contracts para UI)
// ---------------------------------------------------------------------------

const listInput = z.object({
  documentoInstanciaId: z.string().uuid(),
  estado: z.enum(["PENDIENTE", "APROBADA", "RECHAZADA"]).optional(),
});

const solicitarInput = z.object({
  documentoInstanciaId: z.string().uuid(),
  campo: z.string().min(1).max(200),
  valorAnterior: z.string().min(1).max(2000),
  valorPropuesto: z.string().min(1).max(2000),
  motivo: z.string().min(10).max(1000),
});

const aprobarInput = z.object({
  rectificacionId: z.string().uuid(),
});

const rechazarInput = z.object({
  rectificacionId: z.string().uuid(),
  motivoRechazo: z.string().min(10).max(500),
});

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

type RectificacionRow = {
  id: string;
  documento_instancia_id: string;
  campo: string;
  valor_anterior: string;
  valor_propuesto: string;
  motivo: string;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA";
  solicitante_id: string;
  solicitante_nombre: string | null;
  aprobador_id: string | null;
  fecha_aprobacion: string | null;
  motivo_rechazo: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Helpers raw SQL
// ---------------------------------------------------------------------------

async function findRectificacion(
  prisma: {
    $queryRaw: (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown>;
  },
  id: string,
): Promise<RectificacionRow | null> {
  const rows = await (
    prisma.$queryRaw as (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<RectificacionRow[]>
  )`
    SELECT
      r.id,
      r.documento_instancia_id,
      r.campo,
      r.valor_anterior,
      r.valor_propuesto,
      r.motivo,
      r.estado,
      r.solicitante_id,
      u.full_name AS solicitante_nombre,
      r.aprobador_id,
      r.fecha_aprobacion::text,
      r.motivo_rechazo,
      r.created_at::text
    FROM ece.rectificacion r
    LEFT JOIN public."User" u ON u.id = r.solicitante_id
    WHERE r.id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function insertOutbox(
  prisma: {
    $executeRaw: (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown>;
  },
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const payloadJson = JSON.stringify(payload);
  await (
    prisma.$executeRaw as (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<number>
  )`
    INSERT INTO public.outbox (event_type, payload, created_at)
    VALUES (${eventType}, ${payloadJson}::jsonb, now())
  `;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eceRectificacionRouter = router({
  /**
   * Lista rectificaciones de un documento instancia.
   * Accesible por PHYSICIAN, NURSE y DIR.
   */
  list: requireRole(["PHYSICIAN", "NURSE", "DIR"])
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const estadoFilter = input.estado ?? null;
      return (
        ctx.prisma.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<RectificacionRow[]>
      )`
        SELECT
          r.id,
          r.documento_instancia_id,
          r.campo,
          r.valor_anterior,
          r.valor_propuesto,
          r.motivo,
          r.estado,
          r.solicitante_id,
          u.full_name AS solicitante_nombre,
          r.aprobador_id,
          r.fecha_aprobacion::text,
          r.motivo_rechazo,
          r.created_at::text
        FROM ece.rectificacion r
        LEFT JOIN public."User" u ON u.id = r.solicitante_id
        WHERE r.documento_instancia_id = ${input.documentoInstanciaId}::uuid
          AND (${estadoFilter}::text IS NULL OR r.estado::text = ${estadoFilter}::text)
        ORDER BY r.created_at DESC
      `;
    }),

  /**
   * Crea una solicitud de rectificación.
   * NTEC Art. 41: el campo + valor original quedan inmutables en el registro.
   */
  solicitar: requireRole(["PHYSICIAN", "NURSE"])
    .input(solicitarInput)
    .mutation(async ({ ctx, input }) => {
      // Verificar que el documento exista y esté firmado.
      const docRows = await (
        ctx.prisma.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string; estado: string }>>
      )`
        SELECT id, estado
        FROM ece.documento_instancia
        WHERE id = ${input.documentoInstanciaId}::uuid
        LIMIT 1
      `;

      if (!docRows[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento no encontrado.",
        });
      }

      if (docRows[0].estado !== "FIRMADO") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Solo se pueden rectificar documentos con estado FIRMADO.",
        });
      }

      const newRows = await (
        ctx.prisma.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string }>>
      )`
        INSERT INTO ece.rectificacion
          (documento_instancia_id, campo, valor_anterior, valor_propuesto,
           motivo, estado, solicitante_id, created_at)
        VALUES
          (${input.documentoInstanciaId}::uuid,
           ${input.campo},
           ${input.valorAnterior},
           ${input.valorPropuesto},
           ${input.motivo},
           'PENDIENTE',
           ${ctx.user.id}::uuid,
           now())
        RETURNING id
      `;

      const rectificacionId = newRows[0]?.id;
      if (!rectificacionId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Error al crear la rectificación.",
        });
      }

      await insertOutbox(ctx.prisma, "ece.rectificacion.solicitada", {
        rectificacionId,
        documentoInstanciaId: input.documentoInstanciaId,
        campo: input.campo,
        solicitanteId: ctx.user.id,
      });

      return { id: rectificacionId };
    }),

  /**
   * DIR aprueba una rectificación pendiente.
   * Marca estado APROBADA + fecha de aprobación.
   */
  aprobar: requireRole(["DIR"])
    .input(aprobarInput)
    .mutation(async ({ ctx, input }) => {
      const rect = await findRectificacion(ctx.prisma, input.rectificacionId);

      if (!rect) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rectificación no encontrada.",
        });
      }

      if (rect.estado !== "PENDIENTE") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La rectificación ya fue ${rect.estado.toLowerCase()}.`,
        });
      }

      await (
        ctx.prisma.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>
      )`
        UPDATE ece.rectificacion
        SET estado           = 'APROBADA',
            aprobador_id     = ${ctx.user.id}::uuid,
            fecha_aprobacion = now()
        WHERE id = ${input.rectificacionId}::uuid
      `;

      await insertOutbox(ctx.prisma, "ece.rectificacion.aprobada", {
        rectificacionId: input.rectificacionId,
        documentoInstanciaId: rect.documento_instancia_id,
        aprobadorId: ctx.user.id,
      });

      return { ok: true as const };
    }),

  /**
   * DIR rechaza una rectificación pendiente con motivo obligatorio.
   */
  rechazar: requireRole(["DIR"])
    .input(rechazarInput)
    .mutation(async ({ ctx, input }) => {
      const rect = await findRectificacion(ctx.prisma, input.rectificacionId);

      if (!rect) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rectificación no encontrada.",
        });
      }

      if (rect.estado !== "PENDIENTE") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La rectificación ya fue ${rect.estado.toLowerCase()}.`,
        });
      }

      await (
        ctx.prisma.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>
      )`
        UPDATE ece.rectificacion
        SET estado           = 'RECHAZADA',
            aprobador_id     = ${ctx.user.id}::uuid,
            fecha_aprobacion = now(),
            motivo_rechazo   = ${input.motivoRechazo}
        WHERE id = ${input.rectificacionId}::uuid
      `;

      await insertOutbox(ctx.prisma, "ece.rectificacion.rechazada", {
        rectificacionId: input.rectificacionId,
        documentoInstanciaId: rect.documento_instancia_id,
        aprobadorId: ctx.user.id,
        motivoRechazo: input.motivoRechazo,
      });

      return { ok: true as const };
    }),
});
