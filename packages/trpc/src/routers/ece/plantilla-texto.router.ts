/**
 * Router tRPC — Plantillas de texto por médico/organización (CC-0007 RF-04/RF-07).
 *
 * Tabla: ece.plantilla_texto — tenant-scoped.
 * RLS policy usa public.current_org_id() → DEBE usar withTenantContext.
 * Campo: ENFERMEDAD_ACTUAL | EXAMEN_FISICO.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../../trpc";
import { withTenantContext } from "../../rls-context";

const campoEnum = z.enum(["ENFERMEDAD_ACTUAL", "EXAMEN_FISICO"]);

export const plantillaTextoRouter = router({
  /**
   * Lista plantillas activas de la organización.
   * Filtro por campo opcional.
   */
  list: tenantProcedure
    .input(
      z.object({
        campo: campoEnum.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.ecePlantillaTexto.findMany({
          where: {
            activo: true,
            ...(input.campo ? { campo: input.campo } : {}),
          },
          select: { id: true, campo: true, titulo: true, contenido: true },
          orderBy: { titulo: "asc" },
        });
      });
    }),

  /**
   * Crea una nueva plantilla para la organización.
   */
  create: tenantProcedure
    .input(
      z.object({
        campo: campoEnum,
        titulo: z.string().min(1).max(200),
        contenido: z.string().min(1).max(10000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.ecePlantillaTexto.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            campo: input.campo,
            titulo: input.titulo,
            contenido: input.contenido,
          },
        });
      });
    }),

  /**
   * Actualiza título y/o contenido de una plantilla existente.
   * RLS garantiza que solo se accede a plantillas de la propia org.
   */
  update: tenantProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        titulo: z.string().min(1).max(200).optional(),
        contenido: z.string().min(1).max(10000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, titulo, contenido } = input;
      if (titulo === undefined && contenido === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Se requiere al menos un campo para actualizar.",
        });
      }
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.ecePlantillaTexto.update({
          where: { id },
          data: {
            ...(titulo !== undefined ? { titulo } : {}),
            ...(contenido !== undefined ? { contenido } : {}),
          },
        });
      });
    }),

  /**
   * Soft-delete: marca activo = false. No borra el registro.
   */
  eliminar: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.ecePlantillaTexto.update({
          where: { id: input.id },
          data: { activo: false },
        });
      });
    }),
});
