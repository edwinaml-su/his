/**
 * §19 Inventory — router (Beta.10 hardening layer 1).
 *
 * Rules implemented:
 *   1. Movements are append-only (no UPDATE/DELETE exposed).
 *   2. FEFO enforcement on OUT: the consumed lot must have the earliest
 *      expiryDate among available lots for the same item+establishment.
 *   3. Expiry alerts: `inventory.expiringLots` endpoint.
 *   4. Negative stock prevention: DB CHECK + router guard for OUT movements.
 *   5. Transfer atomicity: TRANSFER creates a paired OUT+IN in $transaction
 *      sharing a `transferGroupId`.
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
  stockTransferInput,
  expiringLotsInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";
import { randomUUID } from "crypto";

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

  /**
   * Expiry alerts — §19 rule 3.
   * Returns lots with expiryDate < now() + daysAhead and quantityOnHand > 0.
   */
  expiringLots: tenantProcedure
    .input(expiringLotsInput)
    .query(async ({ ctx, input }) => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + input.daysAhead);

      return ctx.prisma.stockLot.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          active: true,
          expiryDate: { not: null, lte: cutoff },
          quantityOnHand: { gt: 0 },
          ...(input.establishmentId && { establishmentId: input.establishmentId }),
          ...(input.itemId && { itemId: input.itemId }),
        },
        include: {
          item: { select: { id: true, sku: true, name: true, unitOfMeasure: true } },
        },
        orderBy: { expiryDate: "asc" },
        take: input.limit,
      });
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

    /**
     * Create a single movement (IN / ADJUST). For OUT use movement.out.
     * For TRANSFER use movement.transfer (atomic pair).
     * Movements are append-only: no update/delete endpoints exist.
     */
    create: tenantProcedure
      .input(stockMovementCreateInput)
      .mutation(async ({ ctx, input }) => {
        // TRANSFER must go through movement.transfer for atomicity.
        if (input.type === "TRANSFER") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Use movement.transfer para movimientos de tipo TRANSFER.",
          });
        }

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

        if (input.type === "OUT" && input.lotId) {
          await assertFefoCompliance(ctx, input.itemId, input.establishmentId, input.lotId);
        }

        if (input.lotId) {
          const lot = await ctx.prisma.stockLot.findFirst({
            where: {
              id: input.lotId,
              organizationId: ctx.tenant.organizationId,
              itemId: input.itemId,
            },
            select: { id: true, quantityOnHand: true },
          });
          if (!lot) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Lote no pertenece al item/tenant.",
            });
          }
          // Guard against negative stock at the application layer (DB trigger is the safety net).
          if (input.type === "OUT" && Number(lot.quantityOnHand) < input.quantity) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Stock insuficiente en el lote.",
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

    /**
     * OUT movement with FEFO enforcement — §19 rule 2.
     * Uses movement.create internally after FEFO check.
     */
    out: tenantProcedure
      .input(stockMovementCreateInput)
      .mutation(async ({ ctx, input }) => {
        if (input.type !== "OUT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Este endpoint solo acepta movimientos de tipo OUT.",
          });
        }

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
          await assertFefoCompliance(ctx, input.itemId, input.establishmentId, input.lotId);

          const lot = await ctx.prisma.stockLot.findFirst({
            where: {
              id: input.lotId,
              organizationId: ctx.tenant.organizationId,
              itemId: input.itemId,
            },
            select: { id: true, quantityOnHand: true },
          });
          if (!lot) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Lote no pertenece al item/tenant.",
            });
          }
          if (Number(lot.quantityOnHand) < input.quantity) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Stock insuficiente en el lote.",
            });
          }
        }

        return ctx.prisma.stockMovement.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            establishmentId: input.establishmentId,
            itemId: input.itemId,
            lotId: input.lotId ?? null,
            type: "OUT",
            quantity: input.quantity,
            reason: input.reason ?? null,
            referenceCode: input.referenceCode ?? null,
            performedById: ctx.user.id,
          },
        });
      }),

    /**
     * Transfer atomicity — §19 rule 5.
     * Creates paired OUT (src) + IN (dst) movements in a single $transaction
     * sharing a transferGroupId UUID.
     */
    transfer: tenantProcedure
      .input(stockTransferInput)
      .mutation(async ({ ctx, input }) => {
        // Validate both establishments belong to tenant.
        const [srcEst, dstEst] = await Promise.all([
          ctx.prisma.establishment.findFirst({
            where: { id: input.srcEstablishmentId, organizationId: ctx.tenant.organizationId },
            select: { id: true },
          }),
          ctx.prisma.establishment.findFirst({
            where: { id: input.dstEstablishmentId, organizationId: ctx.tenant.organizationId },
            select: { id: true },
          }),
        ]);
        if (!srcEst) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Establecimiento origen no existe." });
        }
        if (!dstEst) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Establecimiento destino no existe." });
        }

        // FEFO check on source lot.
        await assertFefoCompliance(
          ctx,
          input.itemId,
          input.srcEstablishmentId,
          input.srcLotId,
        );

        // Stock sufficiency check on source lot.
        const srcLot = await ctx.prisma.stockLot.findFirst({
          where: {
            id: input.srcLotId,
            organizationId: ctx.tenant.organizationId,
            itemId: input.itemId,
          },
          select: { id: true, quantityOnHand: true },
        });
        if (!srcLot) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Lote origen no pertenece al item/tenant." });
        }
        if (Number(srcLot.quantityOnHand) < input.quantity) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Stock insuficiente en el lote origen.",
          });
        }

        const transferGroupId = randomUUID();
        const baseData = {
          organizationId: ctx.tenant.organizationId,
          itemId: input.itemId,
          quantity: input.quantity,
          reason: input.reason ?? null,
          referenceCode: input.referenceCode,
          transferGroupId,
          performedById: ctx.user.id,
        };

        const [outMovement, inMovement] = await ctx.prisma.$transaction([
          ctx.prisma.stockMovement.create({
            data: {
              ...baseData,
              establishmentId: input.srcEstablishmentId,
              lotId: input.srcLotId,
              type: "TRANSFER",
            },
          }),
          ctx.prisma.stockMovement.create({
            data: {
              ...baseData,
              establishmentId: input.dstEstablishmentId,
              lotId: input.dstLotId ?? null,
              type: "TRANSFER",
            },
          }),
        ]);

        return { transferGroupId, outMovementId: outMovement.id, inMovementId: inMovement.id };
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RouterCtx = Parameters<Parameters<typeof tenantProcedure.query>[0]>[0]["ctx"];

/**
 * FEFO validation — §19 rule 2.
 *
 * For a given itemId+establishmentId, finds the lot with the earliest
 * expiryDate that still has stock. If that lot is NOT the one being consumed,
 * raises PRECONDITION_FAILED with the required "FEFO violation: lot X expires earlier" message.
 *
 * Lots without an expiryDate are treated as non-expiring and are always
 * considered after lots that do have expiry dates.
 */
async function assertFefoCompliance(
  ctx: RouterCtx,
  itemId: string,
  establishmentId: string,
  consumedLotId: string,
): Promise<void> {
  // Find the lot with the earliest expiry that still has available stock.
  const earliestLot = await ctx.prisma.stockLot.findFirst({
    where: {
      organizationId: ctx.tenant.organizationId,
      itemId,
      establishmentId,
      active: true,
      quantityOnHand: { gt: 0 },
      // Only lots that have an expiryDate can cause a FEFO violation.
      expiryDate: { not: null },
    },
    orderBy: { expiryDate: "asc" },
    select: { id: true, lotNumber: true, expiryDate: true },
  });

  // If the earliest-expiring lot is not the one being consumed, it's a violation.
  if (earliestLot && earliestLot.id !== consumedLotId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `FEFO violation: lot ${earliestLot.lotNumber} expires earlier`,
    });
  }
}
