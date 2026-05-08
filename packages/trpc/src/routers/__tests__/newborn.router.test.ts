/**
 * Tests del newborn router (US-4.6).
 *
 * Cubre:
 *  - createNewborn rechaza birthDate > NEWBORN_MAX_AGE_DAYS (28).
 *  - linkMother rechaza si la madre ya tiene NEWBORN_MAX_CHILDREN_PER_MOTHER (5) hijos.
 *  - unlinkMother revierte motherPatientId a null + crea audit log.
 *  - linkMother retorna NOT_FOUND si el RN no existe en el tenant.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { newbornRouter } from "../newborn.router";
import { makeCtx } from "../../__tests__/helpers/caller";

function fn<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

describe("newbornRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
      .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
        fn(prisma),
      );
  });

  describe("createNewborn", () => {
    it("rechaza birthDate con edad > 28 días (BAD_REQUEST)", async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: "mother-1",
        biologicalSex: { code: "F" },
      } as never);
      prisma.patient.count.mockResolvedValue(0 as never);

      // 60 días en el pasado: excede el cap de 28 días.
      const old = new Date(Date.now() - 60 * 86400000);

      const caller = newbornRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.createNewborn({
          motherId: "00000000-0000-0000-0000-000000000010",
          firstName: "Bebé",
          lastName: "Pérez",
          birthDate: old,
          biologicalSexId: "00000000-0000-0000-0000-000000000020",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("linkMother", () => {
    it("rechaza si la madre ya tiene 5 hijos neonatos vinculados (cap MVP)", async () => {
      // Mocks: RN válido, madre F, count=5 → exceeded.
      const recentBirth = new Date(Date.now() - 2 * 86400000); // 2 días.
      // findFirst se invoca 2 veces (en Promise.all): newborn + mother.
      prisma.patient.findFirst
        .mockResolvedValueOnce({
          id: "newborn-1",
          birthDate: recentBirth,
          motherPatientId: null,
          biologicalSex: { code: "M" },
        } as never)
        .mockResolvedValueOnce({
          id: "mother-1",
          biologicalSex: { code: "F" },
        } as never);
      prisma.patient.count.mockResolvedValue(5 as never);

      const caller = newbornRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.linkMother({
          newbornId: "00000000-0000-0000-0000-000000000010",
          motherId: "00000000-0000-0000-0000-000000000020",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("retorna NOT_FOUND si el RN no existe en el tenant", async () => {
      prisma.patient.findFirst
        .mockResolvedValueOnce(null as never) // newborn
        .mockResolvedValueOnce({ id: "mother-1" } as never);

      const caller = newbornRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.linkMother({
          newbornId: "00000000-0000-0000-0000-000000000010",
          motherId: "00000000-0000-0000-0000-000000000020",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("unlinkMother", () => {
    it("setea motherPatientId=null y registra audit log", async () => {
      prisma.patient.findFirst = fn({
        id: "newborn-1",
        motherPatientId: "mother-1",
      }) as never;
      prisma.patient.update.mockResolvedValue({ id: "newborn-1" } as never);
      prisma.auditLog.create.mockResolvedValue({ id: "a1" } as never);

      const caller = newbornRouter.createCaller(makeCtx({ prisma }));
      await caller.unlinkMother({
        newbornId: "00000000-0000-0000-0000-000000000010",
      });

      expect(prisma.patient.update.mock.calls[0]![0]).toMatchObject({
        data: { motherPatientId: null },
      });
      const audit = prisma.auditLog.create.mock.calls[0]![0];
      expect(audit.data.entity).toBe("Patient");
      // afterJson incluye op = UNLINK_NEWBORN_MOTHER.
      expect((audit.data.afterJson as { op: string }).op).toBe(
        "UNLINK_NEWBORN_MOTHER",
      );
    });

    it("rechaza si el paciente no tiene madre vinculada", async () => {
      prisma.patient.findFirst = fn({
        id: "newborn-1",
        motherPatientId: null,
      }) as never;

      const caller = newbornRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.unlinkMother({
          newbornId: "00000000-0000-0000-0000-000000000010",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
