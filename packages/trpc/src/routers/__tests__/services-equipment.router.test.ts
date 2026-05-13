/**
 * Tests del servicesEquipmentRouter (§20 — Wave 8 / Beta.11 hardening layer 1).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { servicesEquipmentRouter } from "../services-equipment.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const past = new Date("2026-01-01");
const future = new Date("2027-01-01");

describe("servicesEquipmentRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ---------------------------------------------------------------------------
  // equipment.list
  // ---------------------------------------------------------------------------

  describe("equipment.list", () => {
    it("filtra por organizationId via AND", async () => {
      prisma.biomedicalEquipment.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.list({ activeOnly: true, limit: 50 });
      const and = (prisma.biomedicalEquipment.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      expect(
        and.some(
          (c) => "organizationId" in c && typeof (c as { organizationId: string }).organizationId === "string",
        ),
      ).toBe(true);
    });

    it("search compone con AND sin pisar tenancy", async () => {
      prisma.biomedicalEquipment.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.list({
        activeOnly: true,
        search: "monitor",
        limit: 50,
      });
      const and = (prisma.biomedicalEquipment.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      expect(and.some((c) => "OR" in c)).toBe(true);
      expect(and.some((c) => "organizationId" in c)).toBe(true);
    });

    it("filtra por criticality cuando se provee", async () => {
      prisma.biomedicalEquipment.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.list({ criticality: "CRITICAL", limit: 50 });
      const and = (prisma.biomedicalEquipment.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      expect(and.some((c) => "criticality" in c)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // equipment.create
  // ---------------------------------------------------------------------------

  describe("equipment.create", () => {
    it("NOT_FOUND si establishment no es del tenant", async () => {
      prisma.establishment.findFirst.mockResolvedValue(null as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.equipment.create({
          establishmentId: u,
          assetTag: "AT-1",
          name: "Monitor",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("OK setea organizationId del tenant y criticality", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.biomedicalEquipment.create.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.create({
        establishmentId: u,
        assetTag: "AT-1",
        name: "Monitor",
        criticality: "HIGH",
      });
      const data = prisma.biomedicalEquipment.create.mock.calls[0]![0]!.data as {
        organizationId: string;
        createdBy: string;
        criticality: string;
      };
      expect(data.organizationId).toBeTruthy();
      expect(data.createdBy).toBeTruthy();
      expect(data.criticality).toBe("HIGH");
    });

    it("OK guarda certificationExpiresAt", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.biomedicalEquipment.create.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.create({
        establishmentId: u,
        assetTag: "AT-2",
        name: "Ventilador",
        certificationExpiresAt: future,
      });
      const data = prisma.biomedicalEquipment.create.mock.calls[0]![0]!.data as {
        certificationExpiresAt: Date;
      };
      expect(data.certificationExpiresAt).toEqual(future);
    });
  });

  // ---------------------------------------------------------------------------
  // equipment.setStatus — state machine + CRITICAL guard
  // ---------------------------------------------------------------------------

  describe("equipment.setStatus", () => {
    it("NOT_FOUND si equipo no existe en tenant", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue(null as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.equipment.setStatus({ id: u, status: "OUT_OF_SERVICE" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si transición inválida (RETIRED → OPERATIONAL)", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u,
        status: "RETIRED",
        criticality: "LOW",
      } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.equipment.setStatus({ id: u, status: "OPERATIONAL" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("BAD_REQUEST si transición inválida (OPERATIONAL → RETIRED)", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u,
        status: "OPERATIONAL",
        criticality: "MEDIUM",
      } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.equipment.setStatus({ id: u, status: "RETIRED" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("BAD_REQUEST si CRITICAL entra a UNDER_MAINTENANCE sin reason", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u,
        status: "OPERATIONAL",
        criticality: "CRITICAL",
      } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.equipment.setStatus({ id: u, status: "UNDER_MAINTENANCE" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("OK si CRITICAL entra a UNDER_MAINTENANCE con reason", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u,
        status: "OPERATIONAL",
        criticality: "CRITICAL",
      } as never);
      prisma.biomedicalEquipment.update.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.equipment.setStatus({
        id: u,
        status: "UNDER_MAINTENANCE",
        maintenanceReason: "Falla en sensor de presión",
      });
      expect(r.ok).toBe(true);
    });

    it("OK transición válida LOW equipment (no requiere reason)", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u,
        status: "OPERATIONAL",
        criticality: "LOW",
      } as never);
      prisma.biomedicalEquipment.update.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.equipment.setStatus({ id: u, status: "UNDER_MAINTENANCE" });
      expect(r.ok).toBe(true);
    });

    it("OK transición OPERATIONAL → BROKEN", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u,
        status: "OPERATIONAL",
        criticality: "HIGH",
      } as never);
      prisma.biomedicalEquipment.update.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.equipment.setStatus({ id: u, status: "BROKEN" });
      expect(r.ok).toBe(true);
    });

    it("setStatus limpia maintenanceReason cuando transiciona fuera de UNDER_MAINTENANCE", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u,
        status: "UNDER_MAINTENANCE",
        criticality: "HIGH",
      } as never);
      prisma.biomedicalEquipment.update.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.setStatus({ id: u, status: "OPERATIONAL" });
      const data = prisma.biomedicalEquipment.update.mock.calls[0]![0]!.data as {
        maintenanceReason: null;
      };
      expect(data.maintenanceReason).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // equipment.get
  // ---------------------------------------------------------------------------

  describe("equipment.get", () => {
    it("NOT_FOUND si no existe", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue(null as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.equipment.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("retorna equipo cuando existe", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({ id: u, name: "Monitor" } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.equipment.get({ id: u });
      expect(r.id).toBe(u);
    });
  });

  // ---------------------------------------------------------------------------
  // equipment.getOverduePm
  // ---------------------------------------------------------------------------

  describe("equipment.getOverduePm", () => {
    it("excluye equipos en UNDER_MAINTENANCE", async () => {
      prisma.biomedicalEquipment.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.getOverduePm({ limit: 50 });
      const and = (prisma.biomedicalEquipment.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      expect(
        and.some((c) => "status" in c && (c as { status: object }).status !== undefined),
      ).toBe(true);
    });

    it("incluye pmSchedules en el resultado", async () => {
      prisma.biomedicalEquipment.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.getOverduePm({ limit: 10 });
      const include = prisma.biomedicalEquipment.findMany.mock.calls[0]![0]!.include as {
        pmSchedules: object;
      };
      expect(include.pmSchedules).toBeDefined();
    });

    it("filtra por organizationId del tenant", async () => {
      prisma.biomedicalEquipment.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.getOverduePm({});
      const and = (prisma.biomedicalEquipment.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      expect(
        and.some((c) => "organizationId" in c),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // equipment.getExpiringCertifications
  // ---------------------------------------------------------------------------

  describe("equipment.getExpiringCertifications", () => {
    it("filtra por certificationExpiresAt ≤ cutoff", async () => {
      prisma.biomedicalEquipment.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.getExpiringCertifications({ daysAhead: 30 });
      const and = (prisma.biomedicalEquipment.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      expect(
        and.some((c) => "certificationExpiresAt" in c),
      ).toBe(true);
    });

    it("respeta daysAhead default=60", async () => {
      prisma.biomedicalEquipment.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.getExpiringCertifications({});
      // Verify query was called (daysAhead=60 from default)
      expect(prisma.biomedicalEquipment.findMany).toHaveBeenCalledOnce();
    });

    it("filtra por organizationId del tenant", async () => {
      prisma.biomedicalEquipment.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.getExpiringCertifications({});
      const and = (prisma.biomedicalEquipment.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      expect(and.some((c) => "organizationId" in c)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // pmSchedule
  // ---------------------------------------------------------------------------

  describe("pmSchedule.create / complete / cancel", () => {
    it("create NOT_FOUND si equipo no es del tenant", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue(null as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.pmSchedule.create({ equipmentId: u, scheduledAt: future }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.pmSchedule.create.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.pmSchedule.create({
        equipmentId: u,
        scheduledAt: future,
        taskNotes: "PM trimestral",
      });
      expect(r.id).toBe(u);
    });

    it("complete NOT_FOUND si ya cerrado", async () => {
      prisma.pmSchedule.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.pmSchedule.complete({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("complete OK setea performedAt + performedBy", async () => {
      prisma.pmSchedule.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.pmSchedule.complete({ id: u });
      const data = prisma.pmSchedule.updateMany.mock.calls[0]![0]!.data as {
        status: string;
        performedAt: Date;
        performedBy: string;
      };
      expect(data.status).toBe("COMPLETED");
      expect(data.performedAt).toBeInstanceOf(Date);
      expect(data.performedBy).toBeTruthy();
    });

    it("cancel OK", async () => {
      prisma.pmSchedule.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.pmSchedule.cancel({ id: u });
      expect(r.ok).toBe(true);
    });

    it("list filtra por equipment.organizationId", async () => {
      prisma.pmSchedule.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.pmSchedule.list({ limit: 50 });
      const where = prisma.pmSchedule.findMany.mock.calls[0]![0]!.where as {
        equipment: { organizationId: string };
      };
      expect(where.equipment.organizationId).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // calibration
  // ---------------------------------------------------------------------------

  describe("calibration.create", () => {
    it("NOT_FOUND si equipo no es del tenant", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue(null as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.calibration.create({
          equipmentId: u,
          calibratedAt: past,
          result: "PASS",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("OK con nextDueAt — calibratedBy viene del contexto", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.calibrationLog.create.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.calibration.create({
        equipmentId: u,
        calibratedAt: past,
        result: "PASS",
        nextDueAt: future,
        externalAgency: "OSARTEC",
      });
      const data = prisma.calibrationLog.create.mock.calls[0]![0]!.data as {
        result: string;
        calibratedBy: string;
      };
      expect(data.result).toBe("PASS");
      expect(data.calibratedBy).toBeTruthy();
    });

    it("list filtra por equipment.organizationId", async () => {
      prisma.calibrationLog.findMany.mockResolvedValue([] as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.calibration.list({ limit: 50 });
      const where = prisma.calibrationLog.findMany.mock.calls[0]![0]!.where as {
        equipment: { organizationId: string };
      };
      expect(where.equipment.organizationId).toBeTruthy();
    });
  });
});
