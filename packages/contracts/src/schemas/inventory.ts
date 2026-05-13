/**
 * §19 Inventory — schemas de input (Wave 8 / Phase 2 entry).
 *
 * Skeleton mínimo. Reglas FEFO (First Expired First Out), reservas y
 * disparadores de reorden viven en el router. Aquí solo se valida el contrato.
 */
import { z } from "zod";

const STOCK_MOVEMENT_TYPE = ["IN", "OUT", "TRANSFER", "ADJUST"] as const;

export const stockMovementTypeEnum = z.enum(STOCK_MOVEMENT_TYPE);
export type StockMovementTypeType = z.infer<typeof stockMovementTypeEnum>;

// ---------------------------------------------------------------------------
// StockItem (catálogo)
// ---------------------------------------------------------------------------

export const stockItemCreateInput = z.object({
  /** null = catálogo global; sólo service_role debería poder enviarlo. */
  organizationId: z.string().uuid().nullable().optional(),
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(400).optional(),
  unitOfMeasure: z.string().trim().min(1).max(20),
  category: z.string().trim().max(80).optional(),
  trackLots: z.boolean().default(true),
  reorderLevel: z.number().nonnegative().optional(),
});

export const stockItemListInput = z.object({
  activeOnly: z.boolean().default(true),
  category: z.string().trim().max(80).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// StockLot
// ---------------------------------------------------------------------------

export const stockLotCreateInput = z.object({
  establishmentId: z.string().uuid(),
  itemId: z.string().uuid(),
  lotNumber: z.string().trim().min(1).max(80),
  expiryDate: z.coerce.date().optional(),
  quantityOnHand: z.number().nonnegative().default(0),
  costPerUnit: z.number().nonnegative().optional(),
});

export const stockLotListInput = z.object({
  itemId: z.string().uuid().optional(),
  establishmentId: z.string().uuid().optional(),
  activeOnly: z.boolean().default(true),
  expiringBefore: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// StockMovement
// ---------------------------------------------------------------------------

export const stockMovementCreateInput = z
  .object({
    establishmentId: z.string().uuid(),
    itemId: z.string().uuid(),
    lotId: z.string().uuid().optional(),
    type: stockMovementTypeEnum,
    quantity: z.number().positive(),
    reason: z.string().trim().max(200).optional(),
    referenceCode: z.string().trim().max(80).optional(),
  })
  .refine((d) => d.type !== "TRANSFER" || d.referenceCode !== undefined, {
    message: "TRANSFER requiere referenceCode con destino.",
    path: ["referenceCode"],
  });

export const stockMovementListInput = z.object({
  itemId: z.string().uuid().optional(),
  lotId: z.string().uuid().optional(),
  establishmentId: z.string().uuid().optional(),
  type: stockMovementTypeEnum.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export type StockItemCreateInput = z.infer<typeof stockItemCreateInput>;
export type StockLotCreateInput = z.infer<typeof stockLotCreateInput>;
export type StockMovementCreateInput = z.infer<typeof stockMovementCreateInput>;
