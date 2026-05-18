/**
 * workflow.plantilla — Biblioteca de plantillas de workflow (US.F2.2.09-10).
 *
 * Tabla: ece.workflow_plantilla
 *
 * list   — catálogo con filtros (categoria, búsqueda full-text).
 * get    — plantilla por código.
 * applyToWorkflow — copia estados+transiciones seed al tipo_documento destino.
 *
 * Roles: DIR o WORKFLOW_DESIGNER.
 * applyToWorkflow es mutación; list/get son queries (lectura).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import { router, requireRole } from "../trpc";

// ── Schemas ─────────────────────────────────────────────────────────────────

const CATEGORIAS = ["Ambulatorio", "Hospitalario", "Quirúrgico", "Maternidad", "Emergencia"] as const;

const listInput = z.object({
  categoria: z.enum(CATEGORIAS).optional(),
  /** Búsqueda por nombre o descripción (ILIKE). */
  q: z.string().max(120).optional(),
  soloActivas: z.boolean().optional(),
});

const getInput = z.object({
  codigo: z.string().min(2).max(64),
});

const applyInput = z.object({
  /** Código de la plantilla a aplicar. */
  plantillaCodigo: z.string().min(2).max(64),
  /** UUID del tipo_documento destino. */
  tipDocumentoId: z.string().uuid(),
  /**
   * Si true, elimina los estados y transiciones existentes antes de aplicar
   * los seeds. Si false, los estados/transiciones se agregan sin borrar los existentes.
   */
  reemplazar: z.boolean().default(false),
});

// ── Row type ─────────────────────────────────────────────────────────────────

export interface PlantillaRow {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  descripcion: string | null;
  estados_seed: unknown;
  transiciones_seed: unknown;
  es_sistema: boolean;
  activo: boolean;
}

interface EstadoSeed {
  codigo: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
}

interface TransicionSeed {
  origen_codigo: string;
  destino_codigo: string;
  accion: string;
  rol_codigo: string;
  requiere_firma: boolean;
}

// ── Router ────────────────────────────────────────────────────────────────────

const proc = requireRole(["DIR", "WORKFLOW_DESIGNER"]);

export const workflowPlantillaRouter = router({
  /**
   * Lista plantillas con filtros opcionales de categoría y búsqueda full-text.
   */
  list: proc.input(listInput).query(async ({ ctx, input }) => {
    const soloActivas = input.soloActivas ?? true;
    const q = input.q ? `%${input.q}%` : null;

    const rows = await ctx.prisma.$queryRaw<PlantillaRow[]>(Prisma.sql`
      SELECT
        id::text,
        codigo,
        nombre,
        categoria,
        descripcion,
        estados_seed,
        transiciones_seed,
        es_sistema,
        activo
      FROM ece.workflow_plantilla
      WHERE
        (${soloActivas} = false OR activo = true)
        AND (${input.categoria ?? null}::text IS NULL OR categoria = ${input.categoria ?? null})
        AND (
          ${q}::text IS NULL
          OR nombre    ILIKE ${q}
          OR descripcion ILIKE ${q}
        )
      ORDER BY categoria ASC, nombre ASC
    `);

    return rows;
  }),

  /**
   * Obtiene una plantilla por su código.
   */
  get: proc.input(getInput).query(async ({ ctx, input }) => {
    const rows = await ctx.prisma.$queryRaw<PlantillaRow[]>(Prisma.sql`
      SELECT
        id::text,
        codigo,
        nombre,
        categoria,
        descripcion,
        estados_seed,
        transiciones_seed,
        es_sistema,
        activo
      FROM ece.workflow_plantilla
      WHERE codigo = ${input.codigo}
      LIMIT 1
    `);

    if (rows.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Plantilla '${input.codigo}' no encontrada.`,
      });
    }

    return rows[0];
  }),

  /**
   * Copia los estados + transiciones seed de la plantilla al tipo_documento destino.
   *
   * Lógica:
   * 1. Carga la plantilla y valida que el tipo_documento exista.
   * 2. Si reemplazar=true, elimina los estados existentes (cascada a transiciones).
   * 3. Inserta estados_seed en flujo_estado.
   * 4. Resuelve los UUIDs por código y crea las transiciones.
   *    - Si el rol_codigo no existe en ece.rol, usa el primer rol disponible y loguea.
   * 5. Retorna cuántos estados y transiciones se crearon.
   */
  applyToWorkflow: proc.input(applyInput).mutation(async ({ ctx, input }) => {
    return ctx.prisma.$transaction(async (tx) => {
      // Cargar plantilla
      const plantRows = await tx.$queryRaw<PlantillaRow[]>(Prisma.sql`
        SELECT id::text, estados_seed, transiciones_seed, nombre
        FROM ece.workflow_plantilla
        WHERE codigo = ${input.plantillaCodigo}
        LIMIT 1
      `);

      if (plantRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Plantilla '${input.plantillaCodigo}' no encontrada.`,
        });
      }

      const plantilla = plantRows[0]!;

      // Verificar que el tipo_documento exista
      const docRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id::text FROM ece.tipo_documento
        WHERE id = ${input.tipDocumentoId}::uuid
        LIMIT 1
      `);

      if (docRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "tipo_documento no encontrado.",
        });
      }

      // Eliminar estados existentes si se pide reemplazar
      // (las transiciones se eliminan por CASCADE)
      if (input.reemplazar) {
        await tx.$executeRaw(Prisma.sql`
          DELETE FROM ece.flujo_transicion
          WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
        `);
        await tx.$executeRaw(Prisma.sql`
          DELETE FROM ece.flujo_estado
          WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
        `);
      }

      const estados = plantilla.estados_seed as EstadoSeed[];
      const transiciones = plantilla.transiciones_seed as TransicionSeed[];

      // Insertar estados y construir mapa codigo→uuid
      const codigoToId = new Map<string, string>();

      for (const e of estados) {
        const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          INSERT INTO ece.flujo_estado
            (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
          VALUES
            (${input.tipDocumentoId}::uuid, ${e.codigo}, ${e.nombre},
             ${e.es_inicial}, ${e.es_final}, ${e.orden})
          ON CONFLICT (tipo_documento_id, codigo) DO NOTHING
          RETURNING id::text
        `);
        if (rows.length > 0 && rows[0]) {
          codigoToId.set(e.codigo, rows[0].id);
        } else {
          // Ya existía — obtener su id
          const existing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT id::text FROM ece.flujo_estado
            WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
              AND codigo = ${e.codigo}
            LIMIT 1
          `);
          if (existing[0]) codigoToId.set(e.codigo, existing[0].id);
        }
      }

      // Obtener primer rol disponible como fallback
      const fallbackRolRows = await tx.$queryRaw<{ id: string; codigo: string }[]>(Prisma.sql`
        SELECT id::text, codigo FROM ece.rol LIMIT 1
      `);
      const fallbackRolId = fallbackRolRows[0]?.id ?? null;

      let transCreadas = 0;

      for (const t of transiciones) {
        const origenId = codigoToId.get(t.origen_codigo);
        const destinoId = codigoToId.get(t.destino_codigo);
        if (!origenId || !destinoId) continue;

        // Resolver rol por código
        const rolRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id::text FROM ece.rol WHERE codigo = ${t.rol_codigo} LIMIT 1
        `);
        const rolId = rolRows[0]?.id ?? fallbackRolId;
        if (!rolId) continue;

        await tx.$executeRaw(Prisma.sql`
          INSERT INTO ece.flujo_transicion
            (tipo_documento_id, estado_origen_id, estado_destino_id,
             accion, rol_autoriza_id, requiere_firma)
          VALUES
            (${input.tipDocumentoId}::uuid, ${origenId}::uuid, ${destinoId}::uuid,
             ${t.accion}, ${rolId}::uuid, ${t.requiere_firma})
          ON CONFLICT DO NOTHING
        `);
        transCreadas++;
      }

      return {
        plantillaNombre: plantilla.nombre,
        estadosCreados: codigoToId.size,
        transicionesCreadas: transCreadas,
      };
    });
  }),
});
