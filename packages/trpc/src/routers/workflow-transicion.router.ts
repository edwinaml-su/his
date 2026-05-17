/**
 * workflow.transicion — CRUD de ece.flujo_transicion.
 *
 * Router independiente para gestión de transiciones del motor de workflow ECE.
 * Permite configurar qué acciones son posibles desde cada estado, qué rol
 * las autoriza y si requieren firma electrónica.
 *
 * Roles: DIR, WORKFLOW_DESIGNER.
 * Spec: docs/backlog/fase2/_insumos/05_motor_workflow.sql
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../trpc";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const listInput = z.object({ tipDocumentoId: z.string().uuid() });

const createInput = z.object({
  tipDocumentoId: z.string().uuid(),
  estadoOrigenId: z.string().uuid(),
  estadoDestinoId: z.string().uuid(),
  accion: z.string().trim().min(1).max(64),
  rolAutorizaId: z.string().uuid(),
  requiereFirma: z.boolean().default(true),
});

const updateInput = z.object({
  id: z.string().uuid(),
  estadoDestinoId: z.string().uuid().optional(),
  rolAutorizaId: z.string().uuid().optional(),
  requiereFirma: z.boolean().optional(),
});

const deleteInput = z.object({ id: z.string().uuid() });

// ─── Tipos raw ────────────────────────────────────────────────────────────────

type TransicionRow = {
  id: string;
  tipo_documento_id: string;
  estado_origen_id: string;
  estado_destino_id: string;
  accion: string;
  rol_autoriza_id: string;
  requiere_firma: boolean;
  rol_codigo?: string;
  rol_nombre?: string;
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function rethrowConstraint(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("23505")) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Ya existe una transición con esos valores. Verifique duplicados.",
    });
  }
  throw err;
}

// ─── Router ───────────────────────────────────────────────────────────────────

const proc = requireRole(["DIR", "WORKFLOW_DESIGNER"]);

export const workflowTransicionRouter = router({
  /**
   * Lista transiciones de un tipo de documento enriquecidas con rol_codigo/rol_nombre.
   */
  list: proc.input(listInput).query(async ({ ctx, input }) => {
    const rows = await ctx.prisma.$queryRaw<TransicionRow[]>`
      SELECT ft.id::text, ft.tipo_documento_id::text,
             ft.estado_origen_id::text, ft.estado_destino_id::text,
             ft.accion, ft.rol_autoriza_id::text, ft.requiere_firma,
             r.codigo AS rol_codigo, r.nombre AS rol_nombre
        FROM ece.flujo_transicion ft
        JOIN ece.rol r ON r.id = ft.rol_autoriza_id
       WHERE ft.tipo_documento_id = ${input.tipDocumentoId}::uuid
       ORDER BY ft.accion ASC
    `;
    return rows;
  }),

  /**
   * Crea una transición. Valida:
   * - ambos estados pertenecen al tipo_documento
   * - unicidad (tipo_doc, estado_origen, accion)
   * - el rol autorizador existe en ece.rol
   */
  create: proc.input(createInput).mutation(async ({ ctx, input }) => {
    // Ambos estados deben pertenecer al tipo_documento
    const estados = await ctx.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM ece.flujo_estado
       WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
         AND id = ANY(ARRAY[${input.estadoOrigenId}::uuid, ${input.estadoDestinoId}::uuid])
    `;
    if (estados.length < 2) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "estado_origen_id y estado_destino_id deben pertenecer al mismo tipo_documento.",
      });
    }

    // Unicidad (tipo_doc, estado_origen, accion)
    const [dup] = await ctx.prisma.$queryRaw<[{ id: string }?]>`
      SELECT id::text FROM ece.flujo_transicion
       WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
         AND estado_origen_id  = ${input.estadoOrigenId}::uuid
         AND accion            = ${input.accion}
       LIMIT 1
    `;
    if (dup) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Ya existe la acción '${input.accion}' desde ese estado origen.`,
      });
    }

    // Rol debe existir
    const [rol] = await ctx.prisma.$queryRaw<[{ id: string }?]>`
      SELECT id::text FROM ece.rol
       WHERE id = ${input.rolAutorizaId}::uuid
       LIMIT 1
    `;
    if (!rol) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Rol autorizador no encontrado en ece.rol." });
    }

    try {
      const [created] = await ctx.prisma.$queryRaw<[TransicionRow]>`
        INSERT INTO ece.flujo_transicion
          (tipo_documento_id, estado_origen_id, estado_destino_id,
           accion, rol_autoriza_id, requiere_firma)
        VALUES
          (${input.tipDocumentoId}::uuid, ${input.estadoOrigenId}::uuid,
           ${input.estadoDestinoId}::uuid, ${input.accion},
           ${input.rolAutorizaId}::uuid, ${input.requiereFirma})
        RETURNING id::text, tipo_documento_id::text, estado_origen_id::text,
                  estado_destino_id::text, accion, rol_autoriza_id::text, requiere_firma
      `;
      return { created, prev: null };
    } catch (err) {
      rethrowConstraint(err);
    }
  }),

  /**
   * Actualiza destino, rol autorizador o requiere_firma.
   * No permite cambiar origen ni accion (identidad de la transición).
   */
  update: proc.input(updateInput).mutation(async ({ ctx, input }) => {
    const [prev] = await ctx.prisma.$queryRaw<[TransicionRow?]>`
      SELECT id::text, tipo_documento_id::text, estado_origen_id::text,
             estado_destino_id::text, accion, rol_autoriza_id::text, requiere_firma
        FROM ece.flujo_transicion
       WHERE id = ${input.id}::uuid
       LIMIT 1
    `;
    if (!prev) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Transición no encontrada." });
    }

    // Si cambia destino, debe pertenecer al mismo tipo_documento
    if (input.estadoDestinoId && input.estadoDestinoId !== prev.estado_destino_id) {
      const [estado] = await ctx.prisma.$queryRaw<[{ id: string }?]>`
        SELECT id::text FROM ece.flujo_estado
         WHERE id = ${input.estadoDestinoId}::uuid
           AND tipo_documento_id = ${prev.tipo_documento_id}::uuid
         LIMIT 1
      `;
      if (!estado) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El estado_destino_id no pertenece al mismo tipo_documento.",
        });
      }
    }

    const merged = {
      estadoDestinoId: input.estadoDestinoId ?? prev.estado_destino_id,
      rolAutorizaId: input.rolAutorizaId ?? prev.rol_autoriza_id,
      requiereFirma: input.requiereFirma ?? prev.requiere_firma,
    };

    const [row] = await ctx.prisma.$queryRaw<[TransicionRow]>`
      UPDATE ece.flujo_transicion
         SET estado_destino_id = ${merged.estadoDestinoId}::uuid,
             rol_autoriza_id   = ${merged.rolAutorizaId}::uuid,
             requiere_firma    = ${merged.requiereFirma}
       WHERE id = ${input.id}::uuid
       RETURNING id::text, tipo_documento_id::text, estado_origen_id::text,
                 estado_destino_id::text, accion, rol_autoriza_id::text, requiere_firma
    `;
    return { updated: row, prev };
  }),

  /**
   * Elimina una transición. Devuelve el snapshot en prev.
   */
  delete: proc.input(deleteInput).mutation(async ({ ctx, input }) => {
    const deleted = await ctx.prisma.$queryRaw<TransicionRow[]>`
      DELETE FROM ece.flujo_transicion
       WHERE id = ${input.id}::uuid
       RETURNING id::text, tipo_documento_id::text, estado_origen_id::text,
                 estado_destino_id::text, accion, rol_autoriza_id::text, requiere_firma
    `;
    if (deleted.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Transición no encontrada." });
    }
    return { prev: deleted[0] };
  }),
});
