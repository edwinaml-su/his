import { describe, it, expect, vi } from "vitest";
import { nextExpediente } from "../expediente-numbering";

/** Crea un tx mínimo cuyo $queryRaw devuelve el n indicado. */
function makeFakeTx(n: number) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ n }]),
  };
}

describe("nextExpediente", () => {
  it("formatea SV + AA 84 + correlativo 1 → SV8400001", async () => {
    const tx = makeFakeTx(1);
    const result = await nextExpediente(tx, "SV", new Date("1984-03-15T00:00:00Z"));
    expect(result).toBe("SV8400001");
  });

  it("deriva AA correcto para año 2004 → '04'", async () => {
    const tx = makeFakeTx(1);
    const result = await nextExpediente(tx, "SV", new Date("2004-07-01T00:00:00Z"));
    expect(result).toBe("SV0400001");
  });

  it("pad 5 dígitos: correlativo 42 → '00042'", async () => {
    const tx = makeFakeTx(42);
    const result = await nextExpediente(tx, "GT", new Date("1990-01-01T00:00:00Z"));
    expect(result).toBe("GT9000042");
  });

  it("correlativo 99999 → sin truncar (5 dígitos exactos)", async () => {
    const tx = makeFakeTx(99999);
    const result = await nextExpediente(tx, "HN", new Date("2000-06-15T00:00:00Z"));
    expect(result).toBe("HN0099999");
  });

  it("pasa countryAlpha2 y aa correctos a fn_next_expediente", async () => {
    const tx = makeFakeTx(1);
    await nextExpediente(tx, "SV", new Date("1984-03-15T00:00:00Z"));
    // El template literal llama con countryAlpha2='SV' y aa='84'
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    // Verificamos los valores interpolados inspeccionando los args del tagged template:
    // $queryRaw recibe (strings, ...values). Los valores son los interpolados.
    const [_tpl, country, aa] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string, string];
    expect(country).toBe("SV");
    expect(aa).toBe("84");
  });

  it("lanza si $queryRaw devuelve array vacío", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(
      nextExpediente(tx, "SV", new Date("1984-01-01T00:00:00Z"))
    ).rejects.toThrow("fn_next_expediente no devolvió valor");
  });
});
