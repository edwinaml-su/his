/**
 * Router tRPC: Tarifario de Servicios — ServicePriceList + ServicePriceListItem.
 *
 * Tablas fuera de schema.prisma (drift). Toda lectura/escritura via $queryRawUnsafe.
 *
 * Convención de columnas (PascalCase tabla / camelCase quoted igual que Invoice):
 *   "ServicePriceList":     id, "organizationId", name, "currencyId", "validFrom",
 *                           "validTo", active, notes, "createdAt", "updatedAt"
 *   "ServicePriceListItem": id, "priceListId", code, description, "unitPrice",
 *                           "estimatedCost", "serviceUnitId", "suggestedCostCenterId",
 *                           active, "createdAt", "updatedAt"
 *
 * RBAC: lecturas con tenantProcedure; escrituras con ADMIN o ACCOUNTANT.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Tipos raw
// ---------------------------------------------------------------------------

interface PriceListRow {
  id: string;
  organizationId: string;
  name: string;
  currencyId: string;
  validFrom: Date;
  validTo: Date | null;
  active: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PriceListWithCount extends PriceListRow {
  itemCount: string; // bigint viene como string desde raw
}

interface PriceListItemRow {
  id: string;
  priceListId: string;
  code: string | null;
  description: string;
  unitPrice: string;
  estimatedCost: string | null;
  serviceUnitId: string | null;
  suggestedCostCenterId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PriceListItemWithCC extends PriceListItemRow {
  costCenterCode: string | null;
  costCenterName: string | null;
}

// ---------------------------------------------------------------------------
// Schemas locales
// ---------------------------------------------------------------------------

const readerProc = tenantProcedure;
const writerProc = requireRole(["ADMIN", "ACCOUNTANT"]);

const listInput = z
  .object({
    active: z.boolean().optional(),
  })
  .optional();

const getInput = z.object({ id: z.string().uuid() });

const createListInput = z.object({
  name: z.string().trim().min(2).max(120),
  currencyId: z.string().uuid(),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

const updateListInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(120).optional(),
  currencyId: z.string().uuid().optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const addItemInput = z.object({
  priceListId: z.string().uuid(),
  code: z.string().trim().max(60).optional(),
  description: z.string().trim().min(1).max(300),
  unitPrice: z.number().min(0),
  estimatedCost: z.number().min(0).optional(),
  serviceUnitId: z.string().uuid().optional(),
  suggestedCostCenterId: z.string().uuid().optional(),
});

const updateItemInput = z.object({
  id: z.string().uuid(),
  code: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().min(1).max(300).optional(),
  unitPrice: z.number().min(0).optional(),
  estimatedCost: z.number().min(0).nullable().optional(),
  serviceUnitId: z.string().uuid().nullable().optional(),
  suggestedCostCenterId: z.string().uuid().nullable().optional(),
});

const setItemActiveInput = z.object({ id: z.string().uuid(), active: z.boolean() });
const setListActiveInput = z.object({ id: z.string().uuid(), active: z.boolean() });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const servicePriceListRouter = router({
  /**
   * Lista de tarifarios de la org con conteo de items.
   */
  list: readerProc.input(listInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const conditions: string[] = [`pl."organizationId" = $1`];
      const params: unknown[] = [tenant.organizationId];
      let idx = 2;

      if (input?.active !== undefined) {
        conditions.push(`pl.active = $${idx++}`);
        params.push(input.active);
      }

      const rows = await tx.$queryRawUnsafe<PriceListWithCount[]>(
        `SELECT pl.id, pl."organizationId", pl.name, pl."currencyId",
                pl."validFrom", pl."validTo", pl.active, pl.notes,
                pl."createdAt", pl."updatedAt",
                COUNT(i.id) AS "itemCount"
           FROM "ServicePriceList" pl
           LEFT JOIN "ServicePriceListItem" i
             ON i."priceListId" = pl.id AND i.active = true
          WHERE ${conditions.join(" AND ")}
          GROUP BY pl.id
          ORDER BY pl."validFrom" DESC, pl.name`,
        ...params,
      );

      return rows.map((r) => ({ ...r, itemCount: Number(r.itemCount) }));
    });
  }),

  /**
   * Detalle de un tarifario con todos sus items.
   */
  get: readerProc.input(getInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const lists = await tx.$queryRawUnsafe<PriceListRow[]>(
        `SELECT id, "organizationId", name, "currencyId", "validFrom", "validTo",
                active, notes, "createdAt", "updatedAt"
           FROM "ServicePriceList"
          WHERE id = $1 AND "organizationId" = $2`,
        input.id,
        tenant.organizationId,
      );

      const pl = lists[0];
      if (!pl) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarifario no encontrado." });
      }

      const items = await tx.$queryRawUnsafe<PriceListItemWithCC[]>(
        `SELECT i.id, i."priceListId", i.code, i.description,
                i."unitPrice", i."estimatedCost", i."serviceUnitId",
                i."suggestedCostCenterId", i.active, i."createdAt", i."updatedAt",
                cc.code AS "costCenterCode", cc.name AS "costCenterName"
           FROM "ServicePriceListItem" i
           LEFT JOIN "CostCenter" cc ON cc.id = i."suggestedCostCenterId"
          WHERE i."priceListId" = $1
          ORDER BY i.code NULLS LAST, i.description`,
        input.id,
      );

      return { ...pl, items };
    });
  }),

  /**
   * Todos los items activos de tarifarios activos del tenant.
   * Usado por el autocomplete en el formulario de Invoice.
   * Incluye info del CostCenter sugerido para auto-fill.
   */
  listActiveItems: readerProc.query(async ({ ctx }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          priceListId: string;
          priceListName: string;
          code: string | null;
          description: string;
          unitPrice: string;
          estimatedCost: string | null;
          serviceUnitId: string | null;
          suggestedCostCenterId: string | null;
          costCenterCode: string | null;
          costCenterName: string | null;
        }>
      >(
        `SELECT i.id, i."priceListId", pl.name AS "priceListName",
                i.code, i.description, i."unitPrice", i."estimatedCost",
                i."serviceUnitId", i."suggestedCostCenterId",
                cc.code AS "costCenterCode", cc.name AS "costCenterName"
           FROM "ServicePriceListItem" i
           JOIN "ServicePriceList" pl
             ON pl.id = i."priceListId"
            AND pl."organizationId" = $1
            AND pl.active = true
           LEFT JOIN "CostCenter" cc ON cc.id = i."suggestedCostCenterId"
          WHERE i.active = true
          ORDER BY i.code NULLS LAST, i.description`,
        tenant.organizationId,
      );

      return rows;
    });
  }),

  /**
   * Crea un nuevo tarifario (sin items).
   */
  create: writerProc.input(createListInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      type IdRow = { id: string };
      const result = await tx.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO "ServicePriceList"
           ("organizationId", name, "currencyId", "validFrom", "validTo", active, notes)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         RETURNING id`,
        tenant.organizationId,
        input.name,
        input.currencyId,
        input.validFrom,
        input.validTo ?? null,
        input.notes ?? null,
      );

      const id = result[0]?.id;
      if (!id) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear tarifario." });
      }
      return { id };
    });
  }),

  /**
   * Edita metadata del tarifario.
   */
  update: writerProc.input(updateListInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      // Verificar pertenencia al tenant
      type CheckRow = { id: string };
      const check = await tx.$queryRawUnsafe<CheckRow[]>(
        `SELECT id FROM "ServicePriceList" WHERE id = $1 AND "organizationId" = $2`,
        input.id,
        tenant.organizationId,
      );
      if (!check[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarifario no encontrado." });
      }

      // Construir SET dinámico solo con campos enviados
      const sets: string[] = [`"updatedAt" = now()`];
      const params: unknown[] = [];
      let idx = 1;

      if (input.name !== undefined) { sets.push(`name = $${idx++}`); params.push(input.name); }
      if (input.currencyId !== undefined) { sets.push(`"currencyId" = $${idx++}`); params.push(input.currencyId); }
      if (input.validFrom !== undefined) { sets.push(`"validFrom" = $${idx++}`); params.push(input.validFrom); }
      if (input.validTo !== undefined) { sets.push(`"validTo" = $${idx++}`); params.push(input.validTo); }
      if (input.notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(input.notes); }

      params.push(input.id);
      await tx.$queryRawUnsafe(
        `UPDATE "ServicePriceList" SET ${sets.join(", ")} WHERE id = $${idx}`,
        ...params,
      );

      return { id: input.id };
    });
  }),

  /**
   * Agrega un item al tarifario.
   */
  addItem: writerProc.input(addItemInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      // Verificar que el tarifario pertenece al tenant
      type CheckRow = { id: string };
      const check = await tx.$queryRawUnsafe<CheckRow[]>(
        `SELECT id FROM "ServicePriceList" WHERE id = $1 AND "organizationId" = $2`,
        input.priceListId,
        tenant.organizationId,
      );
      if (!check[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarifario no encontrado." });
      }

      type IdRow = { id: string };
      const result = await tx.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO "ServicePriceListItem"
           ("priceListId", code, description, "unitPrice", "estimatedCost",
            "serviceUnitId", "suggestedCostCenterId", active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         RETURNING id`,
        input.priceListId,
        input.code ?? null,
        input.description,
        input.unitPrice,
        input.estimatedCost ?? null,
        input.serviceUnitId ?? null,
        input.suggestedCostCenterId ?? null,
      );

      const id = result[0]?.id;
      if (!id) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al agregar item." });
      }
      return { id };
    });
  }),

  /**
   * Edita un item del tarifario.
   */
  updateItem: writerProc.input(updateItemInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      // Verificar pertenencia (join con lista del tenant)
      type CheckRow = { id: string };
      const check = await tx.$queryRawUnsafe<CheckRow[]>(
        `SELECT i.id FROM "ServicePriceListItem" i
           JOIN "ServicePriceList" pl ON pl.id = i."priceListId"
          WHERE i.id = $1 AND pl."organizationId" = $2`,
        input.id,
        tenant.organizationId,
      );
      if (!check[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item no encontrado." });
      }

      const sets: string[] = [`"updatedAt" = now()`];
      const params: unknown[] = [];
      let idx = 1;

      if (input.code !== undefined) { sets.push(`code = $${idx++}`); params.push(input.code); }
      if (input.description !== undefined) { sets.push(`description = $${idx++}`); params.push(input.description); }
      if (input.unitPrice !== undefined) { sets.push(`"unitPrice" = $${idx++}`); params.push(input.unitPrice); }
      if (input.estimatedCost !== undefined) { sets.push(`"estimatedCost" = $${idx++}`); params.push(input.estimatedCost); }
      if (input.serviceUnitId !== undefined) { sets.push(`"serviceUnitId" = $${idx++}`); params.push(input.serviceUnitId); }
      if (input.suggestedCostCenterId !== undefined) { sets.push(`"suggestedCostCenterId" = $${idx++}`); params.push(input.suggestedCostCenterId); }

      params.push(input.id);
      await tx.$queryRawUnsafe(
        `UPDATE "ServicePriceListItem" SET ${sets.join(", ")} WHERE id = $${idx}`,
        ...params,
      );

      return { id: input.id };
    });
  }),

  /**
   * Toggle active de un item.
   */
  setItemActive: writerProc.input(setItemActiveInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      type CheckRow = { id: string };
      const check = await tx.$queryRawUnsafe<CheckRow[]>(
        `SELECT i.id FROM "ServicePriceListItem" i
           JOIN "ServicePriceList" pl ON pl.id = i."priceListId"
          WHERE i.id = $1 AND pl."organizationId" = $2`,
        input.id,
        tenant.organizationId,
      );
      if (!check[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item no encontrado." });
      }

      await tx.$queryRawUnsafe(
        `UPDATE "ServicePriceListItem" SET active = $1, "updatedAt" = now() WHERE id = $2`,
        input.active,
        input.id,
      );

      return { id: input.id, active: input.active };
    });
  }),

  /**
   * Toggle active de un tarifario.
   */
  setListActive: writerProc.input(setListActiveInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      type CheckRow = { id: string };
      const check = await tx.$queryRawUnsafe<CheckRow[]>(
        `SELECT id FROM "ServicePriceList" WHERE id = $1 AND "organizationId" = $2`,
        input.id,
        tenant.organizationId,
      );
      if (!check[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarifario no encontrado." });
      }

      await tx.$queryRawUnsafe(
        `UPDATE "ServicePriceList" SET active = $1, "updatedAt" = now() WHERE id = $2`,
        input.active,
        input.id,
      );

      return { id: input.id, active: input.active };
    });
  }),
});
