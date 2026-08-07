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
}) {
  const queryRawUnsafe = vi.fn().mockResolvedValue(opts.itemRows ?? []);
  const patientAccountFindFirst = vi.fn().mockResolvedValue(opts.patientAccount ?? null);
  const tipoCuentaFindFirst = vi.fn().mockResolvedValue(opts.tipoCuenta ?? null);
  const labTestFindFirst = vi
    .fn()
    .mockImplementationOnce(async () => opts.labTestTenant ?? null)
    .mockImplementationOnce(async () => opts.labTestGlobal ?? null);

  return {
    $queryRawUnsafe: queryRawUnsafe,
    patientAccount: { findFirst: patientAccountFindFirst },
    tipoCuenta: { findFirst: tipoCuentaFindFirst },
    labTest: { findFirst: labTestFindFirst },
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
});
