/**
 * Tests del pharmacyRouter (§15 — Phase 2 skeleton).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { pharmacyRouter } from "../pharmacy.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";

describe("pharmacyRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("drug.list", () => {
    it("incluye catálogo global (organizationId=null) + tenant cuando no hay search", async () => {
      prisma.drug.findMany.mockResolvedValue([] as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await caller.drug.list({
        dispensingClass: "RX",
        activeOnly: true,
        limit: 20,
      });
      const args = prisma.drug.findMany.mock.calls[0]![0];
      const orClauses = (args!.where!.OR as Array<{ organizationId: unknown }>) ?? [];
      expect(orClauses).toEqual(
        expect.arrayContaining([{ organizationId: null }]),
      );
    });
  });

  describe("drug.create", () => {
    it("usa tenant.organizationId si input.organizationId es null", async () => {
      prisma.drug.create.mockResolvedValue({ id: u } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await caller.drug.create({
        genericName: "Paracetamol",
        pharmaceuticalForm: "TABLET",
        strengthValue: 500,
        strengthUnit: "mg",
      });
      const args = prisma.drug.create.mock.calls[0]![0];
      expect(args.data.organizationId).toBeTruthy();
    });
  });

  describe("prescription.get", () => {
    it("NOT_FOUND si no existe en tenant", async () => {
      prisma.prescription.findFirst.mockResolvedValue(null as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.prescription.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("prescription.create", () => {
    it("NOT_FOUND si encounter no pertenece a tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.prescription.create({
          encounterId: u,
          patientId: u,
          items: [
            { drugId: u, dosage: "1 tab", route: "ORAL", frequency: "c/8h" },
          ],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si patientId no coincide con encounter", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: "00000000-0000-0000-0000-000000000099",
      } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.prescription.create({
          encounterId: u,
          patientId: u,
          items: [
            { drugId: u, dosage: "1 tab", route: "ORAL", frequency: "c/8h" },
          ],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("crea receta con items cuando encounter y patient match", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: u,
      } as never);
      prisma.prescription.create.mockResolvedValue({ id: u, items: [] } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.prescription.create({
        encounterId: u,
        patientId: u,
        items: [
          { drugId: u, dosage: "1 tab", route: "ORAL", frequency: "c/8h" },
        ],
      });
      expect(r.id).toBe(u);
    });
  });

  describe("prescription.sign", () => {
    it("NOT_FOUND si receta no está en DRAFT", async () => {
      prisma.prescription.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.prescription.sign({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("firma receta DRAFT exitosamente", async () => {
      prisma.prescription.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.prescription.sign({ id: u });
      expect(r.ok).toBe(true);
    });
  });

  describe("dispense.create", () => {
    it("NOT_FOUND si item no está en prescription firmada de la tenant", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue(null as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.dispense.create({ prescriptionItemId: u, quantity: 5 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea dispense con dispensedById del usuario actual", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({ id: u } as never);
      prisma.medicationDispense.create.mockResolvedValue({ id: u } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await caller.dispense.create({
        prescriptionItemId: u,
        quantity: 10,
        batchNumber: "LOT-1",
      });
      const args = prisma.medicationDispense.create.mock.calls[0]![0];
      expect(args.data.dispensedById).toBeTruthy();
      expect(args.data.quantity).toBe(10);
    });
  });
});
