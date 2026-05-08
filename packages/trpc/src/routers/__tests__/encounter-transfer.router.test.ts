/**
 * Tests del encounterTransfer router (US-5.3).
 *
 * Cubre:
 *  - transferEncounter crea EncounterTransfer + actualiza Encounter.serviceUnitId.
 *  - valida que reason no sea vacío (Zod min(2)) → input rechazado.
 *  - listByEncounter filtra por encounterId tras verificar pertenencia al tenant.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { encounterTransferRouter } from "../encounter-transfer.router";
import { makeCtx } from "../../__tests__/helpers/caller";

function fn<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

describe("encounterTransferRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
      .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
        fn(prisma),
      );
  });

  describe("transferEncounter", () => {
    it("crea EncounterTransfer y actualiza serviceUnitId del encounter", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: "e1",
        dischargedAt: null,
        serviceUnitId: "svc-old",
        bedAssignments: [],
      } as never);
      prisma.encounterTransfer.create.mockResolvedValue({ id: "t1" } as never);
      prisma.encounter.update.mockResolvedValue({ id: "e1" } as never);

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await caller.transferEncounter({
        encounterId: "00000000-0000-0000-0000-000000000010",
        toServiceUnitId: "00000000-0000-0000-0000-000000000020",
        reason: "Cambio a UCI por deterioro",
      });

      // 1) EncounterTransfer creado con razón.
      const tArgs = prisma.encounterTransfer.create.mock.calls[0]![0];
      expect(tArgs.data).toMatchObject({
        encounterId: "e1",
        toServiceId: "00000000-0000-0000-0000-000000000020",
        reason: "Cambio a UCI por deterioro",
      });
      // 2) Encounter actualizado con nuevo serviceUnitId.
      const uArgs = prisma.encounter.update.mock.calls[0]![0];
      expect(uArgs.data.serviceUnitId).toBe(
        "00000000-0000-0000-0000-000000000020",
      );
    });

    it("rechaza reason vacío (Zod min(2))", async () => {
      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.transferEncounter({
          encounterId: "00000000-0000-0000-0000-000000000010",
          toServiceUnitId: "00000000-0000-0000-0000-000000000020",
          reason: "",
        }),
      ).rejects.toThrow();
    });
  });

  describe("listByEncounter", () => {
    it("filtra por encounterId tras verificar tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: "e1" } as never);
      prisma.encounterTransfer.findMany.mockResolvedValue([] as never);

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await caller.listByEncounter({
        encounterId: "00000000-0000-0000-0000-000000000010",
      });

      const args = prisma.encounterTransfer.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        encounterId: "00000000-0000-0000-0000-000000000010",
      });
      expect(args.orderBy).toEqual({ occurredAt: "asc" });
    });

    it("retorna NOT_FOUND si el encounter no pertenece al tenant", async () => {
      prisma.encounter.findFirst = fn(null) as never;

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.listByEncounter({
          encounterId: "00000000-0000-0000-0000-000000000099",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
