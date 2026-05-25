/**
 * Router tRPC: Costos Operativos del HIS (Wave 9).
 *
 * La tabla "HisOperatingCost" NO tiene modelo Prisma (drift por diseño).
 * Todas las queries usan $queryRawUnsafe / $executeRawUnsafe.
 *
 * RLS: organizationId NULL es visible a todos los tenants (compartido).
 * organizationId NOT NULL: visible solo al tenant que lo registró.
 *
 * Procedures:
 *   list   — readerProc, filtros: category?, periodStart?, periodEnd?, onlyShared?
 *   get    — readerProc, por id
 *   create — writerProc RBAC ["ADMIN","ACCOUNTANT"], organizationId NULL = compartido
 *   update — writerProc, mismas validaciones que create
 *   delete — writerProc
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Schemas locales
// ---------------------------------------------------------------------------

const categoryEnum = z.enum([
  "SUBSCRIPTION",
  "INFRASTRUCTURE",
  "SUPPORT",
  "LICENSE",
  "OTHER",
]);

const costFields = z.object({
  organizationId: z.string().uuid().optional(), // omitir → compartido (NULL)
  category: categoryEnum,
  description: z.string().trim().min(1).max(200),
  vendor: z.string().trim().max(120).optional(),
  amount: z.number().min(0),
  currencyId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  notes: z.string().max(5000).optional(),
});

const costInput = costFields.refine(
  (d) => d.periodEnd >= d.periodStart,
  { message: "periodEnd debe ser >= periodStart", path: ["periodEnd"] },
);

const costUpdateInput = costFields
  .extend({ id: z.string().uuid() })
  .refine(
    (d) => d.periodEnd >= d.periodStart,
    { message: "periodEnd debe ser >= periodStart", path: ["periodEnd"] },
  );

const listInput = z.object({
  category: categoryEnum.optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  onlyShared: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

interface CostRow {
  id: string;
  organizationId: string | null;
  category: string;
  description: string;
  vendor: string | null;
  amount: string;
  currencyId: string;
  currencyCode: string | null;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const readerProc = tenantProcedure;
const writerProc = requireRole(["ADMIN", "ACCOUNTANT"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const operatingCostRouter = router({
  /**
   * Listado paginado con filtros opcionales.
   * onlyShared=true → solo registros con organizationId IS NULL.
   * Sin onlyShared → registros del tenant + compartidos (RLS lo garantiza).
   */
  list: readerProc.input(listInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (input.onlyShared) {
        conditions.push(`hoc."organizationId" IS NULL`);
      }
      if (input.category) {
        conditions.push(`hoc.category = $${idx++}::his_cost_category`);
        params.push(input.category);
      }
      if (input.periodStart) {
        conditions.push(`hoc."periodEnd" >= $${idx++}::date`);
        params.push(input.periodStart);
      }
      if (input.periodEnd) {
        conditions.push(`hoc."periodStart" <= $${idx++}::date`);
        params.push(input.periodEnd);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      params.push(input.limit, input.offset);

      const rows = await tx.$queryRawUnsafe<CostRow[]>(
        `SELECT hoc.id,
                hoc."organizationId",
                hoc.category::text,
                hoc.description,
                hoc.vendor,
                hoc.amount::text,
                hoc."currencyId",
                c."isoCode" AS "currencyCode",
                hoc."periodStart"::text,
                hoc."periodEnd"::text,
                hoc.notes,
                hoc."createdAt",
                hoc."updatedAt"
           FROM "HisOperatingCost" hoc
           LEFT JOIN "Currency" c ON c.id = hoc."currencyId"
         ${where}
          ORDER BY hoc."periodStart" DESC, hoc.category, hoc.description
          LIMIT $${idx++} OFFSET $${idx++}`,
        ...params,
      );

      return rows;
    });
  }),

  /**
   * Detalle por id.
   */
  get: readerProc.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const rows = await tx.$queryRawUnsafe<CostRow[]>(
        `SELECT hoc.id,
                hoc."organizationId",
                hoc.category::text,
                hoc.description,
                hoc.vendor,
                hoc.amount::text,
                hoc."currencyId",
                c."isoCode" AS "currencyCode",
                hoc."periodStart"::text,
                hoc."periodEnd"::text,
                hoc.notes,
                hoc."createdAt",
                hoc."updatedAt"
           FROM "HisOperatingCost" hoc
           LEFT JOIN "Currency" c ON c.id = hoc."currencyId"
          WHERE hoc.id = $1`,
        input.id,
      );

      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Costo operativo no encontrado." });
      }
      return row;
    });
  }),

  /**
   * Crea un costo operativo.
   * Si organizationId no viene → NULL (compartido entre todas las orgs).
   */
  create: writerProc.input(costInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      type IdRow = { id: string };
      const rows = await tx.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO "HisOperatingCost"
           ("organizationId", category, description, vendor, amount,
            "currencyId", "periodStart", "periodEnd", notes, "createdBy")
         VALUES ($1, $2::his_cost_category, $3, $4, $5, $6, $7::date, $8::date, $9, $10)
         RETURNING id`,
        input.organizationId ?? null,
        input.category,
        input.description,
        input.vendor ?? null,
        input.amount,
        input.currencyId,
        input.periodStart,
        input.periodEnd,
        input.notes ?? null,
        ctx.user?.id ?? null,
      );

      const id = rows[0]?.id;
      if (!id) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear costo." });
      }
      return { id };
    });
  }),

  /**
   * Actualiza un costo existente. Mismas validaciones que create.
   */
  update: writerProc
    .input(costUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;

      return withTenantContext(prisma, tenant, async (tx) => {
        // Verificar existencia
        type IdRow = { id: string };
        const existing = await tx.$queryRawUnsafe<IdRow[]>(
          `SELECT id FROM "HisOperatingCost" WHERE id = $1`,
          input.id,
        );
        if (!existing[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Costo operativo no encontrado." });
        }

        await tx.$queryRawUnsafe(
          `UPDATE "HisOperatingCost"
              SET "organizationId" = $1,
                  category        = $2::his_cost_category,
                  description     = $3,
                  vendor          = $4,
                  amount          = $5,
                  "currencyId"    = $6,
                  "periodStart"   = $7::date,
                  "periodEnd"     = $8::date,
                  notes           = $9,
                  "updatedAt"     = now(),
                  "updatedBy"     = $10
            WHERE id = $11`,
          input.organizationId ?? null,
          input.category,
          input.description,
          input.vendor ?? null,
          input.amount,
          input.currencyId,
          input.periodStart,
          input.periodEnd,
          input.notes ?? null,
          ctx.user?.id ?? null,
          input.id,
        );

        return { id: input.id };
      });
    }),

  /**
   * Elimina un costo. Permitido (no es transaccional sensible como Invoice).
   */
  delete: writerProc.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      type IdRow = { id: string };
      const existing = await tx.$queryRawUnsafe<IdRow[]>(
        `SELECT id FROM "HisOperatingCost" WHERE id = $1`,
        input.id,
      );
      if (!existing[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Costo operativo no encontrado." });
      }

      await tx.$queryRawUnsafe(
        `DELETE FROM "HisOperatingCost" WHERE id = $1`,
        input.id,
      );

      return { id: input.id };
    });
  }),
});
