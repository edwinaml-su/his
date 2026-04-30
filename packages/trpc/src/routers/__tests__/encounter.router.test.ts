/**
 * Tests del encounter router — admit, transfer, discharge.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { encounterRouter } from "../encounter.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_TENANT_NO_ESTABLISHMENT } from "@his/test-utils";

describe("encounterRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("admit", () => {
    it("genera encounterNumber con formato ENC-YYYY-NNNNNN", async () => {
      prisma.encounter.count.mockResolvedValue(41);
      prisma.encounter.create.mockImplementation(((args: { data: { encounterNumber: string } }) => {
        return Promise.resolve({ id: "e1", ...args.data }) as never;
      }) as never);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.admit({
        patientId: "00000000-0000-0000-0000-000000000010",
        admissionType: "EMERGENCY",
        currencyId: "00000000-0000-0000-0000-000000000020",
      } as never);

      const year = new Date().getFullYear();
      expect((out as { encounterNumber: string }).encounterNumber).toBe(
        `ENC-${year}-000042`,
      );
    });

    it("falla si el tenant no tiene establecimiento (FORBIDDEN)", async () => {
      const caller = encounterRouter.createCaller(
        makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
      );
      await expect(
        caller.admit({
          patientId: "00000000-0000-0000-0000-000000000010",
          admissionType: "EMERGENCY",
          currencyId: "00000000-0000-0000-0000-000000000020",
        } as never),
      ).rejects.toBeInstanceOf(TRPCError);
    });

    it("usa admittedAt del input si se provee", async () => {
      prisma.encounter.count.mockResolvedValue(0);
      prisma.encounter.create.mockResolvedValue({ id: "e2" } as never);
      const at = new Date("2026-01-15T08:00:00Z");

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await caller.admit({
        patientId: "00000000-0000-0000-0000-000000000010",
        admissionType: "SCHEDULED",
        currencyId: "00000000-0000-0000-0000-000000000020",
        admittedAt: at,
      } as never);

      const args = prisma.encounter.create.mock.calls[0]![0];
      expect(args.data.admittedAt).toEqual(at);
    });
  });

  describe("transfer", () => {
    it("crea EncounterTransfer con razón y bedIds", async () => {
      prisma.encounterTransfer.create.mockResolvedValue({ id: "t1" } as never);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await caller.transfer({
        encounterId: "00000000-0000-0000-0000-000000000030",
        toServiceId: "00000000-0000-0000-0000-000000000031",
        fromBedId: "00000000-0000-0000-0000-000000000040",
        toBedId: "00000000-0000-0000-0000-000000000041",
        reason: "Cambio a UCI",
      });

      const args = prisma.encounterTransfer.create.mock.calls[0]![0];
      expect(args.data).toMatchObject({
        toBedId: "00000000-0000-0000-0000-000000000041",
        reason: "Cambio a UCI",
      });
    });
  });

  describe("discharge", () => {
    it("cierra encounter con dischargedAt y dischargeType", async () => {
      prisma.encounter.update.mockResolvedValue({ id: "e3" } as never);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await caller.discharge({
        encounterId: "00000000-0000-0000-0000-000000000050",
        dischargeType: "MEDICAL",
      });

      const args = prisma.encounter.update.mock.calls[0]![0];
      expect(args.data.dischargeType).toBe("MEDICAL");
      expect(args.data.dischargedAt).toBeInstanceOf(Date);
    });
  });

  describe("list", () => {
    it("filtra por status=OPEN aplica dischargedAt:null", async () => {
      prisma.encounter.findMany.mockResolvedValue([] as never);
      prisma.encounter.count.mockResolvedValue(0);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ status: "OPEN", page: 1, pageSize: 20 });

      const args = prisma.encounter.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        dischargedAt: null,
      });
    });

    it("filtra por status=CLOSED aplica dischargedAt:{not:null}", async () => {
      prisma.encounter.findMany.mockResolvedValue([] as never);
      prisma.encounter.count.mockResolvedValue(0);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ status: "CLOSED", page: 1, pageSize: 20 });

      const args = prisma.encounter.findMany.mock.calls[0]![0];
      expect(args.where.dischargedAt).toEqual({ not: null });
    });
  });
});
