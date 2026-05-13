/**
 * Tests del pharmacyRouter (§15 — Phase 2 skeleton + Beta.2 hardening).
 *
 * Beta.2 (2026-05-13) cubre:
 * - State machine en sign (DRAFT → SIGNED) y dispense.
 * - Interaction detection con dataset inyectado en tests.
 * - Lot expiry validation.
 * - 2-eyes RX_CONTROLLED y high-risk drugs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import {
  pharmacyRouter,
  _resetInteractionsDatasetForTesting,
} from "../pharmacy.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";
const w = "00000000-0000-0000-0000-000000000003";

describe("pharmacyRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    _resetInteractionsDatasetForTesting([]);
  });
  afterEach(() => {
    _resetInteractionsDatasetForTesting();
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

  describe("prescription.sign (Beta.2 state machine + interactions)", () => {
    it("NOT_FOUND si receta no existe en tenant", async () => {
      prisma.prescription.findFirst.mockResolvedValue(null as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.prescription.sign({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("PRECONDITION_FAILED si receta no está en DRAFT", async () => {
      prisma.prescription.findFirst.mockResolvedValue({
        id: u,
        status: "DISPENSED",
      } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.prescription.sign({ id: u })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("firma receta DRAFT exitosamente con alerts vacías (sin dataset)", async () => {
      prisma.prescription.findFirst.mockResolvedValue({
        id: u,
        status: "DRAFT",
      } as never);
      prisma.prescriptionItem.findMany.mockResolvedValue([
        { drug: { atcCode: "N02BE01", genericName: "Paracetamol" } },
      ] as never);
      prisma.prescription.update.mockResolvedValue({ id: u } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.prescription.sign({ id: u });
      expect(r.ok).toBe(true);
      expect(r.alerts).toEqual([]);
    });

    it("Beta.2 — bloquea sign si hay interaction major sin override", async () => {
      _resetInteractionsDatasetForTesting([
        {
          atcA: "B01AA03",
          atcB: "M01AE01",
          severity: "major",
          description: "Warfarina + Ibuprofeno",
        },
      ]);
      prisma.prescription.findFirst.mockResolvedValue({
        id: u,
        status: "DRAFT",
      } as never);
      prisma.prescriptionItem.findMany.mockResolvedValue([
        { drug: { atcCode: "B01AA03", genericName: "Warfarina" } },
        { drug: { atcCode: "M01AE01", genericName: "Ibuprofeno" } },
      ] as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.prescription.sign({ id: u })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(prisma.prescription.update).not.toHaveBeenCalled();
    });

    it("Beta.2 — permite sign con override justification cuando hay major", async () => {
      _resetInteractionsDatasetForTesting([
        {
          atcA: "B01AA03",
          atcB: "M01AE01",
          severity: "major",
          description: "Warfarina + Ibuprofeno",
        },
      ]);
      prisma.prescription.findFirst.mockResolvedValue({
        id: u,
        status: "DRAFT",
      } as never);
      prisma.prescriptionItem.findMany.mockResolvedValue([
        { drug: { atcCode: "B01AA03", genericName: "Warfarina" } },
        { drug: { atcCode: "M01AE01", genericName: "Ibuprofeno" } },
      ] as never);
      prisma.prescription.update.mockResolvedValue({ id: u } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.prescription.sign({
        id: u,
        forceOverrideJustification:
          "Override aprobado por jefe de servicio para anticoagulación crónica.",
      });
      expect(r.ok).toBe(true);
      expect(r.alerts).toHaveLength(1);
      // Verifica que la nota se appendea con prefijo OVERRIDE
      const updateArgs = prisma.prescription.update.mock.calls[0]![0];
      const notes = (updateArgs.data as { notes?: string }).notes;
      expect(notes).toContain("OVERRIDE INTERACTIONS");
    });

    it("Beta.2 — permite sign sin override cuando solo hay alerts minor/moderate", async () => {
      _resetInteractionsDatasetForTesting([
        {
          atcA: "N02BE01",
          atcB: "B01AA03",
          severity: "moderate",
          description: "Paracetamol crónico + Warfarina",
        },
      ]);
      prisma.prescription.findFirst.mockResolvedValue({
        id: u,
        status: "DRAFT",
      } as never);
      prisma.prescriptionItem.findMany.mockResolvedValue([
        { drug: { atcCode: "N02BE01", genericName: "Paracetamol" } },
        { drug: { atcCode: "B01AA03", genericName: "Warfarina" } },
      ] as never);
      prisma.prescription.update.mockResolvedValue({ id: u } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.prescription.sign({ id: u });
      expect(r.ok).toBe(true);
      expect(r.alerts).toHaveLength(1);
      expect(r.alerts[0]!.severity).toBe("moderate");
    });
  });

  describe("dispense.create (Beta.2 lot + 2-eyes)", () => {
    it("NOT_FOUND si item no está en prescription firmada de la tenant", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue(null as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.dispense.create({ prescriptionItemId: u, quantity: 5 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea dispense RX simple sin batch/witness", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: u,
        drug: {
          id: u,
          atcCode: "N02BE01",
          dispensingClass: "RX",
          genericName: "Paracetamol",
        },
      } as never);
      prisma.medicationDispense.create.mockResolvedValue({ id: u } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await caller.dispense.create({
        prescriptionItemId: u,
        quantity: 10,
      });
      const args = prisma.medicationDispense.create.mock.calls[0]![0];
      expect(args.data.dispensedById).toBeTruthy();
      expect(args.data.quantity).toBe(10);
    });

    it("Beta.2 — PRECONDITION_FAILED si lote está expirado", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: u,
        drug: {
          id: u,
          atcCode: "N02BE01",
          dispensingClass: "RX",
          genericName: "Paracetamol",
        },
      } as never);
      const expired = new Date(Date.now() - 24 * 60 * 60 * 1000); // ayer
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.dispense.create({
          prescriptionItemId: u,
          quantity: 10,
          batchNumber: "LOT-EXP",
          expiryDate: expired,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("Beta.2 — FORBIDDEN para RX_CONTROLLED sin witnessUserId", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: u,
        drug: {
          id: u,
          atcCode: "N02AA01",
          dispensingClass: "RX_CONTROLLED",
          genericName: "Morfina",
        },
      } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.dispense.create({
          prescriptionItemId: u,
          quantity: 1,
          controlledJustification: "Dolor oncológico severo",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("Beta.2 — FORBIDDEN para RX_CONTROLLED sin justification", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: u,
        drug: {
          id: u,
          atcCode: "N02AA01",
          dispensingClass: "RX_CONTROLLED",
          genericName: "Morfina",
        },
      } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.dispense.create({
          prescriptionItemId: u,
          quantity: 1,
          witnessUserId: v,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("Beta.2 — FORBIDDEN si witnessUserId === dispensador (mismo user)", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: u,
        drug: {
          id: u,
          atcCode: "N02AA01",
          dispensingClass: "RX_CONTROLLED",
          genericName: "Morfina",
        },
      } as never);
      // MOCK_USER_ADMIN.id === u; pasamos u como witness para forzar la colisión.
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.dispense.create({
          prescriptionItemId: u,
          quantity: 1,
          witnessUserId: u, // mismo que ctx.user.id (MOCK_USER_ADMIN)
          controlledJustification:
            "Dolor oncológico documentado para colisión.",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("Beta.2 — dispense RX_CONTROLLED válido con witness distinto + justification", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: u,
        drug: {
          id: u,
          atcCode: "N02AA01",
          dispensingClass: "RX_CONTROLLED",
          genericName: "Morfina",
        },
      } as never);
      prisma.medicationDispense.create.mockResolvedValue({ id: u } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await caller.dispense.create({
        prescriptionItemId: u,
        quantity: 1,
        witnessUserId: v,
        controlledJustification: "Dolor oncológico severo — orden Dr. González",
      });
      const args = prisma.medicationDispense.create.mock.calls[0]![0];
      // El notes debe incluir witness y CONTROLLED
      expect(args.data.notes).toContain("CONTROLLED");
      expect(args.data.notes).toContain("witness:");
    });

    it("Beta.2 — FORBIDDEN para drug high-risk (insulina) sin witness", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: u,
        drug: {
          id: u,
          atcCode: "A10AB05", // insulina (ISMP high risk)
          dispensingClass: "RX",
          genericName: "Insulina aspart",
        },
      } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.dispense.create({
          prescriptionItemId: u,
          quantity: 1,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("Beta.2 — dispense high-risk válido con witness distinto", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: u,
        drug: {
          id: u,
          atcCode: "A10AB05",
          dispensingClass: "RX",
          genericName: "Insulina aspart",
        },
      } as never);
      prisma.medicationDispense.create.mockResolvedValue({ id: u } as never);
      const caller = pharmacyRouter.createCaller(makeCtx({ prisma }));
      await caller.dispense.create({
        prescriptionItemId: u,
        quantity: 1,
        witnessUserId: v,
      });
      expect(prisma.medicationDispense.create).toHaveBeenCalled();
    });
  });
});
