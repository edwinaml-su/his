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
import {
  serviceCategoryListInput,
  serviceCategoryCreateInput,
  serviceCategoryUpdateInput,
  priceRuleListInput,
  priceRuleCreateInput,
  priceRuleUpdateInput,
  priceRuleSetActiveInput,
  priceRuleSimularInput,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";
import { resolverPrecio, resolverPrecioEnLista } from "../lib/price-resolver";

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

/** CC-0021 — fila de "ServiceCategory" con datos derivados para el admin. */
interface CategoryRow {
  id: string;
  code: string;
  nombre: string;
  parentId: string | null;
  parentNombre: string | null;
  active: boolean;
  ruleCount: number;
}

/** CC-0021 — fila de "ServicePriceRule" con los nombres de sus referencias. */
interface PriceRuleRow {
  id: string;
  priceListId: string;
  appliedOn: "item" | "category" | "global";
  itemCode: string | null;
  categoryId: string | null;
  categoryNombre: string | null;
  minQuantity: string;
  dateStart: Date | null;
  dateEnd: Date | null;
  computePrice: "fixed" | "percentage" | "formula";
  fixedPrice: string | null;
  percentPrice: string;
  base: "list_price" | "standard_cost" | "pricelist";
  basePriceListId: string | null;
  basePriceListName: string | null;
  priceDiscount: string;
  priceSurcharge: string;
  priceRound: string;
  priceMinMargin: string;
  priceMaxMargin: string;
  sequence: number;
  notes: string | null;
  odooItemId: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Tipo mínimo del cliente de transacción que necesitan las guardas de tenant. */
type TxForGuards = { $queryRawUnsafe: <T>(query: string, ...values: unknown[]) => Promise<T> };

async function assertListaDelTenant(tx: TxForGuards, id: string, organizationId: string): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "ServicePriceList" WHERE id = $1 AND "organizationId" = $2`,
    id,
    organizationId,
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Tarifario no encontrado." });
}

async function assertCategoriaDelTenant(tx: TxForGuards, id: string, organizationId: string): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "ServiceCategory" WHERE id = $1 AND "organizationId" = $2`,
    id,
    organizationId,
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Categoría no encontrada." });
}

async function assertReglaDelTenant(tx: TxForGuards, id: string, organizationId: string): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT r.id FROM "ServicePriceRule" r
       JOIN "ServicePriceList" pl ON pl.id = r."priceListId"
      WHERE r.id = $1 AND pl."organizationId" = $2`,
    id,
    organizationId,
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada." });
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

// CC-0015 — filtro opcional por lista (usado por finance/invoices/nuevo cuando
// hay una cuenta con tipoCuenta.priceListId seleccionada).
const listActiveItemsInput = z
  .object({
    priceListId: z.string().uuid().optional(),
  })
  .optional();

// CC-0015 — resolución de precios por cuenta de paciente (pivote tipoCuenta → lista).
// CC-0021 — `cantidad` activa los tramos por cantidad mínima de las reglas.
const resolverPorCuentaInput = z.object({
  cuentaId: z.string().uuid(),
  codes: z.array(z.string().trim().min(1)).min(1).max(200),
  cantidad: z.number().min(0).optional(),
});

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
   *
   * CC-0015: `priceListId` filtra a una sola lista (usada cuando la factura
   * tiene una cuenta seleccionada y se conoce su tipoCuenta.priceListId).
   * Sin el filtro, el comportamiento es el mismo de antes (todas las listas activas).
   */
  listActiveItems: readerProc.input(listActiveItemsInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const params: unknown[] = [tenant.organizationId];
      let filterSql = "";
      if (input?.priceListId) {
        filterSql = `AND pl.id = $2`;
        params.push(input.priceListId);
      }

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
          WHERE i.active = true ${filterSql}
          ORDER BY i.code NULLS LAST, i.description`,
        ...params,
      );

      return rows;
    });
  }),

  /**
   * CC-0015 — resuelve el precio de una lista de `codes` para una cuenta,
   * siguiendo la cadena: item de la lista del tipoCuenta → LabTest.standardPrice → null.
   */
  resolverPorCuenta: readerProc.input(resolverPorCuentaInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const resultados = await Promise.all(
        input.codes.map(async (code) => {
          const r = await resolverPrecio(tx, {
            organizationId: tenant.organizationId,
            cuentaId: input.cuentaId,
            code,
            cantidad: input.cantidad,
          });
          return { code, precio: r.precio, fuente: r.fuente, reglaId: r.reglaId };
        }),
      );
      return resultados;
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

  // ===========================================================================
  // CC-0021 — Categorías de servicio (product.category de Odoo)
  // ===========================================================================

  /** Categorías de la org, con el nombre de la categoría padre. */
  listCategories: readerProc.input(serviceCategoryListInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const filtro = input?.activeOnly ? `AND sc.active = true` : "";
      return tx.$queryRawUnsafe<CategoryRow[]>(
        `SELECT sc.id, sc.code, sc.nombre, sc."parentId", sc.active,
                p.nombre AS "parentNombre",
                (SELECT COUNT(*) FROM "ServicePriceRule" r
                  WHERE r."categoryId" = sc.id AND r.active = true)::int AS "ruleCount"
           FROM "ServiceCategory" sc
           LEFT JOIN "ServiceCategory" p ON p.id = sc."parentId"
          WHERE sc."organizationId" = $1 ${filtro}
          ORDER BY sc.code`,
        tenant.organizationId,
      );
    });
  }),

  createCategory: writerProc.input(serviceCategoryCreateInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      if (input.parentId) await assertCategoriaDelTenant(tx, input.parentId, tenant.organizationId);

      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "ServiceCategory" ("organizationId", code, nombre, "parentId")
         VALUES ($1::uuid, $2, $3, $4::uuid)
         RETURNING id`,
        tenant.organizationId,
        input.code,
        input.nombre,
        input.parentId ?? null,
      );

      const id = rows[0]?.id;
      if (!id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear la categoría." });
      return { id };
    });
  }),

  updateCategory: writerProc.input(serviceCategoryUpdateInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      await assertCategoriaDelTenant(tx, input.id, tenant.organizationId);
      if (input.parentId) {
        if (input.parentId === input.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Una categoría no puede ser su propia padre." });
        }
        await assertCategoriaDelTenant(tx, input.parentId, tenant.organizationId);
      }

      const sets: string[] = [`"updatedAt" = now()`];
      const params: unknown[] = [];
      let idx = 1;

      if (input.code !== undefined) { sets.push(`code = $${idx++}`); params.push(input.code); }
      if (input.nombre !== undefined) { sets.push(`nombre = $${idx++}`); params.push(input.nombre); }
      if (input.parentId !== undefined) { sets.push(`"parentId" = $${idx++}::uuid`); params.push(input.parentId); }
      if (input.active !== undefined) { sets.push(`active = $${idx++}`); params.push(input.active); }

      params.push(input.id);
      await tx.$queryRawUnsafe(`UPDATE "ServiceCategory" SET ${sets.join(", ")} WHERE id = $${idx}`, ...params);

      return { id: input.id };
    });
  }),

  // ===========================================================================
  // CC-0021 — Reglas de precio (product.pricelist.item de Odoo)
  // ===========================================================================

  /** Reglas de una lista, en el mismo orden en que las evalúa el motor. */
  listRules: readerProc.input(priceRuleListInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      await assertListaDelTenant(tx, input.priceListId, tenant.organizationId);

      const filtro = input.activeOnly ? `AND r.active = true` : "";
      return tx.$queryRawUnsafe<PriceRuleRow[]>(
        `SELECT r.id, r."priceListId", r."appliedOn", r."itemCode", r."categoryId",
                r."minQuantity", r."dateStart", r."dateEnd", r."computePrice",
                r."fixedPrice", r."percentPrice", r.base, r."basePriceListId",
                r."priceDiscount", r."priceSurcharge", r."priceRound",
                r."priceMinMargin", r."priceMaxMargin", r.sequence, r.notes,
                r."odooItemId", r.active, r."createdAt", r."updatedAt",
                sc.nombre AS "categoryNombre",
                bl.name   AS "basePriceListName"
           FROM "ServicePriceRule" r
           LEFT JOIN "ServiceCategory" sc ON sc.id = r."categoryId"
           LEFT JOIN "ServicePriceList" bl ON bl.id = r."basePriceListId"
          WHERE r."priceListId" = $1 ${filtro}
          ORDER BY CASE r."appliedOn" WHEN 'item' THEN 0 WHEN 'category' THEN 1 ELSE 2 END,
                   r."minQuantity" DESC, r.sequence DESC, r."createdAt" DESC`,
        input.priceListId,
      );
    });
  }),

  addRule: writerProc.input(priceRuleCreateInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      await assertListaDelTenant(tx, input.priceListId, tenant.organizationId);
      if (input.categoryId) await assertCategoriaDelTenant(tx, input.categoryId, tenant.organizationId);
      if (input.basePriceListId) await assertListaDelTenant(tx, input.basePriceListId, tenant.organizationId);

      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "ServicePriceRule"
           ("priceListId", "appliedOn", "itemCode", "categoryId", "minQuantity",
            "dateStart", "dateEnd", "computePrice", "fixedPrice", "percentPrice",
            base, "basePriceListId", "priceDiscount", "priceSurcharge", "priceRound",
            "priceMinMargin", "priceMaxMargin", sequence, notes, "createdBy")
         VALUES ($1::uuid, $2, $3, $4::uuid, $5::numeric, $6::timestamptz, $7::timestamptz,
                 $8, $9::numeric, $10::numeric, $11, $12::uuid, $13::numeric, $14::numeric,
                 $15::numeric, $16::numeric, $17::numeric, $18::int, $19, $20::uuid)
         RETURNING id`,
        input.priceListId,
        input.appliedOn,
        input.itemCode ?? null,
        input.categoryId ?? null,
        input.minQuantity,
        input.dateStart ?? null,
        input.dateEnd ?? null,
        input.computePrice,
        input.fixedPrice ?? null,
        input.percentPrice,
        input.base,
        input.basePriceListId ?? null,
        input.priceDiscount,
        input.priceSurcharge,
        input.priceRound,
        input.priceMinMargin,
        input.priceMaxMargin,
        input.sequence,
        input.notes ?? null,
        ctx.user?.id ?? null,
      );

      const id = rows[0]?.id;
      if (!id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear la regla." });
      return { id };
    });
  }),

  updateRule: writerProc.input(priceRuleUpdateInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      await assertReglaDelTenant(tx, input.id, tenant.organizationId);
      if (input.categoryId) await assertCategoriaDelTenant(tx, input.categoryId, tenant.organizationId);
      if (input.basePriceListId) await assertListaDelTenant(tx, input.basePriceListId, tenant.organizationId);

      const sets: string[] = [`"updatedAt" = now()`];
      const params: unknown[] = [];
      let idx = 1;

      const asignar = (columna: string, valor: unknown, cast = "") => {
        sets.push(`"${columna}" = $${idx++}${cast}`);
        params.push(valor);
      };

      if (input.appliedOn !== undefined) asignar("appliedOn", input.appliedOn);
      if (input.itemCode !== undefined) asignar("itemCode", input.itemCode);
      if (input.categoryId !== undefined) asignar("categoryId", input.categoryId, "::uuid");
      if (input.minQuantity !== undefined) asignar("minQuantity", input.minQuantity, "::numeric");
      if (input.dateStart !== undefined) asignar("dateStart", input.dateStart, "::timestamptz");
      if (input.dateEnd !== undefined) asignar("dateEnd", input.dateEnd, "::timestamptz");
      if (input.computePrice !== undefined) asignar("computePrice", input.computePrice);
      if (input.fixedPrice !== undefined) asignar("fixedPrice", input.fixedPrice, "::numeric");
      if (input.percentPrice !== undefined) asignar("percentPrice", input.percentPrice, "::numeric");
      if (input.base !== undefined) asignar("base", input.base);
      if (input.basePriceListId !== undefined) asignar("basePriceListId", input.basePriceListId, "::uuid");
      if (input.priceDiscount !== undefined) asignar("priceDiscount", input.priceDiscount, "::numeric");
      if (input.priceSurcharge !== undefined) asignar("priceSurcharge", input.priceSurcharge, "::numeric");
      if (input.priceRound !== undefined) asignar("priceRound", input.priceRound, "::numeric");
      if (input.priceMinMargin !== undefined) asignar("priceMinMargin", input.priceMinMargin, "::numeric");
      if (input.priceMaxMargin !== undefined) asignar("priceMaxMargin", input.priceMaxMargin, "::numeric");
      if (input.sequence !== undefined) asignar("sequence", input.sequence, "::int");
      if (input.notes !== undefined) asignar("notes", input.notes);

      asignar("updatedBy", ctx.user?.id ?? null, "::uuid");

      params.push(input.id);
      await tx.$queryRawUnsafe(`UPDATE "ServicePriceRule" SET ${sets.join(", ")} WHERE id = $${idx}`, ...params);

      return { id: input.id };
    });
  }),

  setRuleActive: writerProc.input(priceRuleSetActiveInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      await assertReglaDelTenant(tx, input.id, tenant.organizationId);

      await tx.$queryRawUnsafe(
        `UPDATE "ServicePriceRule" SET active = $1, "updatedAt" = now() WHERE id = $2`,
        input.active,
        input.id,
      );

      return { id: input.id, active: input.active };
    });
  }),

  deleteRule: writerProc.input(getInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      await assertReglaDelTenant(tx, input.id, tenant.organizationId);
      await tx.$queryRawUnsafe(`DELETE FROM "ServicePriceRule" WHERE id = $1`, input.id);
      return { id: input.id };
    });
  }),

  /**
   * Probador de reglas: qué precio saldría para un código en una lista, sin
   * pasar por una cuenta ni tocar la factura.
   */
  simularPrecio: readerProc.input(priceRuleSimularInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      await assertListaDelTenant(tx, input.priceListId, tenant.organizationId);

      return resolverPrecioEnLista(tx, {
        organizationId: tenant.organizationId,
        priceListId: input.priceListId,
        code: input.code,
        cantidad: input.cantidad,
        fecha: input.fecha ? new Date(input.fecha) : undefined,
      });
    });
  }),
});
