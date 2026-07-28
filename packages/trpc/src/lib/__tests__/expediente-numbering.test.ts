import { describe, it, expect, vi } from "vitest";
import { nextExpediente } from "../expediente-numbering";

/** Crea un tx mínimo cuyo $queryRaw devuelve el n indicado. */
function makeFakeTx(n: number) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ n }]),
  };
}

describe("nextExpediente", () => {
  it("formatea El Salvador (222) + AA 84 + correlativo 1 → 2228400001", async () => {
    const tx = makeFakeTx(1);
    const result = await nextExpediente(
      tx,
      { isoAlpha2: "SV", isoNumeric: 222 },
      new Date("1984-03-15T00:00:00Z"),
    );
    expect(result).toBe("2228400001");
  });

  it("deriva AA correcto para año 2004 → '04'", async () => {
    const tx = makeFakeTx(1);
    const result = await nextExpediente(
      tx,
      { isoAlpha2: "SV", isoNumeric: 222 },
      new Date("2004-07-01T00:00:00Z"),
    );
    expect(result).toBe("2220400001");
  });

  it("pad 5 dígitos: correlativo 42 → '00042' (Guatemala, 320)", async () => {
    const tx = makeFakeTx(42);
    const result = await nextExpediente(
      tx,
      { isoAlpha2: "GT", isoNumeric: 320 },
      new Date("1990-01-01T00:00:00Z"),
    );
    expect(result).toBe("3209000042");
  });

  it("correlativo 99999 → sin truncar (5 dígitos exactos, Honduras 340)", async () => {
    const tx = makeFakeTx(99999);
    const result = await nextExpediente(
      tx,
      { isoAlpha2: "HN", isoNumeric: 340 },
      new Date("2000-06-15T00:00:00Z"),
    );
    expect(result).toBe("3400099999");
  });

  it("pad a 3 dígitos: país con isoNumeric < 100 (Albania, 8) → '008'", async () => {
    const tx = makeFakeTx(1);
    const result = await nextExpediente(
      tx,
      { isoAlpha2: "AL", isoNumeric: 8 },
      new Date("1995-01-01T00:00:00Z"),
    );
    expect(result).toBe("0089500001");
  });

  it("el bucket de la secuencia sigue keyed por isoAlpha2 (no por isoNumeric)", async () => {
    const tx = makeFakeTx(1);
    await nextExpediente(tx, { isoAlpha2: "SV", isoNumeric: 222 }, new Date("1984-03-15T00:00:00Z"));
    // El template literal llama con isoAlpha2='SV' y aa='84' — el prefijo numérico
    // (222) NO participa en la key del bucket, solo en el formato de salida.
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
      nextExpediente(tx, { isoAlpha2: "SV", isoNumeric: 222 }, new Date("1984-01-01T00:00:00Z")),
    ).rejects.toThrow("fn_next_expediente no devolvió valor");
  });
});
