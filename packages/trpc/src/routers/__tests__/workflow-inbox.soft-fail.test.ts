/**
 * Regresión 25P02 en /tareas: una fuente opcional que falla dentro de la
 * transacción de `withTenantContext` no debe envenenar las queries siguientes.
 * `softFail` aísla cada una con SAVEPOINT / ROLLBACK TO SAVEPOINT.
 */
import { describe, it, expect, vi } from "vitest";
import { softFail } from "../workflow-inbox.router";

function makeTx() {
  const calls: string[] = [];
  const tx = {
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      calls.push(sql);
      return 0;
    }),
  };
  return { tx, calls };
}

describe("softFail", () => {
  it("devuelve el resultado y solo abre el savepoint si la query funciona", async () => {
    const { tx, calls } = makeTx();
    const result = await softFail(tx as never, async () => [1, 2], [] as number[]);
    expect(result).toEqual([1, 2]);
    expect(calls).toEqual(["SAVEPOINT inbox_soft_fail"]);
  });

  it("hace ROLLBACK TO SAVEPOINT y devuelve el fallback si la query falla", async () => {
    const { tx, calls } = makeTx();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await softFail(
      tx as never,
      async () => {
        throw new Error('column "detectado_en" does not exist');
      },
      [] as number[],
    );
    expect(result).toEqual([]);
    expect(calls).toEqual(["SAVEPOINT inbox_soft_fail", "ROLLBACK TO SAVEPOINT inbox_soft_fail"]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
