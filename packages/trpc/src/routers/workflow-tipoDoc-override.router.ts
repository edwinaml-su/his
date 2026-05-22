/**
 * workflow.tipoDocOverride — Fase 6 del workflow-designer enhancement.
 *
 * CRUD de `ece.tipo_documento_establecimiento` — overrides operativos del
 * catálogo central de tipos de documento NTEC por establecimiento.
 *
 * RBAC: solo rol DIR (Dirección Médica del establecimiento).
 *
 * RLS: el helper `ece.current_establecimiento_id()` filtra automáticamente —
 * un DIR no puede ver/editar overrides de otro establecimiento.
 *
 * Bitácora: cada escritura se registra en `ece.bitacora_acceso` (Art. 55-56
 * NTEC) con `componente = 'workflow.tipoDocOverride'`.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import { router, requireRole } from "../trpc";
import { withWorkflowContext } from "../ece/workflow-context";

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const upsertInput = z.object({
  tipoDocumentoId: z.string().uuid(),
  activoOverride: z.boolean().nullable().optional(),
  obligatorioOverride: z.boolean().nullable().optional(),
  dependeDeOverride: z.array(z.string().min(2).max(64)).nullable().optional(),
  notaDir: z.string().max(2000).nullable().optional(),
});

const deleteInput = z.object({
  tipoDocumentoId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Tipos de retorno
// ---------------------------------------------------------------------------

export interface TipoDocOverrideRow {
  tipo_documento_id: string;
  establecimiento_id: string;
  tipo_codigo: string;
  tipo_nombre: string;
  activo_override: boolean | null;
  obligatorio_override: boolean | null;
  depende_de_override: string[] | null;
  nota_dir: string | null;
  creado_por: string;
  creado_en: Date;
  actualizado_por: string | null;
  actualizado_en: Date | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function logBitacora(
  tx: Prisma.TransactionClient,
  opts: {
    authUserId: string;
    tipoAcceso: string;
    recursoId?: string;
    ipOrigen?: string;
  },
): Promise<void> {
  try {
    await tx.$executeRaw(
      Prisma.sql`
        INSERT INTO ece.bitacora_acceso
          (auth_user_id, componente, tipo_acceso, autorizado, recurso_id, ip_origen)
        VALUES (
          ${opts.authUserId}::uuid,
          'workflow.tipoDocOverride',
          ${opts.tipoAcceso},
          true,
          ${opts.recursoId ? opts.recursoId + "::uuid" : null}::uuid,
          ${opts.ipOrigen ?? null}::inet
        )
      `,
    );
  } catch {
    // No bloquear operación clínica por fallo de bitácora.
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const dirOnly = requireRole(["DIR"]);

export const workflowTipoDocOverrideRouter = router({
  /**
   * list — todos los overrides del establecimiento del DIR conectado.
   * Incluye join con tipo_documento para mostrar codigo + nombre.
   */
  list: dirOnly.query(async ({ ctx }) => {
    return withWorkflowContext(ctx.prisma, ctx.tenant.establishmentId, async (tx) => {
      const rows = await tx.$queryRaw<TipoDocOverrideRow[]>(Prisma.sql`
        SELECT
          tde.tipo_documento_id::text,
          tde.establecimiento_id::text,
          td.codigo                AS tipo_codigo,
          td.nombre                AS tipo_nombre,
          tde.activo_override,
          tde.obligatorio_override,
          tde.depende_de_override,
          tde.nota_dir,
          tde.creado_por::text,
          tde.creado_en,
          tde.actualizado_por::text,
          tde.actualizado_en
        FROM ece.tipo_documento_establecimiento tde
        JOIN ece.tipo_documento td ON td.id = tde.tipo_documento_id
        ORDER BY td.codigo ASC
      `);

      return rows;
    });
  }),

  /**
   * upsert — crea o actualiza el override para un tipo_documento.
   * Si la fila no existe, la crea; si existe, actualiza los campos provistos.
   * Pasar `null` explícito en un campo *_override significa "borrar override"
   * (volver al valor global).
   */
  upsert: dirOnly.input(upsertInput).mutation(async ({ ctx, input }) => {
    return withWorkflowContext(ctx.prisma, ctx.tenant.establishmentId, async (tx) => {
      // Validar que el tipo_documento existe.
      const tipos = await tx.$queryRaw<{ codigo: string }[]>(Prisma.sql`
        SELECT codigo FROM ece.tipo_documento
        WHERE id = ${input.tipoDocumentoId}::uuid AND activo = true
        LIMIT 1
      `);
      if (tipos.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Tipo de documento ${input.tipoDocumentoId} no existe o está inactivo.`,
        });
      }

      // Si se da dependeDeOverride, validar que cada código exista.
      if (input.dependeDeOverride && input.dependeDeOverride.length > 0) {
        for (const dep of input.dependeDeOverride) {
          const found = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT id FROM ece.tipo_documento
            WHERE codigo = ${dep} AND activo = true LIMIT 1
          `);
          if (found.length === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `La dependencia '${dep}' no existe en el catálogo.`,
            });
          }
        }
      }

      const personalId = ctx.tenant.userId;

      const rows = await tx.$queryRaw<TipoDocOverrideRow[]>(Prisma.sql`
        INSERT INTO ece.tipo_documento_establecimiento
          (tipo_documento_id, establecimiento_id,
           activo_override, obligatorio_override, depende_de_override, nota_dir,
           creado_por)
        VALUES (
          ${input.tipoDocumentoId}::uuid,
          ${ctx.tenant.establishmentId}::uuid,
          ${input.activoOverride ?? null},
          ${input.obligatorioOverride ?? null},
          ${input.dependeDeOverride ?? null},
          ${input.notaDir ?? null},
          ${personalId}::uuid
        )
        ON CONFLICT (tipo_documento_id, establecimiento_id) DO UPDATE
          SET activo_override      = EXCLUDED.activo_override,
              obligatorio_override = EXCLUDED.obligatorio_override,
              depende_de_override  = EXCLUDED.depende_de_override,
              nota_dir             = EXCLUDED.nota_dir,
              actualizado_por      = EXCLUDED.creado_por,
              actualizado_en       = now()
        RETURNING
          tipo_documento_id::text,
          establecimiento_id::text,
          NULL::text AS tipo_codigo,
          NULL::text AS tipo_nombre,
          activo_override,
          obligatorio_override,
          depende_de_override,
          nota_dir,
          creado_por::text,
          creado_en,
          actualizado_por::text,
          actualizado_en
      `);

      const result = rows[0]!;

      await logBitacora(tx, {
        authUserId: ctx.tenant.userId,
        tipoAcceso: "escritura",
        recursoId: result.tipo_documento_id,
        ipOrigen: ctx.ip,
      });

      return result;
    });
  }),

  /**
   * remove — elimina el override (revierte al valor global).
   */
  remove: dirOnly.input(deleteInput).mutation(async ({ ctx, input }) => {
    return withWorkflowContext(ctx.prisma, ctx.tenant.establishmentId, async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM ece.tipo_documento_establecimiento
        WHERE tipo_documento_id = ${input.tipoDocumentoId}::uuid
          AND establecimiento_id = ${ctx.tenant.establishmentId}::uuid
      `);

      await logBitacora(tx, {
        authUserId: ctx.tenant.userId,
        tipoAcceso: "eliminacion",
        recursoId: input.tipoDocumentoId,
        ipOrigen: ctx.ip,
      });

      return { ok: true as const };
    });
  }),
});
