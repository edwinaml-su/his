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
  configurarThresholdInput,
  listAlertasInput,
  type AlertaTipo,
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

  // ---------------------------------------------------------------------------
  // GS1 Threshold management (SQL 83)
  // ---------------------------------------------------------------------------
  gs1: router({
    /**
     * Upsert threshold para un par GTIN+GLN.
     * Requiere rol ADMIN o INVENTORY_MANAGER (RLS lo enforce en BD).
     */
    configurarThreshold: tenantProcedure
      .input(configurarThresholdInput)
      .mutation(async ({ ctx, input }) => {
        // Verificar que el GTIN existe
        const gtinRow = await ctx.prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM ece.gs1_gtin WHERE id = ${input.gtinId}::uuid LIMIT 1
        `;
        if (gtinRow.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "GTIN no encontrado." });
        }
        // Verificar que el GLN existe
        const glnRow = await ctx.prisma.$queryRaw<{ codigo: string }[]>`
          SELECT codigo FROM ece.gs1_gln WHERE codigo = ${input.ubicacionGln} LIMIT 1
        `;
        if (glnRow.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "GLN no encontrado." });
        }

        await ctx.prisma.$executeRaw`
          INSERT INTO ece.inventory_threshold
            (gtin_id, ubicacion_gln, organization_id, stock_minimo, stock_critico,
             reorder_point, dias_caducidad_alerta, configurado_por)
          VALUES (
            ${input.gtinId}::uuid,
            ${input.ubicacionGln},
            ${ctx.tenant.organizationId}::uuid,
            ${input.stockMinimo},
            ${input.stockCritico},
            ${input.reorderPoint},
            ${input.diasCaducidadAlerta},
            ${ctx.user.id}::uuid
          )
          ON CONFLICT (gtin_id, ubicacion_gln) DO UPDATE SET
            stock_minimo          = EXCLUDED.stock_minimo,
            stock_critico         = EXCLUDED.stock_critico,
            reorder_point         = EXCLUDED.reorder_point,
            dias_caducidad_alerta = EXCLUDED.dias_caducidad_alerta,
            configurado_por       = EXCLUDED.configurado_por
        `;

        return { ok: true };
      }),

    /**
     * Lista alertas activas cruzando inventory_threshold con StockLot.
     *
     * Estrategia de join:
     *   ece.inventory_threshold.gtin_id → ece.gs1_gtin.id
     *   ece.gs1_gtin.codigo             → StockItem.sku  (convención: SKU = GTIN código)
     *   StockItem.id                    → StockLot.itemId
     *   ece.inventory_threshold.ubicacion_gln → mapeado a Establishment via slug/external_id
     *     (fallback: agrupa todos los lotes del item por org si no hay mapa directo)
     *
     * Retorna: stock_bajo | stock_critico | proximo_vencer | vencido
     */
    listAlertas: tenantProcedure
      .input(listAlertasInput)
      .query(async ({ ctx, input }) => {
        // Cargar thresholds del org con filtros opcionales.
        // Prisma $queryRaw tagged template: construimos la query base y añadimos
        // fragmentos condicionales como parámetros posicionales seguros.
        type ThresholdRow = {
          gtin_id: string;
          ubicacion_gln: string;
          stock_minimo: number;
          stock_critico: number;
          reorder_point: number;
          dias_caducidad_alerta: number;
          gtin_codigo: string;
          gtin_descripcion: string;
          gln_descripcion: string;
        };

        // Filtramos en JS post-fetch para evitar SQL dinámico con fragmentos no
        // soportados por Prisma tagged template. El volumen de thresholds por org
        // es acotado (< 10k filas típico) — aceptable.
        const allThresholds = await ctx.prisma.$queryRaw<ThresholdRow[]>`
          SELECT
            t.gtin_id::text,
            t.ubicacion_gln,
            t.stock_minimo,
            t.stock_critico,
            t.reorder_point,
            t.dias_caducidad_alerta,
            g.codigo        AS gtin_codigo,
            g.descripcion   AS gtin_descripcion,
            l.descripcion   AS gln_descripcion
          FROM ece.inventory_threshold t
          JOIN ece.gs1_gtin g ON g.id = t.gtin_id
          JOIN ece.gs1_gln  l ON l.codigo = t.ubicacion_gln
          WHERE t.organization_id = ${ctx.tenant.organizationId}::uuid
          LIMIT ${input.limit}
        `;

        const thresholds = allThresholds.filter((t) => {
          if (input.gtinId && t.gtin_id !== input.gtinId) return false;
          if (input.ubicacionGln && t.ubicacion_gln !== input.ubicacionGln) return false;
          return true;
        });

        if (thresholds.length === 0) return [];

        // Para cada threshold: calcular stock actual y lotes vencidos/próximos
        const alertas: {
          tipo: AlertaTipo;
          gtinId: string;
          gtinCodigo: string;
          gtinDescripcion: string;
          ubicacionGln: string;
          glnDescripcion: string;
          stockActual: number;
          stockMinimo: number;
          stockCritico: number;
          reorderPoint: number;
          loteId?: string;
          loteNumero?: string;
          expiryDate?: Date;
          diasRestantes?: number;
        }[] = [];

        const today = new Date();

        for (const th of thresholds) {
          // Buscar StockItem cuyo SKU coincida con el código GTIN
          const items = await ctx.prisma.stockItem.findMany({
            where: {
              sku: th.gtin_codigo.trim(),
              OR: [
                { organizationId: null },
                { organizationId: ctx.tenant.organizationId },
              ],
            },
            select: { id: true },
          });

          if (items.length === 0) continue;

          const itemIds = items.map((i) => i.id);

          // Stock total activo en org para este GTIN
          const lots = await ctx.prisma.stockLot.findMany({
            where: {
              organizationId: ctx.tenant.organizationId,
              itemId: { in: itemIds },
              active: true,
            },
            select: {
              id: true,
              lotNumber: true,
              quantityOnHand: true,
              expiryDate: true,
            },
          });

          const stockTotal = lots.reduce(
            (acc, l) => acc + Number(l.quantityOnHand),
            0,
          );

          const tiposFiltro = input.tipos;

          const emitirSi = (tipo: AlertaTipo) =>
            !tiposFiltro || tiposFiltro.includes(tipo);

          // Alertas de nivel de stock
          if (stockTotal <= th.stock_critico && emitirSi("stock_critico")) {
            alertas.push({
              tipo: "stock_critico",
              gtinId: th.gtin_id,
              gtinCodigo: th.gtin_codigo,
              gtinDescripcion: th.gtin_descripcion,
              ubicacionGln: th.ubicacion_gln,
              glnDescripcion: th.gln_descripcion,
              stockActual: stockTotal,
              stockMinimo: th.stock_minimo,
              stockCritico: th.stock_critico,
              reorderPoint: th.reorder_point,
            });
          } else if (stockTotal <= th.stock_minimo && emitirSi("stock_bajo")) {
            alertas.push({
              tipo: "stock_bajo",
              gtinId: th.gtin_id,
              gtinCodigo: th.gtin_codigo,
              gtinDescripcion: th.gtin_descripcion,
              ubicacionGln: th.ubicacion_gln,
              glnDescripcion: th.gln_descripcion,
              stockActual: stockTotal,
              stockMinimo: th.stock_minimo,
              stockCritico: th.stock_critico,
              reorderPoint: th.reorder_point,
            });
          }

          // Alertas de caducidad por lote
          for (const lot of lots) {
            if (!lot.expiryDate || Number(lot.quantityOnHand) <= 0) continue;

            const expiry = new Date(lot.expiryDate);
            const msRestantes = expiry.getTime() - today.getTime();
            const diasRestantes = Math.ceil(msRestantes / (1000 * 60 * 60 * 24));

            if (diasRestantes < 0 && emitirSi("vencido")) {
              alertas.push({
                tipo: "vencido",
                gtinId: th.gtin_id,
                gtinCodigo: th.gtin_codigo,
                gtinDescripcion: th.gtin_descripcion,
                ubicacionGln: th.ubicacion_gln,
                glnDescripcion: th.gln_descripcion,
                stockActual: stockTotal,
                stockMinimo: th.stock_minimo,
                stockCritico: th.stock_critico,
                reorderPoint: th.reorder_point,
                loteId: lot.id,
                loteNumero: lot.lotNumber,
                expiryDate: expiry,
                diasRestantes,
              });
            } else if (
              diasRestantes >= 0 &&
              diasRestantes <= th.dias_caducidad_alerta &&
              emitirSi("proximo_vencer")
            ) {
              alertas.push({
                tipo: "proximo_vencer",
                gtinId: th.gtin_id,
                gtinCodigo: th.gtin_codigo,
                gtinDescripcion: th.gtin_descripcion,
                ubicacionGln: th.ubicacion_gln,
                glnDescripcion: th.gln_descripcion,
                stockActual: stockTotal,
                stockMinimo: th.stock_minimo,
                stockCritico: th.stock_critico,
                reorderPoint: th.reorder_point,
                loteId: lot.id,
                loteNumero: lot.lotNumber,
                expiryDate: expiry,
                diasRestantes,
              });
            }
          }
        }

        // Ordenar: vencido > stock_critico > proximo_vencer > stock_bajo
        const PRIORIDAD = {
          vencido: 0,
          stock_critico: 1,
          proximo_vencer: 2,
          stock_bajo: 3,
        } as const satisfies Record<AlertaTipo, number>;
        alertas.sort((a, b) => PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo]);

        return alertas;
      }),
  }),
});

// ---------------------------------------------------------------------------
// Internal helpers — FEFO
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
