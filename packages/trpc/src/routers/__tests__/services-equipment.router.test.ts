/**
 * Tests del servicesEquipmentRouter (§20 — Wave 8 / Beta.11 hardening layer 1).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { servicesEquipmentRouter } from "../services-equipment.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const u = "00000000-0000-0000-0000-000000000001";
const past = new Date("2026-01-01");
const future = new Date("2027-01-01");

/**
 * `withTenantContext` también llama `$executeRawUnsafe` internamente (SET
 * LOCAL de los GUCs de tenant) sobre el mismo mock de `prisma` — este helper
 * ubica específicamente la llamada del upsert a `ece.gs1_giai` entre esas.
 */
function findGiaiCatalogCall(prisma: DeepMockProxy<PrismaClient>): unknown[] {
  const calls = (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
  const call = calls.find((c) => String(c[0]).includes("ece.gs1_giai"));
  if (!call) throw new Error("No se registró ninguna llamada a ece.gs1_giai");
  return call;
}

describe("servicesEquipmentRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // R02: todos los procedures ahora pasan por withTenantContext ($transaction
    // + SET LOCAL). El mock invoca el callback con el mismo `prisma` mockeado
    // para que las aserciones sobre `prisma.<modelo>.<method>` sigan viendo
    // las llamadas (mira catalog.router.test.ts / audit.router.test.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$transaction.mockImplementation(async (cb: any) => {
      if (typeof cb === "function") return cb(prisma);
      return Promise.all(cb);
    });
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

  // ---------------------------------------------------------------------------
  // GS1 — GIAI (CC-0029): registrarGiai (manual) + generarGiai (automático)
  // ---------------------------------------------------------------------------

  describe("equipment.registrarGiai", () => {
    it("FORBIDDEN si el rol no es ADMIN/LOGISTIC", async () => {
      const caller = servicesEquipmentRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["NURSE"] } }),
      );
      await expect(
        caller.equipment.registrarGiai({ equipmentId: u, giaiCode: "7410398AT001" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("NOT_FOUND si equipo no es del tenant", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue(null as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.equipment.registrarGiai({ equipmentId: u, giaiCode: "7410398AT001" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("OK: actualiza giaiCode y upsertea el catálogo ece.gs1_giai", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u, name: "Ventilador", manufacturer: "Hamilton", model: "G5", serialNumber: "SN-1",
      } as never);
      prisma.biomedicalEquipment.update.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.equipment.registrarGiai({ equipmentId: u, giaiCode: "7410398AT001" });
      expect(r.ok).toBe(true);
      expect(r.giaiCode).toBe("7410398AT001");

      const updateData = prisma.biomedicalEquipment.update.mock.calls[0]![0]!.data as { giaiCode: string };
      expect(updateData.giaiCode).toBe("7410398AT001");

      const catalogArgs = findGiaiCatalogCall(prisma);
      expect(catalogArgs[1]).toBe("7410398AT001");
      expect(catalogArgs[2]).toBe("Ventilador");
      expect(catalogArgs[3]).toBe("Hamilton");
    });

    it("normaliza entrada de escaneo cruda (8004<giai>) antes de guardar", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u, name: "Monitor", manufacturer: null, model: null, serialNumber: null,
      } as never);
      prisma.biomedicalEquipment.update.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      // Escaneo inequívoco: la cadena con AI supera los 30 chars de un GIAI
      // válido, así que el 8004 se despoja (ver contrato en normalizeGiaiScan).
      const giaiLargo = "7410398" + "C".repeat(21);
      const r = await caller.equipment.registrarGiai({ equipmentId: u, giaiCode: "8004" + giaiLargo });
      expect(r.giaiCode).toBe(giaiLargo);
      const updateData = prisma.biomedicalEquipment.update.mock.calls[0]![0]!.data as { giaiCode: string };
      expect(updateData.giaiCode).toBe(giaiLargo);
    });

    it("usa 'N/D' en el catálogo cuando manufacturer/model/serialNumber son null", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u, name: "Monitor", manufacturer: null, model: null, serialNumber: null,
      } as never);
      prisma.biomedicalEquipment.update.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await caller.equipment.registrarGiai({ equipmentId: u, giaiCode: "7410398AT003" });
      const catalogArgs = findGiaiCatalogCall(prisma);
      expect(catalogArgs[3]).toBe("N/D"); // fabricante
      expect(catalogArgs[4]).toBe("N/D"); // modelo
      expect(catalogArgs[5]).toBe("N/D"); // serial
    });

    it("CONFLICT si el GIAI ya está asignado a otro equipo (23505)", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u, name: "Monitor", manufacturer: null, model: null, serialNumber: null,
      } as never);
      prisma.biomedicalEquipment.update.mockRejectedValue({ code: "23505" } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.equipment.registrarGiai({ equipmentId: u, giaiCode: "7410398AT004" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("equipment.generarGiai", () => {
    it("FORBIDDEN si el rol no es ADMIN/LOGISTIC", async () => {
      const caller = servicesEquipmentRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["NURSE"] } }),
      );
      await expect(caller.equipment.generarGiai({ equipmentId: u })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("NOT_FOUND si equipo no es del tenant", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue(null as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.equipment.generarGiai({ equipmentId: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("CONFLICT si el equipo ya tiene GIAI asignado", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u, assetTag: "AT-001", giaiCode: "7410398AT001",
        name: "Ventilador", manufacturer: null, model: null, serialNumber: null,
      } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.equipment.generarGiai({ equipmentId: u })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("OK: genera GIAI determinista con prefijo de la org + assetTag", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u, assetTag: "AT-042", giaiCode: null,
        name: "Bomba de infusión", manufacturer: "B. Braun", model: "Infusomat", serialNumber: "SN-9",
      } as never);
      prisma.organization.findUnique.mockResolvedValue({ gs1CompanyPrefix: "7410398" } as never);
      prisma.biomedicalEquipment.update.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.equipment.generarGiai({ equipmentId: u });
      expect(r.giaiCode).toBe("7410398AT042");
      expect(r.equipmentId).toBe(u);

      const updateData = prisma.biomedicalEquipment.update.mock.calls[0]![0]!.data as { giaiCode: string };
      expect(updateData.giaiCode).toBe("7410398AT042");
      expect(findGiaiCatalogCall(prisma)[1]).toBe("7410398AT042");
    });

    it("es determinista: mismo assetTag genera siempre el mismo GIAI", async () => {
      const eq = {
        id: u, assetTag: "AT-777", giaiCode: null,
        name: "Monitor", manufacturer: null, model: null, serialNumber: null,
      };
      prisma.biomedicalEquipment.findFirst.mockResolvedValue(eq as never);
      prisma.organization.findUnique.mockResolvedValue({ gs1CompanyPrefix: "7410398" } as never);
      prisma.biomedicalEquipment.update.mockResolvedValue({ id: u } as never);

      const r1 = await servicesEquipmentRouter
        .createCaller(makeCtx({ prisma }))
        .equipment.generarGiai({ equipmentId: u });
      const r2 = await servicesEquipmentRouter
        .createCaller(makeCtx({ prisma }))
        .equipment.generarGiai({ equipmentId: u });

      expect(r1.giaiCode).toBe(r2.giaiCode);
      expect(r1.giaiCode).toBe("7410398AT777");
    });

    it("usa el prefijo de fallback cuando la org no tiene gs1CompanyPrefix configurado", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u, assetTag: "AT-5", giaiCode: null,
        name: "Monitor", manufacturer: null, model: null, serialNumber: null,
      } as never);
      prisma.organization.findUnique.mockResolvedValue({ gs1CompanyPrefix: null } as never);
      prisma.biomedicalEquipment.update.mockResolvedValue({ id: u } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.equipment.generarGiai({ equipmentId: u });
      expect(r.giaiCode).toBe("7503000AT5");
    });

    it("CONFLICT si el update dispara 23505 (carrera de asignación)", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u, assetTag: "AT-9", giaiCode: null,
        name: "Monitor", manufacturer: null, model: null, serialNumber: null,
      } as never);
      prisma.organization.findUnique.mockResolvedValue({ gs1CompanyPrefix: "7410398" } as never);
      prisma.biomedicalEquipment.update.mockRejectedValue({ code: "23505" } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.equipment.generarGiai({ equipmentId: u })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("BAD_REQUEST (no 500 genérico) si el assetTag no tiene caracteres alfanuméricos", async () => {
      prisma.biomedicalEquipment.findFirst.mockResolvedValue({
        id: u, assetTag: "---///", giaiCode: null,
        name: "Monitor", manufacturer: null, model: null, serialNumber: null,
      } as never);
      prisma.organization.findUnique.mockResolvedValue({ gs1CompanyPrefix: "7410398" } as never);
      const caller = servicesEquipmentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.equipment.generarGiai({ equipmentId: u })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(prisma.biomedicalEquipment.update).not.toHaveBeenCalled();
    });
  });
});
