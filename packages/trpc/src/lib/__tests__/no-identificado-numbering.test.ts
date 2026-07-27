import { describe, it, expect, vi } from "vitest";
import { nextNoIdentificadoLabel } from "../no-identificado-numbering";

/** Crea un tx mínimo cuyo $queryRaw devuelve el n indicado. */
function makeFakeTx(n: number) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ n }]),
  };
}

describe("nextNoIdentificadoLabel", () => {
  it("formatea DDMMAAAA + correlativo 1 → '27072026-01'", async () => {
    const tx = makeFakeTx(1);
    const result = await nextNoIdentificadoLabel(
      tx,
      "00000000-0000-0000-0000-000000000001",
      new Date("2026-07-27T15:00:00Z"),
    );
    expect(result).toBe("27072026-01");
  });

  it("pad 2 dígitos: correlativo 9 → '09'", async () => {
    const tx = makeFakeTx(9);
    const result = await nextNoIdentificadoLabel(
      tx,
      "00000000-0000-0000-0000-000000000001",
      new Date("2026-01-05T00:00:00Z"),
    );
    expect(result).toBe("05012026-09");
  });

  it("correlativo 42 → sin truncar (2 dígitos exactos)", async () => {
    const tx = makeFakeTx(42);
    const result = await nextNoIdentificadoLabel(
      tx,
      "00000000-0000-0000-0000-000000000001",
      new Date("2026-12-31T00:00:00Z"),
    );
    expect(result).toBe("31122026-42");
  });

  it("pasa organizationId y fecha (yyyy-mm-dd) correctos a fn_next_no_identificado", async () => {
    const tx = makeFakeTx(1);
    await nextNoIdentificadoLabel(
      tx,
      "org-uuid",
      new Date("2026-07-27T23:59:00Z"),
    );
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    const [_tpl, org, fecha] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string, string];
    expect(org).toBe("org-uuid");
    expect(fecha).toBe("2026-07-27");
  });

  it("lanza si $queryRaw devuelve array vacío", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(
      nextNoIdentificadoLabel(tx, "org-uuid", new Date("2026-01-01T00:00:00Z")),
    ).rejects.toThrow("fn_next_no_identificado no devolvió valor");
  });
});
