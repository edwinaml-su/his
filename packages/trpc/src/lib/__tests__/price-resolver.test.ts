/**
 * CC-0015 — Tests del resolver de precios por cuenta (price-resolver.ts).
 * Mock manual mínimo del cliente de transacción (no requiere mockDeep del
 * PrismaClient completo — el helper solo usa 3 métodos).
 */
import { describe, it, expect, vi } from "vitest";
import { resolverPrecio, resolverPriceListIdDeCuenta } from "../price-resolver";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const CUENTA_ID = "00000000-0000-0000-0000-000000000002";
const TIPO_CUENTA_ID = "00000000-0000-0000-0000-000000000003";
const PRICE_LIST_ID = "00000000-0000-0000-0000-000000000004";

function makeTx(opts: {
  patientAccount?: { tipoCuentaId: string | null } | null;
  tipoCuenta?: { priceListId: string | null } | null;
  itemRows?: Array<{ unitPrice: string }>;
  labTestTenant?: { standardPrice: unknown } | null;
  labTestGlobal?: { standardPrice: unknown } | null;
  /** CC-0016 — respuestas sucesivas de $queryRawUnsafe (alias primero, code nativo después). */
  queryRawUnsafeSequence?: Array<Array<{ unitPrice: string }>>;
  imagingAttrs?: { codigoTarifario: string | null } | null;
}) {
  const queryRawUnsafe = opts.queryRawUnsafeSequence
    ? vi.fn(() => Promise.resolve(opts.queryRawUnsafeSequence!.shift() ?? []))
    : vi.fn().mockResolvedValue(opts.itemRows ?? []);
  const patientAccountFindFirst = vi.fn().mockResolvedValue(opts.patientAccount ?? null);
  const tipoCuentaFindFirst = vi.fn().mockResolvedValue(opts.tipoCuenta ?? null);
  const labTestFindFirst = vi
    .fn()
    .mockImplementationOnce(async () => opts.labTestTenant ?? null)
    .mockImplementationOnce(async () => opts.labTestGlobal ?? null);
  const imagingTestAttrsFindUnique = vi.fn().mockResolvedValue(opts.imagingAttrs ?? null);

  return {
    $queryRawUnsafe: queryRawUnsafe,
    patientAccount: { findFirst: patientAccountFindFirst },
    tipoCuenta: { findFirst: tipoCuentaFindFirst },
    labTest: { findFirst: labTestFindFirst },
    imagingTestAttrs: { findUnique: imagingTestAttrsFindUnique },
  };
}

describe("resolverPriceListIdDeCuenta", () => {
  it("devuelve null si la cuenta no tiene tipoCuentaId", async () => {
    const tx = makeTx({ patientAccount: { tipoCuentaId: null } });
    const result = await resolverPriceListIdDeCuenta(tx as never, ORG_ID, CUENTA_ID);
    expect(result).toBeNull();
  });

  it("devuelve null si la cuenta no existe", async () => {
    const tx = makeTx({ patientAccount: null });
    const result = await resolverPriceListIdDeCuenta(tx as never, ORG_ID, CUENTA_ID);
    expect(result).toBeNull();
  });

  it("devuelve el priceListId del tipoCuenta de la cuenta", async () => {
    const tx = makeTx({
      patientAccount: { tipoCuentaId: TIPO_CUENTA_ID },
      tipoCuenta: { priceListId: PRICE_LIST_ID },
    });
    const result = await resolverPriceListIdDeCuenta(tx as never, ORG_ID, CUENTA_ID);
    expect(result).toBe(PRICE_LIST_ID);
  });
});

describe("resolverPrecio", () => {
  it("resuelve por la lista del tipo de cuenta cuando el item existe y está activo", async () => {
    const tx = makeTx({
      patientAccount: { tipoCuentaId: TIPO_CUENTA_ID },
      tipoCuenta: { priceListId: PRICE_LIST_ID },
      itemRows: [{ unitPrice: "42.50" }],
    });

    const result = await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "GLU" });

    expect(result).toEqual({ precio: 42.5, fuente: "lista", priceListId: PRICE_LIST_ID });
  });

  it("cae a LabTest.standardPrice (tenant) cuando no hay lista o el código no está en ella", async () => {
    const tx = makeTx({
      patientAccount: { tipoCuentaId: null },
      itemRows: [],
      labTestTenant: { standardPrice: 15 },
    });

    const result = await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "GLU" });

    expect(result).toEqual({ precio: 15, fuente: "estandar", priceListId: null });
  });

  it("cae a LabTest.standardPrice global cuando no hay override de tenant", async () => {
    const tx = makeTx({
      patientAccount: { tipoCuentaId: null },
      itemRows: [],
      labTestTenant: null,
      labTestGlobal: { standardPrice: 9.99 },
    });

    const result = await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "GLU" });

    expect(result).toEqual({ precio: 9.99, fuente: "estandar", priceListId: null });
  });

  it("devuelve fuente null cuando no hay lista ni standardPrice", async () => {
    const tx = makeTx({
      patientAccount: { tipoCuentaId: null },
      itemRows: [],
      labTestTenant: null,
      labTestGlobal: null,
    });

    const result = await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "GLU" });

    expect(result).toEqual({ precio: null, fuente: null, priceListId: null });
  });

  // ---------------------------------------------------------------------------
  // CC-0016 — alias ImagingTestAttrs.codigoTarifario
  // ---------------------------------------------------------------------------

  it("sin labTestId, el comportamiento es idéntico al de antes de CC-0016 (regresión)", async () => {
    const tx = makeTx({
      patientAccount: { tipoCuentaId: TIPO_CUENTA_ID },
      tipoCuenta: { priceListId: PRICE_LIST_ID },
      itemRows: [{ unitPrice: "42.50" }],
    });

    const result = await resolverPrecio(tx as never, { organizationId: ORG_ID, cuentaId: CUENTA_ID, code: "RX001" });

    expect(result).toEqual({ precio: 42.5, fuente: "lista", priceListId: PRICE_LIST_ID });
    // No debió consultar ImagingTestAttrs — labTestId no se pasó.
    expect(tx.imagingTestAttrs.findUnique).not.toHaveBeenCalled();
  });

  it("con labTestId pero sin fila de attrs (o sin codigoTarifario), cae al code nativo (regresión)", async () => {
    const tx = makeTx({
      patientAccount: { tipoCuentaId: TIPO_CUENTA_ID },
      tipoCuenta: { priceListId: PRICE_LIST_ID },
      imagingAttrs: null,
      queryRawUnsafeSequence: [[{ unitPrice: "20.00" }]],
    });

    const result = await resolverPrecio(tx as never, {
      organizationId: ORG_ID,
      cuentaId: CUENTA_ID,
      code: "RX001",
      labTestId: "test-1",
    });

    expect(result).toEqual({ precio: 20, fuente: "lista", priceListId: PRICE_LIST_ID });
  });

  it("prueba codigoTarifario ANTES que el code nativo cuando existe la fila de attrs", async () => {
    const tx = makeTx({
      patientAccount: { tipoCuentaId: TIPO_CUENTA_ID },
      tipoCuenta: { priceListId: PRICE_LIST_ID },
      imagingAttrs: { codigoTarifario: "ODOO-RX-999" },
      queryRawUnsafeSequence: [[{ unitPrice: "99.00" }]],
    });

    const result = await resolverPrecio(tx as never, {
      organizationId: ORG_ID,
      cuentaId: CUENTA_ID,
      code: "RX001",
      labTestId: "test-1",
    });

    expect(result).toEqual({ precio: 99, fuente: "lista", priceListId: PRICE_LIST_ID });
    // La primera consulta debió usar el alias, no el code nativo.
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect((tx.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toBe("ODOO-RX-999");
  });

  it("si el alias no matchea ningún item, cae al code nativo", async () => {
    const tx = makeTx({
      patientAccount: { tipoCuentaId: TIPO_CUENTA_ID },
      tipoCuenta: { priceListId: PRICE_LIST_ID },
      imagingAttrs: { codigoTarifario: "ODOO-RX-999" },
      queryRawUnsafeSequence: [[], [{ unitPrice: "15.00" }]],
    });

    const result = await resolverPrecio(tx as never, {
      organizationId: ORG_ID,
      cuentaId: CUENTA_ID,
      code: "RX001",
      labTestId: "test-1",
    });

    expect(result).toEqual({ precio: 15, fuente: "lista", priceListId: PRICE_LIST_ID });
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });
});
