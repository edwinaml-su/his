/**
 * Router tRPC — Catálogo CPT global (CC-0007 RF-09).
 *
 * Tabla: ece.catalogo_cpt — global, sin RLS, GRANT SELECT a authenticated.
 * No requiere withEceContext ni withTenantContext.
 * tenantProcedure garantiza sesión + org pero no demota el rol.
 */
import { z } from "zod";
import { router, tenantProcedure } from "../../trpc";

export const cptRouter = router({
  /**
   * Búsqueda por código o descripción (case-insensitive).
   * Devuelve solo registros activos.
   */
  buscar: tenantProcedure
    .input(
      z.object({
        q: z.string().min(1).max(100),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.eceCatalogoCpt.findMany({
        where: {
          activo: true,
          OR: [
            { codigo: { contains: input.q, mode: "insensitive" } },
            { descripcion: { contains: input.q, mode: "insensitive" } },
          ],
        },
        select: { id: true, codigo: true, descripcion: true },
        take: input.limit,
        orderBy: { codigo: "asc" },
      });
    }),

  /**
   * Lista completa de procedimientos CPT activos.
   */
  list: tenantProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.eceCatalogoCpt.findMany({
        where: { activo: true },
        select: { id: true, codigo: true, descripcion: true },
        take: input.limit,
        orderBy: { codigo: "asc" },
      });
    }),
});
