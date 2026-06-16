/**
 * Tests del drugClassifierRouter — mapeo N:M de clasificadores clínicos (GS1 Nivel 1).
 * Estrategia: mock de Prisma (vitest-mock-extended), sin BD.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { drugClassifierRouter } from "../drug-classifier.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";

describe("drugClassifierRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("list filtra por drugId", async () => {
    prisma.drugClassifier.findMany.mockResolvedValue([] as never);
    const caller = drugClassifierRouter.createCaller(makeCtx({ prisma }));
    await caller.list({ drugId: u });
    const where = prisma.drugClassifier.findMany.mock.calls[0]![0]!.where as { drugId: string };
    expect(where.drugId).toBe(u);
  });

  it("add crea un clasificador SNOMED", async () => {
    prisma.drugClassifier.create.mockResolvedValue({ id: u } as never);
    const caller = drugClassifierRouter.createCaller(makeCtx({ prisma }));
    await caller.add({ drugId: u, standard: "SNOMED", value: "322236009" });
    const data = prisma.drugClassifier.create.mock.calls[0]![0]!.data as { standard: string };
    expect(data.standard).toBe("SNOMED");
  });

  it("add acepta UNSPSC (vocabulario ausente antes de este PR)", async () => {
    prisma.drugClassifier.create.mockResolvedValue({ id: u } as never);
    const caller = drugClassifierRouter.createCaller(makeCtx({ prisma }));
    await caller.add({ drugId: u, standard: "UNSPSC", value: "51191905" });
    expect(prisma.drugClassifier.create).toHaveBeenCalledOnce();
  });

  it("add rechaza standard no válido (Zod)", async () => {
    const caller = drugClassifierRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.add({ drugId: u, standard: "FOO" as "ATC", value: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("remove elimina por id", async () => {
    prisma.drugClassifier.delete.mockResolvedValue({ id: u } as never);
    const caller = drugClassifierRouter.createCaller(makeCtx({ prisma }));
    const r = await caller.remove({ id: u });
    expect(r.ok).toBe(true);
  });
});
