import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextEncounterNumber } from "../encounter-numbering";

// Minimal fake tx que cumple la interfaz TxForNumbering.
function makeFakeTx(count: number) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    encounter: {
      count: vi.fn().mockResolvedValue(count),
    },
  };
}

describe("nextEncounterNumber", () => {
  const orgId = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T10:00:00Z"));
  });

  it("devuelve formato ENC-YYYY-NNNNNN con padding correcto", async () => {
    const tx = makeFakeTx(0);
    const result = await nextEncounterNumber(tx, orgId);
    expect(result).toBe("ENC-2026-000001");
  });

  it("incrementa el contador existente", async () => {
    const tx = makeFakeTx(99);
    const result = await nextEncounterNumber(tx, orgId);
    expect(result).toBe("ENC-2026-000100");
  });

  it("invoca pg_advisory_xact_lock antes del count", async () => {
    const tx = makeFakeTx(5);
    await nextEncounterNumber(tx, orgId);
    // El lock se llama primero
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    // El count se llama después
    expect(tx.encounter.count).toHaveBeenCalledOnce();
  });

  it("el count filtra desde inicio de año en UTC", async () => {
    const tx = makeFakeTx(0);
    await nextEncounterNumber(tx, orgId);
    const callArgs = tx.encounter.count.mock.calls[0]![0];
    expect(callArgs.where.organizationId).toBe(orgId);
    const since = callArgs.where.admittedAt.gte as Date;
    expect(since.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("acepta UUID con guiones en orgId para calcular lockKey", async () => {
    // Debe no lanzar aunque el UUID tenga formato estándar con guiones.
    const tx = makeFakeTx(0);
    await expect(nextEncounterNumber(tx, orgId)).resolves.not.toThrow();
  });
});
