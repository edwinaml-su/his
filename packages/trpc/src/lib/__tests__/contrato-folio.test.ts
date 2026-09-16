import { describe, it, expect, vi } from "vitest";
import { nextContratoFolio } from "../contrato-folio";

const ORG_ID = "00000000-0000-0000-0000-0000000000aa";

function makeFakeTx(n: number) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ n }]),
  };
}

describe("nextContratoFolio", () => {
  it("correlativo 1 -> ARR-000001", async () => {
    const tx = makeFakeTx(1);
    expect(await nextContratoFolio(tx, ORG_ID)).toBe("ARR-000001");
  });

  it("correlativo 123 -> ARR-000123 (pad a 6 dígitos)", async () => {
    const tx = makeFakeTx(123);
    expect(await nextContratoFolio(tx, ORG_ID)).toBe("ARR-000123");
  });

  it("correlativo 999999 -> ARR-999999 (sin truncar)", async () => {
    const tx = makeFakeTx(999_999);
    expect(await nextContratoFolio(tx, ORG_ID)).toBe("ARR-999999");
  });

  it("lanza si $queryRaw devuelve array vacío", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(nextContratoFolio(tx, ORG_ID)).rejects.toThrow(
      "fn_next_contrato_arrendamiento no devolvió valor",
    );
  });
});
