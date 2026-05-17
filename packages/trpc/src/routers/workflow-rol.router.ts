/**
 * workflow.rol — CRUD de ece.documento_rol (matriz funcional).
 *
 * Router independiente para gestión de la matriz de roles funcionales del motor
 * de workflow ECE. Permite asignar y revocar funciones LLENA / RESPONSABLE /
 * AUTORIZA / FIRMA a roles ECE por tipo de documento.
 *
 * Roles: DIR, WORKFLOW_DESIGNER.
 * Spec: docs/backlog/fase2/_insumos/05_motor_workflow.sql
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../trpc";

// ─── Constantes ───────────────────────────────────────────────────────────────

const FUNCION_VALUES = ["LLENA", "RESPONSABLE", "AUTORIZA", "FIRMA"] as const;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const listInput = z.object({ tipDocumentoId: z.string().uuid() });

const assignInput = z.object({
  tipDocumentoId: z.string().uuid(),
  rolId: z.string().uuid(),
  funcion: z.enum(FUNCION_VALUES),
  obligatorio: z.boolean().default(true),
});

const revokeInput = z.object({
  tipDocumentoId: z.string().uuid(),
  rolId: z.string().uuid(),
  funcion: z.enum(FUNCION_VALUES),
});

// ─── Tipos raw ────────────────────────────────────────────────────────────────

type DocumentoRolRow = {
  id: string;
  tipo_documento_id: string;
  rol_id: string;
  funcion: (typeof FUNCION_VALUES)[number];
  obligatorio: boolean;
  rol_codigo?: string;
  rol_nombre?: string;
};

// ─── Router ───────────────────────────────────────────────────────────────────

const proc = requireRole(["DIR", "WORKFLOW_DESIGNER"]);

export const workflowRolRouter = router({
  /**
   * Lista la matriz de roles funcionales de un tipo de documento,
   * enriquecida con codigo y nombre del rol ECE.
   */
  list: proc.input(listInput).query(async ({ ctx, input }) => {
    const rows = await ctx.prisma.$queryRaw<DocumentoRolRow[]>`
      SELECT dr.id::text, dr.tipo_documento_id::text, dr.rol_id::text,
             dr.funcion, dr.obligatorio,
             r.codigo AS rol_codigo, r.nombre AS rol_nombre
        FROM ece.documento_rol dr
        JOIN ece.rol r ON r.id = dr.rol_id
       WHERE dr.tipo_documento_id = ${input.tipDocumentoId}::uuid
       ORDER BY dr.funcion ASC, r.codigo ASC
    `;
    return rows;
  }),

  /**
   * Asigna una función a un rol en un tipo de documento.
   * Unicidad: (tipo_documento_id, rol_id, funcion) vía ON CONFLICT DO UPDATE.
   * Devuelve wasNew=false si ya existía (idempotente).
   */
  assign: proc.input(assignInput).mutation(async ({ ctx, input }) => {
    const [doc] = await ctx.prisma.$queryRaw<[{ id: string }?]>`
      SELECT id::text FROM ece.tipo_documento
       WHERE id = ${input.tipDocumentoId}::uuid LIMIT 1
    `;
    if (!doc) {
      throw new TRPCError({ code: "NOT_FOUND", message: "tipo_documento no encontrado." });
    }

    const [rol] = await ctx.prisma.$queryRaw<[{ id: string }?]>`
      SELECT id::text FROM ece.rol
       WHERE id = ${input.rolId}::uuid LIMIT 1
    `;
    if (!rol) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Rol ECE no encontrado." });
    }

    const [prev] = await ctx.prisma.$queryRaw<[DocumentoRolRow?]>`
      SELECT id::text, tipo_documento_id::text, rol_id::text, funcion, obligatorio
        FROM ece.documento_rol
       WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
         AND rol_id            = ${input.rolId}::uuid
         AND funcion           = ${input.funcion}
       LIMIT 1
    `;

    const rows = await ctx.prisma.$queryRaw<DocumentoRolRow[]>`
      INSERT INTO ece.documento_rol (tipo_documento_id, rol_id, funcion, obligatorio)
      VALUES (${input.tipDocumentoId}::uuid, ${input.rolId}::uuid,
              ${input.funcion}, ${input.obligatorio})
      ON CONFLICT (tipo_documento_id, rol_id, funcion)
        DO UPDATE SET obligatorio = EXCLUDED.obligatorio
      RETURNING id::text, tipo_documento_id::text, rol_id::text, funcion, obligatorio
    `;
    return { assigned: rows[0], prev: prev ?? null, wasNew: !prev };
  }),

  /**
   * Revoca la función de un rol en un tipo de documento.
   * Devuelve snapshot del registro eliminado en prev.
   */
  revoke: proc.input(revokeInput).mutation(async ({ ctx, input }) => {
    const deleted = await ctx.prisma.$queryRaw<DocumentoRolRow[]>`
      DELETE FROM ece.documento_rol
       WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
         AND rol_id            = ${input.rolId}::uuid
         AND funcion           = ${input.funcion}
       RETURNING id::text, tipo_documento_id::text, rol_id::text, funcion, obligatorio
    `;
    if (deleted.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Asignación de rol no encontrada." });
    }
    return { prev: deleted[0] };
  }),
});
