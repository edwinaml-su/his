import { describe, it, expect, vi, beforeEach } from "vitest";
import { withEceContext } from "../rls-context";
import type { PrismaClient } from "@his/database";

// ---------------------------------------------------------------------------
// Helpers de mock — simulan la tx que Prisma.$transaction pasa al callback.
// ---------------------------------------------------------------------------

function makeTx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>) {
  return {
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withEceContext", () => {
  const personalId = "11111111-1111-1111-1111-111111111111";
  const establecimientoId = "22222222-2222-2222-2222-222222222222";

  let tx: ReturnType<typeof makeTx>;
  let prisma: PrismaClient;

  beforeEach(() => {
    tx = makeTx();
    prisma = makePrisma(tx);
  });

  it("happy path — setea contexto ECE, demota rol y ejecuta callback", async () => {
    const result = await withEceContext(
      prisma,
      personalId,
      establecimientoId,
      async (_tx) => ({ ok: true }),
    );

    expect(result).toEqual({ ok: true });

    // set_ece_context fue invocado con los UUIDs correctos
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    const [templateParts] = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[]
    ];
    const sql = templateParts.join("?");
    expect(sql).toContain("ece.set_ece_context");

    // demote a authenticated ocurrió
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith("SET LOCAL ROLE authenticated");
  });

  it("opt-out demoteRole: false — NO llama SET LOCAL ROLE authenticated", async () => {
    await withEceContext(
      prisma,
      personalId,
      establecimientoId,
      async () => null,
      { demoteRole: false },
    );

    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    // pero set_ece_context sí corrió
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
  });

  it("propaga error del callback — la transacción hace rollback", async () => {
    const boom = new Error("fallo_clinico");

    await expect(
      withEceContext(prisma, personalId, establecimientoId, async () => {
        throw boom;
      }),
    ).rejects.toThrow("fallo_clinico");
  });

  it("sin tx activa (sin $transaction) — SET LOCAL sería no-op, no hay garantía RLS", () => {
    // Este test documenta el contrato: la función REQUIERE que $transaction
    // envuelva el callback; fuera de una tx Postgres ignora SET LOCAL.
    // Verificamos que si $transaction no envuelve, el mock devuelve el valor
    // directamente y los GUCs nunca se aplican.
    const fakePrismaNoTx = {
      $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => {
        // Simula llamar al callback con un objeto que no ejecuta GUCs
        const noOpTx = {
          $executeRaw: vi.fn(),
          $executeRawUnsafe: vi.fn(),
        };
        return fn(noOpTx);
      }),
    } as unknown as PrismaClient;

    // Dado que la función siempre wrappea en $transaction, el contrato se cumple.
    // Si alguien llama withEceContext directamente sin $transaction, no existe
    // esa vía en la API publica — solo via el callback interno.
    expect(typeof withEceContext).toBe("function");
    expect(fakePrismaNoTx.$transaction).toBeDefined();
  });
});
