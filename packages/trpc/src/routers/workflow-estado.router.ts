/**
 * Motor de Workflow ECE — configuración de estados, transiciones y roles funcionales.
 *
 * Tablas operadas (schema ece, raw SQL — no están en schema.prisma):
 *   ece.flujo_estado     — estados del flujo por tipo de documento
 *   ece.flujo_transicion — transiciones permitidas con rol autorizador
 *   ece.documento_rol    — matriz LLENA/RESPONSABLE/AUTORIZA/FIRMA
 *
 * Requiere rol DIR o WORKFLOW_DESIGNER (configuración de flujos sensible).
 *
 * Versionado: cada mutación devuelve el snapshot anterior en `prev` para que
 * el caller lo registre en el log de auditoría. La cadena de auditoría de BD
 * (02_audit_triggers.sql) captura el cambio a nivel SQL de forma independiente.
 *
 * Spec: docs/backlog/fase2/_insumos/05_motor_workflow.sql
 *       docs/backlog/fase2/03_epic_workflow_engine.md
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, requireRole } from "../trpc";

// ─── Constantes ──────────────────────────────────────────────────────────────

const FUNCION_VALUES = ["LLENA", "RESPONSABLE", "AUTORIZA", "FIRMA"] as const;
type Funcion = (typeof FUNCION_VALUES)[number];

const WORKFLOW_ROLES = ["DIR", "WORKFLOW_DESIGNER"] as const;

// ─── Schemas de input ────────────────────────────────────────────────────────

const estadoListInput = z.object({
  tipDocumentoId: z.string().uuid(),
});

const estadoCreateInput = z.object({
  tipDocumentoId: z.string().uuid(),
  codigo: z.string().trim().min(1).max(64),
  nombre: z.string().trim().min(1).max(255),
  esInicial: z.boolean().default(false),
  esFinal: z.boolean().default(false),
  orden: z.number().int().min(0).default(0),
});

const estadoUpdateInput = z.object({
  id: z.string().uuid(),
  nombre: z.string().trim().min(1).max(255).optional(),
  esInicial: z.boolean().optional(),
  esFinal: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
});

const transicionListInput = z.object({
  tipDocumentoId: z.string().uuid(),
});

const transicionCreateInput = z.object({
  tipDocumentoId: z.string().uuid(),
  estadoOrigenId: z.string().uuid(),
  estadoDestinoId: z.string().uuid(),
  accion: z.string().trim().min(1).max(64),
  rolAutorizaId: z.string().uuid(),
  requiereFirma: z.boolean().default(true),
});

const transicionUpdateInput = z.object({
  id: z.string().uuid(),
  estadoDestinoId: z.string().uuid().optional(),
  rolAutorizaId: z.string().uuid().optional(),
  requiereFirma: z.boolean().optional(),
});

const roleListInput = z.object({
  tipDocumentoId: z.string().uuid(),
});

const roleAssignInput = z.object({
  tipDocumentoId: z.string().uuid(),
  rolId: z.string().uuid(),
  funcion: z.enum(FUNCION_VALUES),
  obligatorio: z.boolean().default(true),
});

const roleRevokeInput = z.object({
  tipDocumentoId: z.string().uuid(),
  rolId: z.string().uuid(),
  funcion: z.enum(FUNCION_VALUES),
});

// ─── Tipos de resultado raw ──────────────────────────────────────────────────

type FlujoEstadoRow = {
  id: string;
  tipo_documento_id: string;
  codigo: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
};

type FlujoTransicionRow = {
  id: string;
  tipo_documento_id: string;
  estado_origen_id: string;
  estado_destino_id: string;
  accion: string;
  rol_autoriza_id: string;
  requiere_firma: boolean;
};

type DocumentoRolRow = {
  id: string;
  tipo_documento_id: string;
  rol_id: string;
  funcion: Funcion;
  obligatorio: boolean;
};

// ─── Helper: relanza errores de constraint como TRPCError ───────────────────

function rethrowConstraint(err: unknown, entity: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("23505")) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Ya existe ${entity} con esos valores. Verifique duplicados.`,
    });
  }
  throw err;
}

// ─── Router ──────────────────────────────────────────────────────────────────

const workflowProc = requireRole([...WORKFLOW_ROLES]);

export const workflowEstadoRouter = router({
  // ── ESTADOS ────────────────────────────────────────────────────────────────

  estado: router({
    /**
     * Lista todos los estados de un tipo de documento, ordenados por `orden`.
     */
    list: workflowProc
      .input(estadoListInput)
      .query(async ({ ctx, input }) => {
        const rows = await ctx.prisma.$queryRaw<FlujoEstadoRow[]>`
          SELECT id::text, tipo_documento_id::text, codigo, nombre,
                 es_inicial, es_final, orden
            FROM ece.flujo_estado
           WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
           ORDER BY orden ASC, codigo ASC
        `;
        return rows;
      }),

    /**
     * Crea un estado. Valida unicidad (tipo_documento_id, codigo) antes del INSERT
     * para devolver un mensaje claro en lugar del error crudo de Postgres.
     */
    create: workflowProc
      .input(estadoCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Valida que el tipo_documento exista
        const [doc] = await ctx.prisma.$queryRaw<[{ id: string }?]>`
          SELECT id::text FROM ece.tipo_documento
           WHERE id = ${input.tipDocumentoId}::uuid
           LIMIT 1
        `;
        if (!doc) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "tipo_documento no encontrado.",
          });
        }

        // Valida unicidad explícita (tipo_doc, codigo)
        const [dup] = await ctx.prisma.$queryRaw<[{ id: string }?]>`
          SELECT id::text FROM ece.flujo_estado
           WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
             AND codigo = ${input.codigo}
           LIMIT 1
        `;
        if (dup) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya existe el estado '${input.codigo}' para este tipo de documento.`,
          });
        }

        try {
          const [created] = await ctx.prisma.$queryRaw<[FlujoEstadoRow]>`
            INSERT INTO ece.flujo_estado
              (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
            VALUES
              (${input.tipDocumentoId}::uuid, ${input.codigo},
               ${input.nombre}, ${input.esInicial}, ${input.esFinal}, ${input.orden})
            RETURNING id::text, tipo_documento_id::text, codigo, nombre,
                      es_inicial, es_final, orden
          `;
          return { created, prev: null };
        } catch (err) {
          rethrowConstraint(err, "un estado");
        }
      }),

    /**
     * Actualiza un estado. Devuelve snapshot anterior (`prev`) para trazabilidad.
     * No permite cambiar tipo_documento_id ni codigo (identidad del estado).
     */
    update: workflowProc
      .input(estadoUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const [prev] = await ctx.prisma.$queryRaw<[FlujoEstadoRow?]>`
          SELECT id::text, tipo_documento_id::text, codigo, nombre,
                 es_inicial, es_final, orden
            FROM ece.flujo_estado
           WHERE id = ${input.id}::uuid
           LIMIT 1
        `;
        if (!prev) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Estado no encontrado." });
        }

        const updated = {
          nombre: input.nombre ?? prev.nombre,
          esInicial: input.esInicial ?? prev.es_inicial,
          esFinal: input.esFinal ?? prev.es_final,
          orden: input.orden ?? prev.orden,
        };

        const [row] = await ctx.prisma.$queryRaw<[FlujoEstadoRow]>`
          UPDATE ece.flujo_estado
             SET nombre     = ${updated.nombre},
                 es_inicial = ${updated.esInicial},
                 es_final   = ${updated.esFinal},
                 orden      = ${updated.orden}
           WHERE id = ${input.id}::uuid
           RETURNING id::text, tipo_documento_id::text, codigo, nombre,
                     es_inicial, es_final, orden
        `;
        return { updated: row, prev };
      }),
  }),

  // ── TRANSICIONES ───────────────────────────────────────────────────────────

  transicion: router({
    /**
     * Lista transiciones de un tipo de documento con datos del rol autorizador.
     */
    list: workflowProc
      .input(transicionListInput)
      .query(async ({ ctx, input }) => {
        const rows = await ctx.prisma.$queryRaw<
          (FlujoTransicionRow & { rol_codigo: string; rol_nombre: string })[]
        >`
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
     * Crea una transición. Valida unicidad (tipo_doc, origen, accion).
     * Los UUIDs de estado_origen y estado_destino deben pertenecer al mismo tipo_documento.
     */
    create: workflowProc
      .input(transicionCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Valida que ambos estados pertenezcan al tipo_documento
        const estados = await ctx.prisma.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM ece.flujo_estado
           WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
             AND id = ANY(ARRAY[${input.estadoOrigenId}::uuid, ${input.estadoDestinoId}::uuid])
        `;
        if (estados.length < 2) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "estado_origen_id y estado_destino_id deben pertenecer al mismo tipo_documento.",
          });
        }

        // Valida unicidad (tipo_doc, estado_origen, accion)
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

        // Valida que el rol exista en ece.rol
        const [rol] = await ctx.prisma.$queryRaw<[{ id: string }?]>`
          SELECT id::text FROM ece.rol
           WHERE id = ${input.rolAutorizaId}::uuid
           LIMIT 1
        `;
        if (!rol) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Rol autorizador no encontrado en ece.rol." });
        }

        try {
          const [created] = await ctx.prisma.$queryRaw<[FlujoTransicionRow]>`
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
          rethrowConstraint(err, "una transición");
        }
      }),

    /**
     * Actualiza destino, rol autorizador o requiere_firma de una transición.
     * No permite cambiar origen ni accion (identidad de la transición).
     * Devuelve snapshot anterior en `prev`.
     */
    update: workflowProc
      .input(transicionUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const [prev] = await ctx.prisma.$queryRaw<[FlujoTransicionRow?]>`
          SELECT id::text, tipo_documento_id::text, estado_origen_id::text,
                 estado_destino_id::text, accion, rol_autoriza_id::text, requiere_firma
            FROM ece.flujo_transicion
           WHERE id = ${input.id}::uuid
           LIMIT 1
        `;
        if (!prev) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Transición no encontrada." });
        }

        // Si se cambia destino, verificar que pertenece al mismo tipo_documento
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

        const updated = {
          estadoDestinoId: input.estadoDestinoId ?? prev.estado_destino_id,
          rolAutorizaId: input.rolAutorizaId ?? prev.rol_autoriza_id,
          requiereFirma: input.requiereFirma ?? prev.requiere_firma,
        };

        const [row] = await ctx.prisma.$queryRaw<[FlujoTransicionRow]>`
          UPDATE ece.flujo_transicion
             SET estado_destino_id = ${updated.estadoDestinoId}::uuid,
                 rol_autoriza_id   = ${updated.rolAutorizaId}::uuid,
                 requiere_firma    = ${updated.requiereFirma}
           WHERE id = ${input.id}::uuid
           RETURNING id::text, tipo_documento_id::text, estado_origen_id::text,
                     estado_destino_id::text, accion, rol_autoriza_id::text, requiere_firma
        `;
        return { updated: row, prev };
      }),
  }),

  // ── ROLES FUNCIONALES ──────────────────────────────────────────────────────

  role: router({
    /**
     * Lista la matriz de roles funcionales de un tipo de documento.
     * Enriquece con codigo y nombre del rol ECE.
     */
    list: workflowProc
      .input(roleListInput)
      .query(async ({ ctx, input }) => {
        const rows = await ctx.prisma.$queryRaw<
          (DocumentoRolRow & { rol_codigo: string; rol_nombre: string })[]
        >`
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
     * Unicidad: (tipo_documento_id, rol_id, funcion). Idempotente vía ON CONFLICT DO NOTHING.
     * Devuelve `created=false` si ya existía (sin error).
     */
    assign: workflowProc
      .input(roleAssignInput)
      .mutation(async ({ ctx, input }) => {
        // Valida tipo_documento
        const [doc] = await ctx.prisma.$queryRaw<[{ id: string }?]>`
          SELECT id::text FROM ece.tipo_documento
           WHERE id = ${input.tipDocumentoId}::uuid LIMIT 1
        `;
        if (!doc) {
          throw new TRPCError({ code: "NOT_FOUND", message: "tipo_documento no encontrado." });
        }

        // Valida rol ECE
        const [rol] = await ctx.prisma.$queryRaw<[{ id: string }?]>`
          SELECT id::text FROM ece.rol
           WHERE id = ${input.rolId}::uuid LIMIT 1
        `;
        if (!rol) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Rol ECE no encontrado." });
        }

        // Snapshot previo si ya existía (para el caller)
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
     * Devuelve snapshot del registro eliminado en `prev`.
     */
    revoke: workflowProc
      .input(roleRevokeInput)
      .mutation(async ({ ctx, input }) => {
        const deleted = await ctx.prisma.$queryRaw<DocumentoRolRow[]>`
          DELETE FROM ece.documento_rol
           WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
             AND rol_id            = ${input.rolId}::uuid
             AND funcion           = ${input.funcion}
           RETURNING id::text, tipo_documento_id::text, rol_id::text, funcion, obligatorio
        `;
        if (deleted.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Asignación de rol no encontrada.",
          });
        }
        return { prev: deleted[0] };
      }),
  }),
});
