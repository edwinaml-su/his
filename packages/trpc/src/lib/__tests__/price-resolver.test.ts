/**
 * CC-0015 / CC-0021 — Tests del resolver de precios por cuenta (price-resolver.ts).
 *
 * El mock de `$queryRawUnsafe` despacha por el SQL recibido (reglas vs ítem
 * plano) y reproduce el filtrado por cantidad y vigencia que hace la consulta
 * real, de modo que los casos de tramos y vigencia ejerciten el motor.
 * El ORDEN de las reglas candidatas vive en el ORDER BY del SQL y se verifica
 * aparte con packages/database/sql/__tests__/204_motor_precios_smoke.sql.
 */
import { describe, it, expect, vi } from "vitest";
import { resolverPrecio, resolverPrecioEnLista, resolverPriceListIdDeCuenta, calcularPrecioRegla } from "../price-resolver";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const CUENTA_ID = "00000000-0000-0000-0000-000000000002";
const TIPO_CUENTA_ID = "00000000-0000-0000-0000-000000000003";
const PRICE_LIST_ID = "00000000-0000-0000-0000-000000000004";
const BASE_LIST_ID = "00000000-0000-0000-0000-000000000005";

type ItemFake = { unitPrice: string; estimatedCost?: string | null };
type ReglaFake = {
  id?: string;
  appliedOn?: "item" | "category" | "global";
  computePrice?: "fixed" | "percentage" | "formula";
  fixedPrice?: string | null;
  percentPrice?: string;
  base?: "list_price" | "standard_cost" | "pricelist";
  basePriceListId?: string | null;
  priceDiscount?: string;
  priceSurcharge?: string;
  priceRound?: string;
  priceMinMargin?: string;
  priceMaxMargin?: string;
  minQuantity?: number;
  dateStart?: Date | null;
  dateEnd?: Date | null;
};

function regla(r: ReglaFake) {
  return {
    id: r.id ?? "regla-1",
    appliedOn: r.appliedOn ?? "item",
    computePrice: r.computePrice ?? "fixed",
    fixedPrice: r.fixedPrice ?? null,
    percentPrice: r.percentPrice ?? "0",
    base: r.base ?? "list_price",
    basePriceListId: r.basePriceListId ?? null,
    priceDiscount: r.priceDiscount ?? "0",
    priceSurcharge: r.priceSurcharge ?? "0",
    priceRound: r.priceRound ?? "0",
    priceMinMargin: r.priceMinMargin ?? "0",
    priceMaxMargin: r.priceMaxMargin ?? "0",
    minQuantity: r.minQuantity ?? 0,
    dateStart: r.dateStart ?? null,
    dateEnd: r.dateEnd ?? null,
  };
}

function makeTx(opts: {
  patientAccount?: { tipoCuentaId: string | null } | null;
  tipoCuenta?: { priceListId: string | null } | null;
  /** Ítems del tarifario, indexados por `${priceListId}|${code}`. */
  items?: Record<string, ItemFake>;
  /** Reglas candidatas, indexadas por `${priceListId}|${code}`, ya en orden de prioridad. */
  reglas?: Record<string, ReglaFake[]>;
  labTestTenant?: { standardPrice: unknown } | null;
  labTestGlobal?: { standardPrice: unknown } | null;
  imagingAttrs?: { codigoTarifario: string | null } | null;
}) {
  const items = opts.items ?? {};
  const reglas = opts.reglas ?? {};

  const queryRawUnsafe = vi.fn(async (sql: string, ...args: unknown[]) => {
    const key = `${String(args[0])}|${String(args[1])}`;

    if (sql.includes('"ServicePriceRule"')) {
      const cantidad = Number(args[3]);
      const fecha = args[4] as Date;
      const candidatas = (reglas[key] ?? []).map(regla).filter(
        (r) =>
          r.minQuantity <= cantidad &&
          (!r.dateStart || r.dateStart <= fecha) &&
          (!r.dateEnd || r.dateEnd >= fecha),
      );
      return candidatas.slice(0, 1);
    }

    const item = items[key];
    return item ? [{ unitPrice: item.unitPrice, estimatedCost: item.estimatedCost ?? null }] : [];
  });

  const labTestFindFirst = vi
    .fn()
    .mockImplementation(async (args: { where: { organizationId: string | null } }) =>
      args.where.organizationId === null ? (opts.labTestGlobal ?? null) : (opts.labTestTenant ?? null),
    );

  return {
    $queryRawUnsafe: queryRawUnsafe,
    patientAccount: { findFirst: vi.fn().mockResolvedValue(opts.patientAccount ?? null) },
    tipoCuenta: { findFirst: vi.fn().mockResolvedValue(opts.tipoCuenta ?? null) },
    labTest: { findFirst: labTestFindFirst },
    imagingTestAttrs: { findUnique: vi.fn().mockResolvedValue(opts.imagingAttrs ?? null) },
  };
}

/** Cuenta con tipo de cuenta enlazado a PRICE_LIST_ID. */
const cuentaConLista = {
  patientAccount: { tipoCuentaId: TIPO_CUENTA_ID },
  tipoCuenta: { priceListId: PRICE_LIST_ID },
};

describe("resolverPriceListIdDeCuenta", () => {
  it("devuelve null si la cuenta no tiene tipoCuentaId", async () => {
    const tx = makeTx({ patientAccount: { tipoCuentaId: null } });
    expect(await resolverPriceListIdDeCuenta(tx as never, ORG_ID, CUENTA_ID)).toBeNull();
  });

  it("devuelve null si la cuenta no existe", async () => {
    const tx = makeTx({ patientAccount: null });
    expect(await resolverPriceListIdDeCuenta(tx as never, ORG_ID, CUENTA_ID)).toBeNull();
  });

  it("devuelve el priceListId del tipoCuenta de la cuenta", async () => {
    const tx = makeTx(cuentaConLista);
    expect(await resolverPriceListIdDeCuenta(tx as never, ORG_ID, CUENTA_ID)).toBe(PRICE_LIST_ID);
  });
});

// ---------------------------------------------------------------------------
// CC-0021 — fórmula de precio (semántica verificada contra Odoo 18)
// ---------------------------------------------------------------------------

describe("calcularPrecioRegla", () => {
  it("fixed devuelve el monto tal cual, ignorando el base", () => {
    expect(calcularPrecioRegla(regla({ computePrice: "fixed", fixedPrice: "6.45" }), 100)).toBe(6.45);
  });

  it("percentage descuenta el porcentaje del base", () => {
    expect(calcularPrecioRegla(regla({ computePrice: "percentage", percentPrice: "10" }), 50)).toBe(45);
  });

  it("formula con descuento negativo aplica markup — regla real INSUMOS (-6.38 → +6.38%)", () => {
    // Odoo guarda el markup como descuento negativo: price = base * 1.0638.
    expect(calcularPrecioRegla(regla({ computePrice: "formula", priceDiscount: "-6.38" }), 11.01)).toBe(11.71);
  });

  it("formula con márgenes mín y máx iguales fija base + margen — regla real DrSV IMAGENES (0.70)", () => {
    const r = regla({ computePrice: "formula", priceMinMargin: "0.7", priceMaxMargin: "0.7" });
    expect(calcularPrecioRegla(r, 28)).toBe(28.7);
    expect(calcularPrecioRegla(r, 140)).toBe(140.7);
  });

  it("el redondeo se aplica después del descuento y antes del recargo", () => {
    // base 100 − 10% = 90 → redondeo a múltiplo de 10 = 90 → +9.99 = 99.99
    const r = regla({ computePrice: "formula", priceDiscount: "10", priceRound: "10", priceSurcharge: "9.99" });
    expect(calcularPrecioRegla(r, 100)).toBe(99.99);
    // base 104 − 10% = 93.6 → redondeo a múltiplo de 10 = 90 → +9.99 = 99.99
    expect(calcularPrecioRegla(r, 104)).toBe(99.99);
  });

  it("el margen mínimo levanta el precio y el máximo lo techa", () => {
    const piso = regla({ computePrice: "formula", priceDiscount: "50", priceMinMargin: "5" });
    expect(calcularPrecioRegla(piso, 100)).toBe(105); // 50 < 100+5 → gana el piso

    const techo = regla({ computePrice: "formula", priceDiscount: "-100", priceMaxMargin: "10" });
    expect(calcularPrecioRegla(techo, 100)).toBe(110); // 200 > 100+10 → gana el techo
  });
});

// ---------------------------------------------------------------------------
// Cadena de resolución
// ---------------------------------------------------------------------------

describe("resolverPrecio", () => {
  it("resuelve por el ítem del tarifario cuando la lista lo tiene", async () => {
    const tx = makeTx({ ...cuentaConLista, items: { [`${PRICE_LIST_ID}|GLU`]: { unitPrice: "42.50" } } });

    expect(await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "GLU" })).toEqual({
      precio: 42.5,
      fuente: "lista",
      priceListId: PRICE_LIST_ID,
      reglaId: null,
    });
  });

  it("cae a LabTest.standardPrice (tenant) cuando no hay lista o el código no está en ella", async () => {
    const tx = makeTx({ patientAccount: { tipoCuentaId: null }, labTestTenant: { standardPrice: 15 } });

    expect(await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "GLU" })).toEqual({
      precio: 15,
      fuente: "estandar",
      priceListId: null,
      reglaId: null,
    });
  });

  it("cae a LabTest.standardPrice global cuando no hay override de tenant", async () => {
    const tx = makeTx({
      patientAccount: { tipoCuentaId: null },
      labTestTenant: null,
      labTestGlobal: { standardPrice: 9.99 },
    });

    expect(await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "GLU" })).toEqual({
      precio: 9.99,
      fuente: "estandar",
      priceListId: null,
      reglaId: null,
    });
  });

  it("devuelve fuente null cuando no hay lista ni standardPrice", async () => {
    const tx = makeTx({ patientAccount: { tipoCuentaId: null } });

    expect(await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "GLU" })).toEqual({
      precio: null,
      fuente: null,
      priceListId: null,
      reglaId: null,
    });
  });

  // -------------------------------------------------------------------------
  // CC-0021 — precedencia regla ↔ ítem plano
  // -------------------------------------------------------------------------

  it("una regla de nivel ítem gana al ítem plano del mismo código", async () => {
    const tx = makeTx({
      ...cuentaConLista,
      items: { [`${PRICE_LIST_ID}|GLU`]: { unitPrice: "42.50" } },
      reglas: { [`${PRICE_LIST_ID}|GLU`]: [{ id: "r-item", computePrice: "fixed", fixedPrice: "30.00" }] },
    });

    expect(await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "GLU" })).toEqual({
      precio: 30,
      fuente: "regla",
      priceListId: PRICE_LIST_ID,
      reglaId: "r-item",
    });
  });

  it("el ítem plano gana a una regla de categoría (es más específico)", async () => {
    const tx = makeTx({
      ...cuentaConLista,
      items: { [`${PRICE_LIST_ID}|RX01`]: { unitPrice: "28.00" } },
      reglas: {
        [`${PRICE_LIST_ID}|RX01`]: [
          { id: "r-cat", appliedOn: "category", computePrice: "formula", priceMinMargin: "0.7", priceMaxMargin: "0.7" },
        ],
      },
    });

    expect(await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "RX01" })).toEqual({
      precio: 28,
      fuente: "lista",
      priceListId: PRICE_LIST_ID,
      reglaId: null,
    });
  });

  it("una regla de categoría aplica cuando el código no está en la lista — caso DrSV IMAGENES", async () => {
    // La lista no tiene ítems; el precio de catálogo del estudio es 28.00 y la
    // regla de la categoría IMAGENES le suma un margen fijo de 0.70.
    const tx = makeTx({
      ...cuentaConLista,
      labTestTenant: { standardPrice: 28 },
      reglas: {
        [`${PRICE_LIST_ID}|RX01`]: [
          { id: "r-img", appliedOn: "category", computePrice: "formula", priceMinMargin: "0.7", priceMaxMargin: "0.7" },
        ],
      },
    });

    expect(await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "RX01" })).toEqual({
      precio: 28.7,
      fuente: "regla",
      priceListId: PRICE_LIST_ID,
      reglaId: "r-img",
    });
  });

  it("una regla de cantidad mínima no aplica por debajo del tramo", async () => {
    const conTramo = {
      ...cuentaConLista,
      items: { [`${PRICE_LIST_ID}|SUERO`]: { unitPrice: "2.73" } },
      reglas: {
        [`${PRICE_LIST_ID}|SUERO`]: [
          { id: "r-tramo", computePrice: "fixed", fixedPrice: "2.00", minQuantity: 10 },
        ],
      },
    };

    const sinTramo = await resolverPrecio(makeTx(conTramo) as never, {
      organizationId: ORG_ID,
      cuentaId: CUENTA_ID,
      code: "SUERO",
      cantidad: 1,
    });
    expect(sinTramo).toMatchObject({ precio: 2.73, fuente: "lista" });

    const enTramo = await resolverPrecio(makeTx(conTramo) as never, {
      organizationId: ORG_ID,
      cuentaId: CUENTA_ID,
      code: "SUERO",
      cantidad: 10,
    });
    expect(enTramo).toMatchObject({ precio: 2, fuente: "regla", reglaId: "r-tramo" });
  });

  it("una regla fuera de vigencia no aplica", async () => {
    const base = {
      ...cuentaConLista,
      items: { [`${PRICE_LIST_ID}|GLU`]: { unitPrice: "6.30" } },
      reglas: {
        [`${PRICE_LIST_ID}|GLU`]: [
          { id: "r-futura", computePrice: "fixed" as const, fixedPrice: "9.00", dateStart: new Date("2027-01-01") },
        ],
      },
    };

    const antes = await resolverPrecio(makeTx(base) as never, {
      organizationId: ORG_ID,
      cuentaId: CUENTA_ID,
      code: "GLU",
      fecha: new Date("2026-08-21"),
    });
    expect(antes).toMatchObject({ precio: 6.3, fuente: "lista" });

    const despues = await resolverPrecio(makeTx(base) as never, {
      organizationId: ORG_ID,
      cuentaId: CUENTA_ID,
      code: "GLU",
      fecha: new Date("2027-06-01"),
    });
    expect(despues).toMatchObject({ precio: 9, fuente: "regla", reglaId: "r-futura" });
  });

  it("base = 'pricelist' encadena a la lista base", async () => {
    const tx = makeTx({
      ...cuentaConLista,
      items: { [`${BASE_LIST_ID}|GLU`]: { unitPrice: "10.00" } },
      reglas: {
        [`${PRICE_LIST_ID}|GLU`]: [
          {
            id: "r-cascada",
            appliedOn: "global",
            computePrice: "formula",
            base: "pricelist",
            basePriceListId: BASE_LIST_ID,
            priceDiscount: "20",
          },
        ],
      },
    });

    expect(await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "GLU" })).toEqual({
      precio: 8,
      fuente: "regla",
      priceListId: PRICE_LIST_ID,
      reglaId: "r-cascada",
    });
  });

  it("base = 'standard_cost' usa el costo estimado del ítem", async () => {
    const tx = makeTx({
      ...cuentaConLista,
      items: { [`${PRICE_LIST_ID}|AGUJA`]: { unitPrice: "11.01", estimatedCost: "3.48" } },
      reglas: {
        [`${PRICE_LIST_ID}|AGUJA`]: [
          { id: "r-costo", computePrice: "formula", base: "standard_cost", priceDiscount: "-100" },
        ],
      },
    });

    // costo 3.48 con markup del 100% → 6.96
    expect(await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "AGUJA" })).toMatchObject({
      precio: 6.96,
      fuente: "regla",
    });
  });

  it("si la regla no puede calcular su base, cae al siguiente eslabón en vez de cobrar 0", async () => {
    const tx = makeTx({
      ...cuentaConLista,
      items: { [`${PRICE_LIST_ID}|AGUJA`]: { unitPrice: "11.01", estimatedCost: null } },
      reglas: {
        [`${PRICE_LIST_ID}|AGUJA`]: [
          { id: "r-sin-costo", computePrice: "formula", base: "standard_cost", priceDiscount: "-100" },
        ],
      },
    });

    expect(await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "AGUJA" })).toMatchObject({
      precio: 11.01,
      fuente: "lista",
    });
  });

  // -------------------------------------------------------------------------
  // CC-0016 — alias ImagingTestAttrs.codigoTarifario
  // -------------------------------------------------------------------------

  it("sin labTestId, no se consulta el alias de imágenes (regresión)", async () => {
    const tx = makeTx({ ...cuentaConLista, items: { [`${PRICE_LIST_ID}|RX001`]: { unitPrice: "42.50" } } });

    const result = await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "RX001" });

    expect(result).toMatchObject({ precio: 42.5, fuente: "lista" });
    expect(tx.imagingTestAttrs.findUnique).not.toHaveBeenCalled();
  });

  it("con labTestId pero sin alias configurado, usa el code nativo (regresión)", async () => {
    const tx = makeTx({
      ...cuentaConLista,
      imagingAttrs: null,
      items: { [`${PRICE_LIST_ID}|RX001`]: { unitPrice: "20.00" } },
    });

    const result = await resolverPrecio(tx as never, {
      organizationId: ORG_ID,
      cuentaId: CUENTA_ID,
      code: "RX001",
      labTestId: "test-1",
    });

    expect(result).toMatchObject({ precio: 20, fuente: "lista" });
  });

  it("prueba el alias ANTES que el code nativo", async () => {
    const tx = makeTx({
      ...cuentaConLista,
      imagingAttrs: { codigoTarifario: "ODOO-RX-999" },
      items: {
        [`${PRICE_LIST_ID}|ODOO-RX-999`]: { unitPrice: "99.00" },
        [`${PRICE_LIST_ID}|RX001`]: { unitPrice: "15.00" },
      },
    });

    const result = await resolverPrecio(tx as never, {
      organizationId: ORG_ID,
      cuentaId: CUENTA_ID,
      code: "RX001",
      labTestId: "test-1",
    });

    expect(result).toMatchObject({ precio: 99, fuente: "lista" });
  });

  it("si el alias no matchea, cae al code nativo", async () => {
    const tx = makeTx({
      ...cuentaConLista,
      imagingAttrs: { codigoTarifario: "ODOO-RX-999" },
      items: { [`${PRICE_LIST_ID}|RX001`]: { unitPrice: "15.00" } },
    });

    const result = await resolverPrecio(tx as never, {
      organizationId: ORG_ID,
      cuentaId: CUENTA_ID,
      code: "RX001",
      labTestId: "test-1",
    });

    expect(result).toMatchObject({ precio: 15, fuente: "lista" });
  });
});

describe("resolverPrecioEnLista", () => {
  it("evalúa la lista indicada sin pasar por la cuenta", async () => {
    const tx = makeTx({ items: { [`${PRICE_LIST_ID}|GLU`]: { unitPrice: "6.30" } } });

    expect(
      await resolverPrecioEnLista(tx as never, { organizationId: ORG_ID, priceListId: PRICE_LIST_ID, code: "GLU" }),
    ).toEqual({ precio: 6.3, fuente: "lista", priceListId: PRICE_LIST_ID, reglaId: null });

    expect(tx.patientAccount.findFirst).not.toHaveBeenCalled();
  });

  it("cae al catálogo cuando la lista no resuelve el código", async () => {
    const tx = makeTx({ labTestTenant: { standardPrice: 12.5 } });

    expect(
      await resolverPrecioEnLista(tx as never, { organizationId: ORG_ID, priceListId: PRICE_LIST_ID, code: "XYZ" }),
    ).toEqual({ precio: 12.5, fuente: "estandar", priceListId: null, reglaId: null });
  });
});
