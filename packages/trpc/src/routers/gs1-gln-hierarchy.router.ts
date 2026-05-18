/**
 * Router tRPC: GLN Hierarchy — árbol jerárquico de ubicaciones GS1.
 *
 * US.F2.6.3 — GLN hospitalario jerárquico (almacén → farmacia → servicio → cama).
 *
 * Implementa:
 *   tree(rootId?)         — CTE recursiva devuelve árbol completo o subárbol.
 *   createChild(input)    — alta GLN hija con validación módulo-10 y unicidad cross-org.
 *
 * Seguridad:
 *   Lectura:   tenantProcedure (cualquier usuario autenticado del tenant).
 *   Escritura: requireRole(["ADMIN","LOGISTIC"]).
 *   Todas las queries usan withTenantContext — RLS `authenticated` aplica.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Validación dígito verificador GS1 Módulo-10 (espeja gs1-catalogos.router.ts)
// ---------------------------------------------------------------------------

function gs1CheckDigitValid(code: string): boolean {
  const len = code.length;
  let sum = 0;
  for (let i = 0; i < len - 1; i++) {
    const weight = (len - 1 - i) % 2 === 0 ? 3 : 1;
    sum += parseInt(code[i]!, 10) * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === parseInt(code[len - 1]!, 10);
}

const glnSchema = z
  .string()
  .length(13)
  .regex(/^\d{13}$/, "GLN-13: 13 dígitos numéricos")
  .refine(gs1CheckDigitValid, "Dígito verificador GS1 inválido");

const tipoGlnEnum = z.enum(["proveedor", "deposito", "farmacia", "servicio", "cama"]);

// ---------------------------------------------------------------------------
// Tipos internos de resultado
// ---------------------------------------------------------------------------

interface GlnTreeNode {
  id: string;
  codigo: string;
  descripcion: string;
  tipo: string;
  parentId: string | null;
  depth: number;
  activo: boolean;
  children: GlnTreeNode[];
}

interface GlnFlatRow {
  id: string;
  codigo: string;
  descripcion: string;
  tipo: string;
  parent_id: string | null;
  depth: number;
  activo: boolean;
}

// Convierte filas planas de la CTE en árbol anidado.
function buildTree(rows: GlnFlatRow[]): GlnTreeNode[] {
  const map = new Map<string, GlnTreeNode>();
  const roots: GlnTreeNode[] = [];

  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      codigo: row.codigo,
      descripcion: row.descripcion,
      tipo: row.tipo,
      parentId: row.parent_id,
      depth: row.depth,
      activo: row.activo,
      children: [],
    });
  }

  for (const node of map.values()) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      const parent = map.get(node.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Nodo huérfano (padre fuera del subárbol solicitado) — tratar como raíz.
        roots.push(node);
      }
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const glnHierarchyRouter = router({
  /**
   * tree(rootId?) — devuelve el árbol completo de GLNs o el subárbol bajo rootId.
   * Usa CTE recursiva `WITH RECURSIVE` para una sola query.
   */
  tree: tenantProcedure
    .input(z.object({ rootId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        if (input.rootId) {
          // Subárbol desde un nodo raíz específico.
          return tx.$queryRawUnsafe<GlnFlatRow[]>(
            `WITH RECURSIVE gln_tree AS (
               SELECT id, codigo, descripcion, tipo, parent_id, activo, 0 AS depth
                 FROM ece.gs1_gln
                WHERE id = $1::uuid
               UNION ALL
               SELECT g.id, g.codigo, g.descripcion, g.tipo, g.parent_id, g.activo,
                      t.depth + 1
                 FROM ece.gs1_gln g
                 JOIN gln_tree t ON g.parent_id = t.id
             )
             SELECT * FROM gln_tree ORDER BY depth, descripcion`,
            input.rootId,
          );
        }
        // Árbol completo — raíces son nodos con parent_id IS NULL.
        return tx.$queryRawUnsafe<GlnFlatRow[]>(
          `WITH RECURSIVE gln_tree AS (
             SELECT id, codigo, descripcion, tipo, parent_id, activo, 0 AS depth
               FROM ece.gs1_gln
              WHERE parent_id IS NULL
             UNION ALL
             SELECT g.id, g.codigo, g.descripcion, g.tipo, g.parent_id, g.activo,
                    t.depth + 1
               FROM ece.gs1_gln g
               JOIN gln_tree t ON g.parent_id = t.id
           )
           SELECT * FROM gln_tree ORDER BY depth, descripcion`,
        );
      });

      return buildTree(rows);
    }),

  /**
   * createChild — da de alta un GLN hijo bajo parentGlnId.
   * Valida:
   *   1. Código GLN-13 con dígito verificador módulo-10.
   *   2. Unicidad del código dentro del tenant (cross-org guard).
   */
  createChild: requireRole(["ADMIN", "LOGISTIC"])
    .input(
      z.object({
        parentGlnId:  z.string().uuid().optional(),
        codigo:       glnSchema,
        descripcion:  z.string().min(1).max(500),
        tipo:         tipoGlnEnum,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      type IdRow = { id: string };
      type CountRow = { count: string };

      const id = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Unicidad del código GLN dentro del tenant.
        const existing = await tx.$queryRawUnsafe<CountRow[]>(
          `SELECT COUNT(*)::text AS count FROM ece.gs1_gln WHERE codigo = $1`,
          input.codigo,
        );
        if (parseInt(existing[0]?.count ?? "0", 10) > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El código GLN ${input.codigo} ya existe en esta organización`,
          });
        }

        const rows = await tx.$queryRawUnsafe<IdRow[]>(
          `INSERT INTO ece.gs1_gln (codigo, descripcion, tipo, parent_id)
           VALUES ($1, $2, $3, $4::uuid)
           RETURNING id`,
          input.codigo,
          input.descripcion,
          input.tipo,
          input.parentGlnId ?? null,
        );
        return rows[0]!.id;
      });

      return { id };
    }),
});
