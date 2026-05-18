/**
 * workflow-publicacion — US.F2.2.06, 07, 19, 20
 *
 * Gestiona el ciclo de vida de publicaciones de workflows:
 *  - saveDraft: persiste borrador (JSONB snapshot del grafo)
 *  - publish: crea versión PUBLICADO + marca anterior como HISTORICO
 *  - listVersions: historial de publicaciones con paginación
 *  - getVersion: snapshot de una versión específica
 *  - diff: computa diff estructural entre dos versiones (cliente puede rendericarlo)
 *  - rollback: restaura versión HISTORICO como nueva publicación
 *
 * Roles: WORKFLOW_DESIGNER puede guardar borrador y publicar.
 *        DIR puede además hacer rollback.
 *        Cualquier tenantProcedure puede leer historial.
 *
 * Inmutabilidad: el snapshot se hashea con SHA-256 encadenado (Art. 42 NTEC).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { Prisma } from "@his/database";
import { router, requireRole, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

// ─── Schemas Zod ──────────────────────────────────────────────────────────────

const GraphNodeSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  codigo: z.string(),
  es_inicial: z.boolean(),
  es_final: z.boolean(),
  orden: z.number().int(),
  posX: z.number().optional(),
  posY: z.number().optional(),
});

const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  accion: z.string(),
  rolCodigo: z.string().optional(),
  requiereFirma: z.boolean().optional(),
});

const GraphSnapshotSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function buildChainHash(prevHash: string | null, snapshotJson: string): string {
  return sha256((prevHash ?? "") + snapshotJson);
}

// Procedimientos con roles específicos
const designerProc = requireRole(["WORKFLOW_DESIGNER", "DIR"]);
const dirProc = requireRole(["DIR"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const workflowPublicacionRouter = router({
  /**
   * Guarda el borrador del grafo actual (sin publicar).
   * US.F2.2.06 — "Guardar borrador"
   */
  saveDraft: designerProc
    .input(
      z.object({
        tipDocumentoId: z.string().uuid(),
        draft: GraphSnapshotSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tipDocumentoId, draft } = input;
      const userId = ctx.user.id;

      await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        await tx.$executeRaw`
          INSERT INTO ece.workflow_draft (tipo_doc_id, draft_jsonb, updated_by_id, updated_at)
          VALUES (${tipDocumentoId}::uuid, ${JSON.stringify(draft)}::jsonb, ${userId}::uuid, now())
          ON CONFLICT (tipo_doc_id) DO UPDATE
            SET draft_jsonb    = EXCLUDED.draft_jsonb,
                updated_by_id  = EXCLUDED.updated_by_id,
                updated_at     = EXCLUDED.updated_at
        `;
      });

      return { saved: true, updatedAt: new Date() };
    }),

  /**
   * Obtiene el borrador activo de un tipo_documento.
   */
  getDraft: designerProc
    .input(z.object({ tipDocumentoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRaw<
        Array<{ draft_jsonb: unknown; updated_at: Date }>
      >`
        SELECT draft_jsonb, updated_at
          FROM ece.workflow_draft
         WHERE tipo_doc_id = ${input.tipDocumentoId}::uuid
         LIMIT 1
      `;
      return rows[0] ?? null;
    }),

  /**
   * Publica el borrador actual como nueva versión inmutable.
   * US.F2.2.06 — "Publicar"
   *
   * Pre-condición: el caller debe haber ejecutado validateGraph sin errores.
   * El servidor re-valida roles contra catálogo como defensa en profundidad.
   */
  publish: designerProc
    .input(
      z.object({
        tipDocumentoId: z.string().uuid(),
        snapshot: GraphSnapshotSchema,
        motivoCambio: z.string().min(1, "El motivo es obligatorio"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tipDocumentoId, snapshot, motivoCambio } = input;
      const userId = ctx.user.id;
      const snapshotJson = JSON.stringify(snapshot);

      // Validación server-side: roles referenciados deben existir
      const rolCodigos = snapshot.edges
        .map((e) => e.rolCodigo)
        .filter((r): r is string => !!r);

      if (rolCodigos.length > 0) {
        const existentes = await ctx.prisma.$queryRaw<Array<{ codigo: string }>>(
          Prisma.sql`SELECT codigo FROM public."Role" WHERE codigo = ANY(${rolCodigos})`,
        );
        const existenteSet = new Set(existentes.map((r) => r.codigo));
        const invalidos = rolCodigos.filter((c) => !existenteSet.has(c));
        if (invalidos.length > 0) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: `Roles inválidos en catálogo: ${invalidos.join(", ")}`,
          });
        }
      }

      const result = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // 1. Obtener versión siguiente
        const versionRows = await tx.$queryRaw<Array<{ next_version: number }>>`
          SELECT ece.next_workflow_version(${tipDocumentoId}::uuid) AS next_version
        `;
        const nextVersion = Number(versionRows[0]?.next_version ?? 1);

        // 2. Obtener último hash de la cadena
        const lastHashRows = await tx.$queryRaw<Array<{ chain_hash: string | null }>>`
          SELECT chain_hash
            FROM ece.workflow_publicacion_audit
           WHERE tipo_doc_id = ${tipDocumentoId}::uuid
           ORDER BY version DESC
           LIMIT 1
        `;
        const prevHash = lastHashRows[0]?.chain_hash ?? null;
        const payloadHash = sha256(snapshotJson);
        const chainHash = buildChainHash(prevHash, snapshotJson);

        // 3. Marcar versión activa anterior como HISTORICO
        await tx.$executeRaw`
          UPDATE ece.workflow_publicacion_audit
             SET estado = 'HISTORICO'
           WHERE tipo_doc_id = ${tipDocumentoId}::uuid
             AND estado = 'PUBLICADO'
        `;

        // 4. Insertar nueva versión PUBLICADO
        const insertedRows = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO ece.workflow_publicacion_audit
            (tipo_doc_id, version, estado, publicado_por_id, publicado_en,
             snapshot_jsonb, motivo_cambio, prev_hash, chain_hash)
          VALUES
            (${tipDocumentoId}::uuid, ${nextVersion}, 'PUBLICADO',
             ${userId}::uuid, now(),
             ${snapshotJson}::jsonb, ${motivoCambio},
             ${prevHash}, ${chainHash})
          RETURNING id
        `;

        // 5. Limpiar borrador
        await tx.$executeRaw`
          DELETE FROM ece.workflow_draft WHERE tipo_doc_id = ${tipDocumentoId}::uuid
        `;

        return {
          id: insertedRows[0]?.id ?? "",
          version: nextVersion,
          chainHash,
          payloadHash,
        };
      });

      return result;
    }),

  /**
   * Lista versiones publicadas de un tipo_documento.
   * US.F2.2.20 — historial auditable con paginación
   */
  listVersions: tenantProcedure
    .input(
      z.object({
        tipDocumentoId: z.string().uuid(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        fechaDesde: z.date().optional(),
        fechaHasta: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tipDocumentoId, page, pageSize, fechaDesde, fechaHasta } = input;
      const offset = (page - 1) * pageSize;

      // Construir filtros de fecha opcionales en JS para evitar template tag condicional
      type VersionRow = {
        id: string;
        version: number;
        estado: string;
        publicado_por_id: string | null;
        publicado_en: Date | null;
        motivo_cambio: string | null;
        restored_from_id: string | null;
        chain_hash: string | null;
      };

      let rows: VersionRow[];
      if (fechaDesde && fechaHasta) {
        rows = await ctx.prisma.$queryRaw<VersionRow[]>`
          SELECT id, version, estado, publicado_por_id, publicado_en,
                 motivo_cambio, restored_from_id, chain_hash
            FROM ece.workflow_publicacion_audit
           WHERE tipo_doc_id = ${tipDocumentoId}::uuid
             AND publicado_en >= ${fechaDesde}
             AND publicado_en <= ${fechaHasta}
           ORDER BY version DESC
           LIMIT ${pageSize} OFFSET ${offset}
        `;
      } else if (fechaDesde) {
        rows = await ctx.prisma.$queryRaw<VersionRow[]>`
          SELECT id, version, estado, publicado_por_id, publicado_en,
                 motivo_cambio, restored_from_id, chain_hash
            FROM ece.workflow_publicacion_audit
           WHERE tipo_doc_id = ${tipDocumentoId}::uuid
             AND publicado_en >= ${fechaDesde}
           ORDER BY version DESC
           LIMIT ${pageSize} OFFSET ${offset}
        `;
      } else if (fechaHasta) {
        rows = await ctx.prisma.$queryRaw<VersionRow[]>`
          SELECT id, version, estado, publicado_por_id, publicado_en,
                 motivo_cambio, restored_from_id, chain_hash
            FROM ece.workflow_publicacion_audit
           WHERE tipo_doc_id = ${tipDocumentoId}::uuid
             AND publicado_en <= ${fechaHasta}
           ORDER BY version DESC
           LIMIT ${pageSize} OFFSET ${offset}
        `;
      } else {
        rows = await ctx.prisma.$queryRaw<VersionRow[]>`
          SELECT id, version, estado, publicado_por_id, publicado_en,
                 motivo_cambio, restored_from_id, chain_hash
            FROM ece.workflow_publicacion_audit
           WHERE tipo_doc_id = ${tipDocumentoId}::uuid
           ORDER BY version DESC
           LIMIT ${pageSize} OFFSET ${offset}
        `;
      }

      const countRows = await ctx.prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total
          FROM ece.workflow_publicacion_audit
         WHERE tipo_doc_id = ${tipDocumentoId}::uuid
      `;
      const total = Number(countRows[0]?.total ?? 0);

      return { items: rows, total, page, pageSize };
    }),

  /**
   * Obtiene el snapshot de una versión específica.
   */
  getVersion: tenantProcedure
    .input(
      z.object({
        tipDocumentoId: z.string().uuid(),
        version: z.number().int().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRaw<
        Array<{
          id: string;
          version: number;
          estado: string;
          snapshot_jsonb: unknown;
          publicado_por_id: string | null;
          publicado_en: Date | null;
          motivo_cambio: string | null;
          chain_hash: string | null;
        }>
      >`
        SELECT id, version, estado, snapshot_jsonb,
               publicado_por_id, publicado_en, motivo_cambio, chain_hash
          FROM ece.workflow_publicacion_audit
         WHERE tipo_doc_id = ${input.tipDocumentoId}::uuid
           AND version     = ${input.version}
         LIMIT 1
      `;

      if (!rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Versión no encontrada" });
      }
      return rows[0];
    }),

  /**
   * Computa diff estructural entre dos versiones.
   * US.F2.2.07 — diff visual
   *
   * Retorna: nodes/edges added, removed, modified entre versionA y versionB.
   * El cliente renderiza el diff coloreando nodos (verde/rojo/amarillo).
   */
  diff: tenantProcedure
    .input(
      z.object({
        tipDocumentoId: z.string().uuid(),
        versionA: z.number().int().min(1),
        versionB: z.number().int().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tipDocumentoId, versionA, versionB } = input;

      const rows = await ctx.prisma.$queryRaw<
        Array<{ version: number; snapshot_jsonb: unknown }>
      >`
        SELECT version, snapshot_jsonb
          FROM ece.workflow_publicacion_audit
         WHERE tipo_doc_id = ${tipDocumentoId}::uuid
           AND version = ANY(ARRAY[${versionA}, ${versionB}])
      `;

      const snapA = rows.find((r) => r.version === versionA)?.snapshot_jsonb as
        | { nodes: Array<{ id: string; nombre: string; [k: string]: unknown }>; edges: Array<{ id: string; accion: string; [k: string]: unknown }> }
        | undefined;
      const snapB = rows.find((r) => r.version === versionB)?.snapshot_jsonb as
        | { nodes: Array<{ id: string; nombre: string; [k: string]: unknown }>; edges: Array<{ id: string; accion: string; [k: string]: unknown }> }
        | undefined;

      if (!snapA || !snapB) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Una o ambas versiones no encontradas" });
      }

      return computeDiff(snapA, snapB);
    }),

  /**
   * Rollback: restaura versión HISTORICO como nueva publicación PUBLICADO.
   * US.F2.2.19
   * Solo DIR puede hacer rollback.
   */
  rollback: dirProc
    .input(
      z.object({
        tipDocumentoId: z.string().uuid(),
        targetVersionId: z.string().uuid(),
        motivoCambio: z.string().min(1, "El motivo es obligatorio"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tipDocumentoId, targetVersionId, motivoCambio } = input;
      const userId = ctx.user.id;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Cargar versión objetivo
        const targetRows = await tx.$queryRaw<
          Array<{ version: number; estado: string; snapshot_jsonb: unknown }>
        >`
          SELECT version, estado, snapshot_jsonb
            FROM ece.workflow_publicacion_audit
           WHERE id = ${targetVersionId}::uuid
             AND tipo_doc_id = ${tipDocumentoId}::uuid
           LIMIT 1
        `;

        const target = targetRows[0];
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Versión objetivo no encontrada" });
        }
        if (target.estado !== "HISTORICO") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Solo se pueden restaurar versiones en estado HISTORICO",
          });
        }

        // Obtener siguiente versión
        const versionRows = await tx.$queryRaw<Array<{ next_version: number }>>`
          SELECT ece.next_workflow_version(${tipDocumentoId}::uuid) AS next_version
        `;
        const nextVersion = Number(versionRows[0]?.next_version ?? 1);

        // Hash chain
        const lastHashRows = await tx.$queryRaw<Array<{ chain_hash: string | null }>>`
          SELECT chain_hash
            FROM ece.workflow_publicacion_audit
           WHERE tipo_doc_id = ${tipDocumentoId}::uuid
           ORDER BY version DESC
           LIMIT 1
        `;
        const prevHash = lastHashRows[0]?.chain_hash ?? null;
        const snapshotJson = JSON.stringify(target.snapshot_jsonb);
        const chainHash = buildChainHash(prevHash, snapshotJson);

        // Marcar publicado actual como HISTORICO
        await tx.$executeRaw`
          UPDATE ece.workflow_publicacion_audit
             SET estado = 'HISTORICO'
           WHERE tipo_doc_id = ${tipDocumentoId}::uuid
             AND estado = 'PUBLICADO'
        `;

        // Crear nueva versión PUBLICADO con referencia al restored_from
        const insertedRows = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO ece.workflow_publicacion_audit
            (tipo_doc_id, version, estado, publicado_por_id, publicado_en,
             snapshot_jsonb, motivo_cambio, restored_from_id, prev_hash, chain_hash)
          VALUES
            (${tipDocumentoId}::uuid, ${nextVersion}, 'PUBLICADO',
             ${userId}::uuid, now(),
             ${snapshotJson}::jsonb, ${motivoCambio},
             ${targetVersionId}::uuid, ${prevHash}, ${chainHash})
          RETURNING id
        `;

        return {
          id: insertedRows[0]?.id ?? "",
          version: nextVersion,
          restoredFromVersion: target.version,
          chainHash,
        };
      });
    }),

  /**
   * Valida roles de un snapshot contra el catálogo vigente.
   * US.F2.2.18 — defensa en profundidad al publicar
   */
  validateRoles: tenantProcedure
    .input(
      z.object({
        rolCodigos: z.array(z.string()).min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { rolCodigos } = input;

      const existentes = await ctx.prisma.$queryRaw<Array<{ codigo: string }>>(
        Prisma.sql`SELECT codigo FROM public."Role" WHERE codigo = ANY(${rolCodigos})`,
      );
      const existenteSet = new Set(existentes.map((r) => r.codigo));

      return rolCodigos.map((codigo) => ({
        codigo,
        existe: existenteSet.has(codigo),
      }));
    }),

  /**
   * Job nightly: detecta roles huérfanos en todos los workflows publicados.
   * US.F2.2.18 — persiste en ece.workflow_role_orphan
   */
  detectRoleOrphans: dirProc
    .input(z.object({ tipDocumentoId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Carga todos los workflows publicados activos
      type PublishedRow = { id: string; tipo_doc_id: string; snapshot_jsonb: unknown };
      let publishedRows: PublishedRow[];
      if (input.tipDocumentoId) {
        publishedRows = await ctx.prisma.$queryRaw<PublishedRow[]>`
          SELECT id, tipo_doc_id, snapshot_jsonb
            FROM ece.workflow_publicacion_audit
           WHERE estado = 'PUBLICADO'
             AND tipo_doc_id = ${input.tipDocumentoId}::uuid
        `;
      } else {
        publishedRows = await ctx.prisma.$queryRaw<PublishedRow[]>`
          SELECT id, tipo_doc_id, snapshot_jsonb
            FROM ece.workflow_publicacion_audit
           WHERE estado = 'PUBLICADO'
        `;
      }

      if (publishedRows.length === 0) return { detected: 0 };

      // Recolectar todos los rol_codigos referenciados
      const allRolCodigos = new Set<string>();
      const tipoDocRoles = new Map<string, Set<string>>();

      for (const row of publishedRows) {
        const snap = row.snapshot_jsonb as {
          edges?: Array<{ rolCodigo?: string }>;
        };
        const roles = new Set<string>();
        for (const edge of snap.edges ?? []) {
          if (edge.rolCodigo) {
            allRolCodigos.add(edge.rolCodigo);
            roles.add(edge.rolCodigo);
          }
        }
        tipoDocRoles.set(row.tipo_doc_id, roles);
      }

      if (allRolCodigos.size === 0) return { detected: 0 };

      const codigosList = [...allRolCodigos];
      const existentes = await ctx.prisma.$queryRaw<Array<{ codigo: string }>>(
        Prisma.sql`SELECT codigo FROM public."Role" WHERE codigo = ANY(${codigosList})`,
      );
      const existenteSet = new Set(existentes.map((r) => r.codigo));

      // Insertar orfanatos nuevos
      let detected = 0;
      for (const [tipDocId, roles] of tipoDocRoles) {
        for (const rolCodigo of roles) {
          if (!existenteSet.has(rolCodigo)) {
            await ctx.prisma.$executeRaw`
              INSERT INTO ece.workflow_role_orphan (tipo_doc_id, rol_codigo)
              VALUES (${tipDocId}::uuid, ${rolCodigo})
              ON CONFLICT DO NOTHING
            `;
            detected++;
          }
        }
      }

      return { detected };
    }),

  /**
   * Lista de roles huérfanos no resueltos para dashboard.
   */
  listRoleOrphans: tenantProcedure
    .input(z.object({ soloNoResueltos: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      type OrphanRow = {
        id: string;
        tipo_doc_id: string;
        rol_codigo: string;
        detectado_en: Date;
        resuelto: boolean;
      };
      let rows: OrphanRow[];
      if (input.soloNoResueltos) {
        rows = await ctx.prisma.$queryRaw<OrphanRow[]>`
          SELECT id, tipo_doc_id, rol_codigo, detectado_en, resuelto
            FROM ece.workflow_role_orphan
           WHERE resuelto = false
           ORDER BY detectado_en DESC
           LIMIT 200
        `;
      } else {
        rows = await ctx.prisma.$queryRaw<OrphanRow[]>`
          SELECT id, tipo_doc_id, rol_codigo, detectado_en, resuelto
            FROM ece.workflow_role_orphan
           ORDER BY detectado_en DESC
           LIMIT 200
        `;
      }
      return rows;
    }),
});

// ─── Diff engine (pura, sin IO) ───────────────────────────────────────────────

type SnapNode = { id: string; nombre: string; [k: string]: unknown };
type SnapEdge = { id: string; accion: string; [k: string]: unknown };
type Snapshot = { nodes: SnapNode[]; edges: SnapEdge[] };

interface DiffResult {
  nodes: {
    added: SnapNode[];
    removed: SnapNode[];
    modified: Array<{ before: SnapNode; after: SnapNode }>;
    unchanged: SnapNode[];
  };
  edges: {
    added: SnapEdge[];
    removed: SnapEdge[];
    modified: Array<{ before: SnapEdge; after: SnapEdge }>;
    unchanged: SnapEdge[];
  };
}

export function computeDiff(snapA: Snapshot, snapB: Snapshot): DiffResult {
  const nodesA = new Map(snapA.nodes.map((n) => [n.id, n]));
  const nodesB = new Map(snapB.nodes.map((n) => [n.id, n]));
  const edgesA = new Map(snapA.edges.map((e) => [e.id, e]));
  const edgesB = new Map(snapB.edges.map((e) => [e.id, e]));

  const nodeResult: DiffResult["nodes"] = {
    added: [],
    removed: [],
    modified: [],
    unchanged: [],
  };
  const edgeResult: DiffResult["edges"] = {
    added: [],
    removed: [],
    modified: [],
    unchanged: [],
  };

  for (const [id, nodeA] of nodesA) {
    const nodeB = nodesB.get(id);
    if (!nodeB) {
      nodeResult.removed.push(nodeA);
    } else if (JSON.stringify(nodeA) !== JSON.stringify(nodeB)) {
      nodeResult.modified.push({ before: nodeA, after: nodeB });
    } else {
      nodeResult.unchanged.push(nodeA);
    }
  }
  for (const [id, nodeB] of nodesB) {
    if (!nodesA.has(id)) nodeResult.added.push(nodeB);
  }

  for (const [id, edgeA] of edgesA) {
    const edgeB = edgesB.get(id);
    if (!edgeB) {
      edgeResult.removed.push(edgeA);
    } else if (JSON.stringify(edgeA) !== JSON.stringify(edgeB)) {
      edgeResult.modified.push({ before: edgeA, after: edgeB });
    } else {
      edgeResult.unchanged.push(edgeA);
    }
  }
  for (const [id, edgeB] of edgesB) {
    if (!edgesA.has(id)) edgeResult.added.push(edgeB);
  }

  return { nodes: nodeResult, edges: edgeResult };
}
