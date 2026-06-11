/**
 * Router tRPC — Conservación Diferenciada y Retención (US.F2.7.29-32).
 *
 * Norma: NTEC Art. 6 — Conservación del expediente clínico.
 * TDR §7 — Retención diferenciada según diagnóstico CIE-10.
 *
 * Procedures:
 *   retencion.reglas.list        → requireRole(["DIR","ADM"]) — catálogo reglas
 *   retencion.reglas.upsert      → requireRole(["DIR"]) — crea/actualiza regla
 *   retencion.expedientes.list   → requireRole(["DIR","ADM"]) — reporte vencimientos (US.F2.7.32)
 *   retencion.eliminacion.solicitar → requireRole(["DIR"]) — inicia workflow (US.F2.7.31)
 *   retencion.eliminacion.firmar → requireRole(["DIR","DIR_MEDICO"]) — agrega firma
 *   retencion.eliminacion.ejecutar → requireRole(["DIR"]) — ejecuta (post doble firma)
 *   retencion.eliminacion.rechazar → requireRole(["DIR","DIR_MEDICO"]) — rechaza
 *   retencion.eliminacion.list   → requireRole(["DIR","ADM"]) — cola pendientes
 *
 * RLS: withTenantContext en todas.
 *
 * @QA E2E: apps/web/e2e/fase2/retencion.spec.ts
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withTenantContext } from "../../rls-context";

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const reglaUpsertInput = z.object({
  id: z.string().uuid().optional().describe("Omitir para crear nueva regla."),
  cie10Pattern: z
    .string()
    .max(20)
    .nullable()
    .default(null)
    .describe("Patrón LIKE CIE-10 (ej. 'X%'). null = regla por defecto."),
  aniosRetencion: z
    .number()
    .int()
    .min(1)
    .max(100)
    .describe("Años de retención mínima."),
  motivoLegal: z
    .string()
    .min(5)
    .max(500)
    .describe("Base legal que justifica el período."),
  vigenteDesde: z.string().datetime({ offset: true }).optional(),
  vigenteHasta: z.string().datetime({ offset: true }).optional().nullable(),
});

const listExpedientesInput = z.object({
  diasProximos: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(90)
    .describe("Expedientes que vencen en los próximos N días."),
  estadoConservacion: z
    .enum(["ACTIVO", "PASIVO", "POR_ELIMINAR"])
    .optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const solicitarEliminacionInput = z.object({
  episodioId: z.string().uuid(),
  motivoBaja: z
    .string()
    .min(20, "Motivo mínimo 20 caracteres.")
    .max(2000),
  reglaRetencionId: z.string().uuid().optional(),
});

const firmarEliminacionInput = z.object({
  eliminacionId: z.string().uuid(),
  firmaPin: z.string().min(4).max(20).describe("PIN argon2id del firmante."),
  numeroFirma: z.literal(1).or(z.literal(2)).describe("Primera o segunda firma."),
});

const ejecutarEliminacionInput = z.object({
  eliminacionId: z.string().uuid(),
});

const rechazarEliminacionInput = z.object({
  eliminacionId: z.string().uuid(),
  motivoRechazo: z.string().min(10).max(1000),
});

const listEliminacionInput = z.object({
  estado: z.enum(["SOLICITADA", "APROBADA", "RECHAZADA", "EJECUTADA"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Sub-router: reglas de retención
// ---------------------------------------------------------------------------

const reglasRouter = router({
  list: requireRole(["DIR", "ADM"]).query(async ({ ctx }) => {
    const orgId = ctx.tenant.organizationId;
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      return tx.$queryRaw<
        Array<{
          id: string;
          cie10_pattern: string | null;
          anios_retencion: number;
          motivo_legal: string;
          vigente_desde: Date;
          vigente_hasta: Date | null;
        }>
      >`
        SELECT id, cie10_pattern, anios_retencion, motivo_legal, vigente_desde, vigente_hasta
        FROM ece.regla_retencion
        WHERE organization_id = ${orgId}::uuid
          AND (vigente_hasta IS NULL OR vigente_hasta >= CURRENT_DATE)
        ORDER BY cie10_pattern NULLS LAST, vigente_desde DESC
      `;
    });
  }),

  upsert: requireRole(["DIR"])
    .input(reglaUpsertInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        if (input.id) {
          // Actualizar
          await tx.$executeRaw`
            UPDATE ece.regla_retencion
            SET cie10_pattern    = ${input.cie10Pattern},
                anios_retencion  = ${input.aniosRetencion},
                motivo_legal     = ${input.motivoLegal},
                vigente_hasta    = ${input.vigenteHasta ? new Date(input.vigenteHasta) : null}
            WHERE id = ${input.id}::uuid
              AND organization_id = ${orgId}::uuid
          `;
          return { id: input.id };
        }

        // Insertar
        const rows = await tx.$queryRaw<[{ id: string }]>`
          INSERT INTO ece.regla_retencion
            (organization_id, cie10_pattern, anios_retencion, motivo_legal,
             vigente_desde, vigente_hasta, created_by_id)
          VALUES (
            ${orgId}::uuid,
            ${input.cie10Pattern},
            ${input.aniosRetencion},
            ${input.motivoLegal},
            ${input.vigenteDesde ? new Date(input.vigenteDesde) : new Date()},
            ${input.vigenteHasta ? new Date(input.vigenteHasta) : null},
            ${userId}::uuid
          )
          RETURNING id
        `;
        return { id: rows[0]!.id };
      });
    }),
});

// ---------------------------------------------------------------------------
// Sub-router: expedientes (reporte US.F2.7.32)
// ---------------------------------------------------------------------------

const expedientesRouter = router({
  list: requireRole(["DIR", "ADM"])
    .input(listExpedientesInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const estadoFilter = input.estadoConservacion
          ? `AND ea.estado_conservacion = ${input.estadoConservacion}::ece.estado_conservacion`
          : "";

        return tx.$queryRaw<
          Array<{
            episodio_id: string;
            paciente_id: string;
            fecha_hora_inicio: Date;
            fecha_vencimiento_retencion: Date | null;
            estado_conservacion: string;
            dias_para_vencer: number | null;
          }>
        >`
          SELECT
            ea.id                          AS episodio_id,
            ea.paciente_id,
            ea.fecha_hora_inicio,
            ea.fecha_vencimiento_retencion,
            ea.estado_conservacion::text,
            CASE
              WHEN ea.fecha_vencimiento_retencion IS NOT NULL
              THEN EXTRACT(DAY FROM ea.fecha_vencimiento_retencion - now())::INT
              ELSE NULL
            END                            AS dias_para_vencer
          FROM ece.episodio_atencion ea
          -- episodio_atencion no tiene organization_id; tenant scope vía establecimiento_id
          JOIN ece.establecimiento est ON est.id = ea.establecimiento_id
          WHERE est.organization_id = ${orgId}::uuid
            AND ea.fecha_vencimiento_retencion IS NOT NULL
            AND ea.fecha_vencimiento_retencion <= now() + (${input.diasProximos} || ' days')::interval
            AND (${input.estadoConservacion ?? null}::text IS NULL
                 OR ea.estado_conservacion::text = ${input.estadoConservacion ?? null}::text)
          ORDER BY ea.fecha_vencimiento_retencion ASC
          LIMIT ${input.limit} OFFSET ${input.offset}
        `;
      });
    }),
});

// ---------------------------------------------------------------------------
// Sub-router: eliminación supervisada (US.F2.7.31)
// ---------------------------------------------------------------------------

const eliminacionRouter = router({
  solicitar: requireRole(["DIR"])
    .input(solicitarEliminacionInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Verificar que el episodio pertenece a la org y no tiene solicitud activa.
        const episodioRows = await tx.$queryRaw<
          Array<{ id: string; fecha_vencimiento_retencion: Date | null }>
        >`
          SELECT id, fecha_vencimiento_retencion
          FROM ece.episodio_atencion
          WHERE id = ${input.episodioId}::uuid
            AND organization_id = ${orgId}::uuid
          LIMIT 1
        `;
        if (!episodioRows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Episodio no encontrado.",
          });
        }

        const pendiente = await tx.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*)::bigint AS count
          FROM ece.eliminacion_supervisada
          WHERE episodio_id = ${input.episodioId}::uuid
            AND estado IN ('SOLICITADA','APROBADA')
        `;
        if (pendiente[0]!.count > 0n) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Ya existe una solicitud de eliminación activa para este episodio.",
          });
        }

        const rows = await tx.$queryRaw<[{ id: string }]>`
          INSERT INTO ece.eliminacion_supervisada
            (organization_id, episodio_id, solicitado_por_id, motivo_baja,
             regla_retencion_id, fecha_vencimiento_retencion)
          VALUES (
            ${orgId}::uuid,
            ${input.episodioId}::uuid,
            ${userId}::uuid,
            ${input.motivoBaja},
            ${input.reglaRetencionId ?? null}::uuid,
            ${episodioRows[0].fecha_vencimiento_retencion}
          )
          RETURNING id
        `;

        // Marcar episodio como POR_ELIMINAR.
        await tx.$executeRaw`
          UPDATE ece.episodio_atencion
          SET estado_conservacion = 'POR_ELIMINAR'::ece.estado_conservacion
          WHERE id = ${input.episodioId}::uuid
        `;

        return { id: rows[0]!.id };
      });
    }),

  firmar: requireRole(["DIR", "DIR_MEDICO"])
    .input(firmarEliminacionInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const elim = await tx.$queryRaw<
          Array<{
            id: string;
            estado: string;
            firma_dir1_id: string | null;
            firma_dir2_id: string | null;
          }>
        >`
          SELECT id, estado::text, firma_dir1_id, firma_dir2_id
          FROM ece.eliminacion_supervisada
          WHERE id = ${input.eliminacionId}::uuid
            AND organization_id = ${orgId}::uuid
          LIMIT 1
        `;
        const row = elim[0];
        if (!row) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Solicitud no encontrada." });
        }
        if (row.estado !== "SOLICITADA" && row.estado !== "APROBADA") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No se puede firmar en estado ${row.estado}.`,
          });
        }

        // Obtener firma_electronica del usuario actual.
        const firmaRows = await tx.$queryRaw<[{ id: string }]>`
          SELECT fe.id
          FROM ece.firma_electronica fe
          JOIN ece.personal_salud ps ON ps.id = fe.personal_id
          WHERE ps.his_user_id = ${userId}::uuid
            AND fe.revoked_at IS NULL
            AND (fe.locked_until IS NULL OR fe.locked_until < now())
          LIMIT 1
        `;
        if (!firmaRows[0]) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "El usuario no tiene firma electrónica activa.",
          });
        }
        const firmaId = firmaRows[0].id;

        // Evitar que la misma firma aparezca dos veces.
        if (row.firma_dir1_id === firmaId || row.firma_dir2_id === firmaId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Esta firma ya fue registrada en la solicitud.",
          });
        }

        if (input.numeroFirma === 1) {
          if (row.firma_dir1_id) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "La primera firma ya fue registrada.",
            });
          }
          await tx.$executeRaw`
            UPDATE ece.eliminacion_supervisada
            SET firma_dir1_id = ${firmaId}::uuid
            WHERE id = ${input.eliminacionId}::uuid
          `;
        } else {
          if (!row.firma_dir1_id) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "La primera firma aún no ha sido registrada.",
            });
          }
          if (row.firma_dir2_id) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "La segunda firma ya fue registrada.",
            });
          }
          // Segunda firma completa la aprobación.
          await tx.$executeRaw`
            UPDATE ece.eliminacion_supervisada
            SET firma_dir2_id    = ${firmaId}::uuid,
                estado           = 'APROBADA'::ece.estado_eliminacion,
                fecha_aprobacion = now()
            WHERE id = ${input.eliminacionId}::uuid
          `;
        }

        return { ok: true, numeroFirma: input.numeroFirma };
      });
    }),

  ejecutar: requireRole(["DIR"])
    .input(ejecutarEliminacionInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const elim = await tx.$queryRaw<
          Array<{
            id: string;
            estado: string;
            episodio_id: string;
            firma_dir1_id: string | null;
            firma_dir2_id: string | null;
          }>
        >`
          SELECT id, estado::text, episodio_id, firma_dir1_id, firma_dir2_id
          FROM ece.eliminacion_supervisada
          WHERE id = ${input.eliminacionId}::uuid
            AND organization_id = ${orgId}::uuid
          LIMIT 1
        `;
        const row = elim[0];
        if (!row) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Solicitud no encontrada." });
        }
        if (row.estado !== "APROBADA") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se puede ejecutar en estado APROBADA. Estado actual: ${row.estado}.`,
          });
        }
        if (!row.firma_dir1_id || !row.firma_dir2_id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Se requieren dos firmas electrónicas para ejecutar la eliminación.",
          });
        }

        // NO borrado físico — marca episodio como eliminado (audit preservado).
        await tx.$executeRaw`
          UPDATE ece.eliminacion_supervisada
          SET estado           = 'EJECUTADA'::ece.estado_eliminacion,
              fecha_ejecucion  = now()
          WHERE id = ${input.eliminacionId}::uuid
        `;

        // El episodio queda en POR_ELIMINAR pero se añade flag de ejecución vía estado_conservacion.
        // Los datos reales NO se borran: cumple inmutabilidad audit §TDR 6.3.
        await tx.$executeRaw`
          UPDATE ece.episodio_atencion
          SET estado_conservacion = 'POR_ELIMINAR'::ece.estado_conservacion,
              estado = 'eliminado'
          WHERE id = ${row.episodio_id}::uuid
        `;

        return { ok: true };
      });
    }),

  rechazar: requireRole(["DIR", "DIR_MEDICO"])
    .input(rechazarEliminacionInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const updated = await tx.$executeRaw`
          UPDATE ece.eliminacion_supervisada
          SET estado          = 'RECHAZADA'::ece.estado_eliminacion,
              fecha_rechazo   = now(),
              motivo_rechazo  = ${input.motivoRechazo}
          WHERE id = ${input.eliminacionId}::uuid
            AND organization_id = ${orgId}::uuid
            AND estado IN ('SOLICITADA','APROBADA')
        `;
        if (updated === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Solicitud no encontrada o no puede ser rechazada en su estado actual.",
          });
        }

        // Revertir episodio a PASIVO (ya no está en cola de eliminación).
        const elimRows = await tx.$queryRaw<[{ episodio_id: string }]>`
          SELECT episodio_id FROM ece.eliminacion_supervisada
          WHERE id = ${input.eliminacionId}::uuid
        `;
        if (elimRows[0]) {
          await tx.$executeRaw`
            UPDATE ece.episodio_atencion
            SET estado_conservacion = 'PASIVO'::ece.estado_conservacion
            WHERE id = ${elimRows[0].episodio_id}::uuid
          `;
        }

        return { ok: true };
      });
    }),

  list: requireRole(["DIR", "ADM"])
    .input(listEliminacionInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.$queryRaw<
          Array<{
            id: string;
            episodio_id: string;
            estado: string;
            motivo_baja: string;
            created_at: Date;
            fecha_aprobacion: Date | null;
            fecha_ejecucion: Date | null;
          }>
        >`
          SELECT id, episodio_id, estado::text, motivo_baja, created_at,
                 fecha_aprobacion, fecha_ejecucion
          FROM ece.eliminacion_supervisada
          WHERE organization_id = ${orgId}::uuid
            ${input.estado ? Prisma.raw(`AND estado = '${input.estado}'::ece.estado_eliminacion`) : Prisma.raw("")}
          ORDER BY created_at DESC
          LIMIT ${input.limit} OFFSET ${input.offset}
        `;
      });
    }),
});

// ---------------------------------------------------------------------------
// Router raíz — retencion
// ---------------------------------------------------------------------------

export const retencionRouter = router({
  reglas: reglasRouter,
  expedientes: expedientesRouter,
  eliminacion: eliminacionRouter,
});

import { Prisma } from "@prisma/client";

export type RetencionRouter = typeof retencionRouter;
