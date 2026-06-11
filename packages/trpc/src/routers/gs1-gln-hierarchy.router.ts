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
// BLOQUEANTE: gs1_gln PK real es `codigo` (text). La tabla NO tiene columnas
// `id` (uuid) ni `parent_id` (uuid). La jerarquía padre-hijo NO es modelable
// con el DDL actual.
//
// Para desbloquear, @DBA debe aplicar:
//   ALTER TABLE ece.gs1_gln
//     ADD COLUMN id        uuid NOT NULL DEFAULT gen_random_uuid(),
//     ADD COLUMN parent_id uuid REFERENCES ece.gs1_gln(id);
//   ALTER TABLE ece.gs1_gln ADD PRIMARY KEY (id);
//   CREATE UNIQUE INDEX ON ece.gs1_gln(codigo);
//
// Mientras tanto: `tree` devuelve lista plana (depth=0 para todos, sin children)
// y `createChild` inserta sin parent_id. Esto evita que el router truene en
// runtime sin los requisitos de schema.
// ---------------------------------------------------------------------------

export interface GlnTreeNode {
  codigo: string;
  descripcion: string;
  tipo: string;
  depth: number;
  activo: boolean;
  children: GlnTreeNode[];
}

interface GlnFlatRow {
  codigo: string;
  descripcion: string;
  tipo: string;
  activo: boolean;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const glnHierarchyRouter = router({
  /**
   * tree — devuelve lista plana de GLNs (depth=0, sin children).
   * La jerarquía recursiva es BLOQUEANTE hasta que @DBA agregue `id`/`parent_id`
   * a ece.gs1_gln. Ver comentario al inicio del archivo.
   * `rootCodigo` filtra por prefijo de código cuando se provee.
   */
  tree: tenantProcedure
    .input(z.object({ rootCodigo: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        if (input.rootCodigo) {
          return tx.$queryRawUnsafe<GlnFlatRow[]>(
            `SELECT codigo, descripcion, tipo, activo
               FROM ece.gs1_gln
              WHERE codigo LIKE $1
              ORDER BY descripcion`,
            `${input.rootCodigo}%`,
          );
        }
        return tx.$queryRawUnsafe<GlnFlatRow[]>(
          `SELECT codigo, descripcion, tipo, activo
             FROM ece.gs1_gln
            ORDER BY descripcion`,
        );
      });

      // Lista plana: todos a depth=0, sin children hasta que exista parent_id en DDL.
      return rows.map((r): GlnTreeNode => ({
        codigo: r.codigo,
        descripcion: r.descripcion,
        tipo: r.tipo,
        depth: 0,
        activo: r.activo,
        children: [],
      }));
    }),

  /**
   * createChild — da de alta un GLN.
   * BLOQUEANTE: `parentGlnId` se ignora (parent_id no existe en DDL).
   * Ver comentario de ALTER TABLE al inicio del archivo.
   */
  createChild: requireRole(["ADMIN", "LOGISTIC"])
    .input(
      z.object({
        // parentGlnId aceptado en input pero ignorado hasta que DDL tenga parent_id.
        parentGlnId:  z.string().optional(),
        codigo:       glnSchema,
        descripcion:  z.string().min(1).max(500),
        tipo:         tipoGlnEnum,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      type CountRow = { count: string };
      type CodigoRow = { codigo: string };

      const codigo = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const existing = await tx.$queryRawUnsafe<CountRow[]>(
          `SELECT COUNT(*)::text AS count FROM ece.gs1_gln WHERE codigo = $1`,
          input.codigo,
        );
        if (parseInt(existing[0]?.count ?? "0", 10) > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El código GLN ${input.codigo} ya existe`,
          });
        }

        const rows = await tx.$queryRawUnsafe<CodigoRow[]>(
          `INSERT INTO ece.gs1_gln (codigo, descripcion, tipo)
           VALUES ($1, $2, $3)
           RETURNING codigo`,
          input.codigo,
          input.descripcion,
          input.tipo,
        );
        return rows[0]!.codigo;
      });

      return { codigo };
    }),
});
