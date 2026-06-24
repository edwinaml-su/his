import { describe, it, expect, vi } from "vitest";
import { nextCuenta } from "../cuenta-numbering";

const PATIENT_ID = "00000000-0000-0000-0000-000000000001";

/** Crea un tx mínimo cuyo $queryRaw devuelve el n indicado. */
function makeFakeTx(n: number) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ n }]),
  };
}

describe("nextCuenta", () => {
  it("correlativo 1 → CTA00001", async () => {
    const tx = makeFakeTx(1);
    expect(await nextCuenta(tx, PATIENT_ID)).toBe("CTA00001");
  });

  it("correlativo 42 → CTA00042 (pad correcto)", async () => {
    const tx = makeFakeTx(42);
    expect(await nextCuenta(tx, PATIENT_ID)).toBe("CTA00042");
  });

  it("correlativo 99999 → CTA99999 (sin truncar)", async () => {
    const tx = makeFakeTx(99999);
    expect(await nextCuenta(tx, PATIENT_ID)).toBe("CTA99999");
  });

  it("pasa el patientId al tagged template", async () => {
    const tx = makeFakeTx(1);
    await nextCuenta(tx, PATIENT_ID);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    // El primer valor interpolado debe ser el patientId
    const [_tpl, pid] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(pid).toBe(PATIENT_ID);
  });

  it("lanza si $queryRaw devuelve array vacío", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(nextCuenta(tx, PATIENT_ID)).rejects.toThrow(
      "fn_next_cuenta no devolvió valor",
    );
  });
});
