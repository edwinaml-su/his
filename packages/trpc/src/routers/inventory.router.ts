/**
 * §19 Inventory — router skeleton (Wave 8 / Phase 2 entry).
 *
 * Cobertura mínima:
 *   - StockItem catalog (global + tenant-private).
 *   - StockLot por establishment con expiry.
 *   - StockMovement (IN, OUT, TRANSFER, ADJUST) inmutable.
 *
 * Lógica FEFO (First Expired First Out), reservas, transacción
 * atómica de descuento de stock y disparadores de reorden viven en
 * iteraciones siguientes. Aquí se hace el create directo del movimiento;
 * la actualización del `quantityOnHand` del lote se delega a triggers
 * de base de datos o a un servicio dedicado.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  stockItemCreateInput,
  stockItemListInput,
  stockLotCreateInput,
  stockLotListInput,
  stockMovementCreateInput,
  stockMovementListInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const inventoryRouter = router({
  item: router({
    /**
     * Lista items: catálogo global + tenant-private.
     * AND-compose para evitar el bug Wave 6 (OR sobreescrito por search).
     */
    list: tenantProcedure
      .input(stockItemListInput)
      .query(async ({ ctx, input }) => {
        const filters: object[] = [
          {
            OR: [
              { organizationId: null },
              { organizationId: ctx.tenant.organizationId },
            ],
          },
        ];
        if (input.activeOnly) filters.push({ active: true });
        if (input.category) filters.push({ category: input.category });
        if (input.search) {
          filters.push({
            OR: [
              { sku: { contains: input.search, mode: "insensitive" as const } },
              { name: { contains: input.search, mode: "insensitive" as const } },
            ],
          });
        }
        return ctx.prisma.stockItem.findMany({
          where: { AND: filters },
          orderBy: { name: "asc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(stockItemCreateInput)
      .mutation(async ({ ctx, input }) => {
        const orgId =
          input.organizationId === null
            ? null
            : (input.organizationId ?? ctx.tenant.organizationId);
        return ctx.prisma.stockItem.create({
          data: {
            organizationId: orgId,
            sku: input.sku,
            name: input.name,
            description: input.description ?? null,
            unitOfMeasure: input.unitOfMeasure,
            category: input.category ?? null,
            trackLots: input.trackLots,
            reorderLevel: input.reorderLevel ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),
  }),

  lot: router({
    list: tenantProcedure
      .input(stockLotListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.stockLot.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.itemId && { itemId: input.itemId }),
            ...(input.establishmentId && { establishmentId: input.establishmentId }),
            ...(input.activeOnly && { active: true }),
            ...(input.expiringBefore && {
              expiryDate: { not: null, lte: input.expiringBefore },
            }),
          },
          include: {
            item: { select: { id: true, sku: true, name: true, unitOfMeasure: true } },
          },
          orderBy: [{ expiryDate: "asc" }, { lotNumber: "asc" }],
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(stockLotCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Verifica que establishment sea del tenant.
        const est = await ctx.prisma.establishment.findFirst({
          where: {
            id: input.establishmentId,
            organizationId: ctx.tenant.organizationId,
          },
          select: { id: true },
        });
        if (!est) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Establecimiento no existe en la organización.",
          });
        }
        // Item visible (global o tenant).
        const item = await ctx.prisma.stockItem.findFirst({
          where: {
            id: input.itemId,
            OR: [
              { organizationId: null },
              { organizationId: ctx.tenant.organizationId },
            ],
          },
          select: { id: true },
        });
        if (!item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Item de stock no visible para el tenant.",
          });
        }
        return ctx.prisma.stockLot.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            establishmentId: input.establishmentId,
            itemId: input.itemId,
            lotNumber: input.lotNumber,
            expiryDate: input.expiryDate ?? null,
            quantityOnHand: input.quantityOnHand,
            costPerUnit: input.costPerUnit ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),
  }),

  movement: router({
    list: tenantProcedure
      .input(stockMovementListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.stockMovement.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.itemId && { itemId: input.itemId }),
            ...(input.lotId && { lotId: input.lotId }),
            ...(input.establishmentId && { establishmentId: input.establishmentId }),
            ...(input.type && { type: input.type }),
            ...((input.fromDate || input.toDate) && {
              performedAt: {
                ...(input.fromDate && { gte: input.fromDate }),
                ...(input.toDate && { lte: input.toDate }),
              },
            }),
          },
          include: {
            item: { select: { id: true, sku: true, name: true } },
            lot: { select: { id: true, lotNumber: true, expiryDate: true } },
          },
          orderBy: { performedAt: "desc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(stockMovementCreateInput)
      .mutation(async ({ ctx, input }) => {
        const est = await ctx.prisma.establishment.findFirst({
          where: {
            id: input.establishmentId,
            organizationId: ctx.tenant.organizationId,
          },
          select: { id: true },
        });
        if (!est) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Establecimiento no existe en la organización.",
          });
        }
        if (input.lotId) {
          const lot = await ctx.prisma.stockLot.findFirst({
            where: {
              id: input.lotId,
              organizationId: ctx.tenant.organizationId,
              itemId: input.itemId,
            },
            select: { id: true },
          });
          if (!lot) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Lote no pertenece al item/tenant.",
            });
          }
        }
        return ctx.prisma.stockMovement.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            establishmentId: input.establishmentId,
            itemId: input.itemId,
            lotId: input.lotId ?? null,
            type: input.type,
            quantity: input.quantity,
            reason: input.reason ?? null,
            referenceCode: input.referenceCode ?? null,
            performedById: ctx.user.id,
          },
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.stockMovement.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),
  }),
});
