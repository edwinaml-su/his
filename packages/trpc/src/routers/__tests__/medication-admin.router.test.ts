/**
 * Tests del medicationAdminRouter (§16 eMAR — Wave 7 Phase 2 skeleton).
 *
 * Cubre tenant-isolation por relación (item.prescription.organizationId),
 * gating por status de prescription, y filtros de list.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { medicationAdminRouter } from "../medication-admin.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";

describe("medicationAdminRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("record", () => {
    it("NOT_FOUND si item no pertenece a prescription firmada del tenant", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue(null as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.record({ prescriptionItemId: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("registra administración con default status=GIVEN", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({ id: u } as never);
      prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.record({ prescriptionItemId: u, patientWristbandScanned: true });
      const args = prisma.medicationAdministration.create.mock.calls[0]![0];
      expect(args.data.organizationId).toBeTruthy();
      expect(args.data.administeredById).toBeTruthy();
      expect((args.data as { status: string }).status).toBe("GIVEN");
      expect((args.data as { patientWristbandScanned: boolean }).patientWristbandScanned).toBe(
        true,
      );
    });

    it("acepta status REFUSED con notes", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({ id: u } as never);
      prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.record({
        prescriptionItemId: u,
        status: "REFUSED",
        notes: "Paciente rechazó administración",
      });
      const args = prisma.medicationAdministration.create.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("REFUSED");
    });

    it("guarda doubleCheckById cuando se proporciona", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({ id: u } as never);
      prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.record({
        prescriptionItemId: u,
        doubleCheckById: u,
        doseAmount: 5,
        doseUnit: "mg",
        route: "IV",
      });
      const args = prisma.medicationAdministration.create.mock.calls[0]![0];
      expect((args.data as { doubleCheckById: string }).doubleCheckById).toBe(u);
    });
  });

  describe("list", () => {
    it("filtra por organizationId y status", async () => {
      prisma.medicationAdministration.findMany.mockResolvedValue([] as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.list({
        status: "GIVEN",
        administeredById: u,
        limit: 25,
      });
      const args = prisma.medicationAdministration.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBeTruthy();
      expect(args!.take).toBe(25);
    });

    it("aplica rango de fechas", async () => {
      prisma.medicationAdministration.findMany.mockResolvedValue([] as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.list({
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
      });
      const args = prisma.medicationAdministration.findMany.mock.calls[0]![0];
      const where = args!.where as { administeredAt?: { gte?: Date; lte?: Date } };
      expect(where.administeredAt?.gte).toBeInstanceOf(Date);
      expect(where.administeredAt?.lte).toBeInstanceOf(Date);
    });
  });

  describe("get", () => {
    it("retorna registro encontrado", async () => {
      prisma.medicationAdministration.findFirst.mockResolvedValue({ id: u } as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.get({ id: u });
      expect(r.id).toBe(u);
    });

    it("NOT_FOUND si no existe en tenant", async () => {
      prisma.medicationAdministration.findFirst.mockResolvedValue(null as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
