/**
 * Tests del bed router — list, getMap, updateStatus.
 *
 * Nota sobre transiciones permitidas:
 *   El router actual NO impone máquina de estados (FREE→OCCUPIED→DIRTY,
 *   etc.). Esa regla aún no está implementada. Marcamos como SKIP el test
 *   correspondiente para dejar trazabilidad: cuando @Dev añada la lógica,
 *   se quita el `.skip` y se valida que rechaza transiciones ilegales.
 *   Backlog ref: US-BED-08.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { bedRouter } from "../bed.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

describe("bedRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("list", () => {
    it("filtra por organizationId + active=true", async () => {
      prisma.bed.findMany.mockResolvedValue([] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.list({});

      const args = prisma.bed.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        active: true,
      });
    });

    it("aplica filtro por status si se provee", async () => {
      prisma.bed.findMany.mockResolvedValue([] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ status: "FREE" });

      expect(prisma.bed.findMany.mock.calls[0]![0].where).toMatchObject({
        status: "FREE",
      });
    });
  });

  describe("getMap", () => {
    it("retorna servicios con al menos una cama", async () => {
      prisma.serviceUnit.findMany.mockResolvedValue([
        { id: "s1", code: "URG-A", beds: [{ id: "b1" }] },
        { id: "s2", code: "EMPTY", beds: [] },
      ] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.getMap();

      expect(out).toHaveLength(1);
      expect((out[0] as { id: string }).id).toBe("s1");
    });
  });

  describe("updateStatus", () => {
    it("actualiza el estado de la cama", async () => {
      prisma.bed.update.mockResolvedValue({ id: "b1", status: "DIRTY" } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.updateStatus({
        bedId: "00000000-0000-0000-0000-000000000010",
        status: "DIRTY",
      });

      expect(prisma.bed.update.mock.calls[0]![0]).toMatchObject({
        where: { id: "00000000-0000-0000-0000-000000000010" },
        data: { status: "DIRTY" },
      });
    });

    it.skip("rechaza transición ilegal (US-BED-08, pendiente en @Dev)", async () => {
      // Intencional: la lógica de máquina de estados aún no existe.
      // Cuando se implemente: FREE → OCCUPIED debe requerir BedAssignment;
      // OCCUPIED → FREE debe pasar por DIRTY primero, etc.
      expect.fail("Habilitar cuando @Dev implemente bedStateMachine.");
    });
  });
});
