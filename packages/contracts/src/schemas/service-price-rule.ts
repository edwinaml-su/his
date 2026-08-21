/**
 * CC-0021 — Reglas de lista de precios y categorías de servicio.
 *
 * Réplica del modelo `product.pricelist.item` de Odoo 18 (ver docs/CC/0021 y
 * sql/204). El motor de resolución vive en packages/trpc/src/lib/price-resolver.ts;
 * el CRUD en packages/trpc/src/routers/service-price-list.router.ts.
 */
import { z } from "zod";

export const APPLIED_ON = ["item", "category", "global"] as const;
export const COMPUTE_PRICE = ["fixed", "percentage", "formula"] as const;
export const PRICE_BASE = ["list_price", "standard_cost", "pricelist"] as const;

export const appliedOnEnum = z.enum(APPLIED_ON);
export const computePriceEnum = z.enum(COMPUTE_PRICE);
export const priceBaseEnum = z.enum(PRICE_BASE);

// ---------------------------------------------------------------------------
// Categorías de servicio (product.category de Odoo)
// ---------------------------------------------------------------------------

const categoryCode = z.string().trim().min(1, "Código requerido").max(40);
const categoryNombre = z.string().trim().min(1, "Nombre requerido").max(120);

export const serviceCategoryListInput = z
  .object({
    activeOnly: z.boolean().optional(),
  })
  .optional();

export const serviceCategoryCreateInput = z.object({
  code: categoryCode,
  nombre: categoryNombre,
  parentId: z.string().uuid().optional(),
});

export const serviceCategoryUpdateInput = z.object({
  id: z.string().uuid(),
  code: categoryCode.optional(),
  nombre: categoryNombre.optional(),
  parentId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Reglas de precio (product.pricelist.item de Odoo)
// ---------------------------------------------------------------------------

/**
 * Campos comunes de una regla. Las combinaciones inválidas las rechaza
 * `refinarRegla` (y, en última instancia, los CHECK de sql/204).
 */
const reglaBase = {
  appliedOn: appliedOnEnum.default("item"),
  itemCode: z.string().trim().max(60).optional(),
  categoryId: z.string().uuid().optional(),
  minQuantity: z.number().min(0).default(0),
  dateStart: z.string().datetime().optional(),
  dateEnd: z.string().datetime().optional(),
  computePrice: computePriceEnum.default("fixed"),
  fixedPrice: z.number().min(0).optional(),
  percentPrice: z.number().min(-100).max(100).default(0),
  base: priceBaseEnum.default("list_price"),
  basePriceListId: z.string().uuid().optional(),
  /** Negativo = markup (así lo guarda Odoo: -6.38 = +6.38% sobre el base). */
  priceDiscount: z.number().min(-1000).max(100).default(0),
  priceSurcharge: z.number().default(0),
  priceRound: z.number().min(0).default(0),
  priceMinMargin: z.number().min(0).default(0),
  priceMaxMargin: z.number().min(0).default(0),
  sequence: z.number().int().default(0),
  notes: z.string().trim().max(300).optional(),
};

type ReglaShape = {
  appliedOn?: (typeof APPLIED_ON)[number];
  itemCode?: string | null;
  categoryId?: string | null;
  computePrice?: (typeof COMPUTE_PRICE)[number];
  fixedPrice?: number | null;
  base?: (typeof PRICE_BASE)[number];
  basePriceListId?: string | null;
  dateStart?: string | null;
  dateEnd?: string | null;
};

/**
 * Coherencia de la regla — mismas condiciones que los CHECK de sql/204, para
 * dar el error en el formulario en vez de en la BD. Solo valida los campos
 * presentes: en el update parcial, lo ausente no se juzga.
 */
export function refinarRegla(data: ReglaShape, ctx: z.RefinementCtx): void {
  if (data.appliedOn === "item" && !data.itemCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["itemCode"], message: "Una regla de ítem requiere el código del tarifario." });
  }
  if (data.appliedOn === "category" && !data.categoryId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["categoryId"], message: "Una regla de categoría requiere la categoría." });
  }
  if (data.appliedOn === "global" && (data.itemCode || data.categoryId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["appliedOn"], message: "Una regla global no lleva código ni categoría." });
  }
  if (data.appliedOn === "item" && data.categoryId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["categoryId"], message: "Una regla de ítem no lleva categoría." });
  }
  if (data.appliedOn === "category" && data.itemCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["itemCode"], message: "Una regla de categoría no lleva código." });
  }
  if (data.computePrice === "fixed" && data.fixedPrice == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fixedPrice"], message: "Un precio fijo requiere el monto." });
  }
  if (data.base === "pricelist" && !data.basePriceListId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["basePriceListId"], message: "La cascada requiere la lista base." });
  }
  if (data.base !== "pricelist" && data.basePriceListId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["basePriceListId"], message: "Solo la base «otra lista» admite lista base." });
  }
  if (data.dateStart && data.dateEnd && data.dateEnd < data.dateStart) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateEnd"], message: "La vigencia termina antes de empezar." });
  }
}

export const priceRuleListInput = z.object({
  priceListId: z.string().uuid(),
  activeOnly: z.boolean().optional(),
});

export const priceRuleCreateInput = z
  .object({ priceListId: z.string().uuid(), ...reglaBase })
  .superRefine(refinarRegla);

export const priceRuleUpdateInput = z
  .object({
    id: z.string().uuid(),
    appliedOn: appliedOnEnum.optional(),
    itemCode: z.string().trim().max(60).nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    minQuantity: z.number().min(0).optional(),
    dateStart: z.string().datetime().nullable().optional(),
    dateEnd: z.string().datetime().nullable().optional(),
    computePrice: computePriceEnum.optional(),
    fixedPrice: z.number().min(0).nullable().optional(),
    percentPrice: z.number().min(-100).max(100).optional(),
    base: priceBaseEnum.optional(),
    basePriceListId: z.string().uuid().nullable().optional(),
    priceDiscount: z.number().min(-1000).max(100).optional(),
    priceSurcharge: z.number().optional(),
    priceRound: z.number().min(0).optional(),
    priceMinMargin: z.number().min(0).optional(),
    priceMaxMargin: z.number().min(0).optional(),
    sequence: z.number().int().optional(),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .superRefine(refinarRegla);

export const priceRuleSetActiveInput = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

/** Simulación «¿qué precio saldría?» sin tocar la factura (probador de reglas). */
export const priceRuleSimularInput = z.object({
  priceListId: z.string().uuid(),
  code: z.string().trim().min(1).max(60),
  cantidad: z.number().min(0).default(1),
  fecha: z.string().datetime().optional(),
});

export type ServiceCategoryCreateInput = z.infer<typeof serviceCategoryCreateInput>;
export type ServiceCategoryUpdateInput = z.infer<typeof serviceCategoryUpdateInput>;
export type PriceRuleCreateInput = z.infer<typeof priceRuleCreateInput>;
export type PriceRuleUpdateInput = z.infer<typeof priceRuleUpdateInput>;
export type PriceRuleSimularInput = z.infer<typeof priceRuleSimularInput>;
