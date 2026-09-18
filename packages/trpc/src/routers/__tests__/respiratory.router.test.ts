/**
 * Tests del respiratoryRouter (§21 — Wave 8 / Beta.12 hardening layer 1).
 *
 * Beta.12 coverage:
 *   - order.create sets expiresAt = now()+24h.
 *   - order.renew updates renewedAt + expiresAt.
 *   - order.getExpired returns orders past expiry.
 *   - ventilator.create rejects params outside safe ranges.
 *   - ventilator.transition enforces state-machine graph.
 *   - MedicalGasUsage: no update/delete mutations exposed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { MOCK_TENANT } from "@his/test-utils";

// CC-0042 — capturarCargo tiene su propia suite (charge-capture.test.ts);
// aquí solo importa que sesion.ejecutar lo invoque con origen
// TERAPIA_RESPIRATORIA y que crear NO lo invoque (RN-TR-24).
const capturarCargoMock = vi.fn().mockResolvedValue({
  cargoId: "cargo-tr",
  status: "VIGENTE",
  unitPrice: 20.15,
});
vi.mock("../../lib/charge-capture", () => ({
  capturarCargo: (...args: unknown[]) => capturarCargoMock(...args),
  revertirCargo: vi.fn(),
}));

import { respiratoryRouter } from "../respiratory.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";

describe("respiratoryRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  // -------------------------------------------------------------------------
  // order.create
  // -------------------------------------------------------------------------

  describe("order.create", () => {
    it("NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          prescriberId: u,
          type: "OXYGEN_THERAPY",
          flowRate: 3,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si patientId no coincide", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: v } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          prescriberId: u,
          type: "AEROSOL",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("OK crea orden con expiresAt = now()+24h (Beta.12)", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.respiratoryOrder.create.mockResolvedValue({ id: u } as never);
      const before = Date.now();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        type: "MECHANICAL_VENT",
        fio2: 40,
      });
      expect(r.id).toBe(u);
      const data = prisma.respiratoryOrder.create.mock.calls[0]![0]!.data as {
        expiresAt: Date;
      };
      const delta = data.expiresAt.getTime() - before;
      expect(delta).toBeGreaterThan(23 * 3600 * 1000);
      expect(delta).toBeLessThan(25 * 3600 * 1000);
    });

    it("OK acepta expiresAt explícito (Beta.12)", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.respiratoryOrder.create.mockResolvedValue({ id: u } as never);
      const custom = new Date("2026-05-20T12:00:00Z");
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        type: "OXYGEN_THERAPY",
        expiresAt: custom,
      });
      const data = prisma.respiratoryOrder.create.mock.calls[0]![0]!.data as {
        expiresAt: Date;
      };
      expect(data.expiresAt).toEqual(custom);
    });
  });

  // -------------------------------------------------------------------------
  // order.list / get / complete / cancel
  // -------------------------------------------------------------------------

  describe("order.list / get / complete / cancel", () => {
    it("list filtra por organizationId", async () => {
      prisma.respiratoryOrder.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.list({ limit: 50 });
      const where = prisma.respiratoryOrder.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
      };
      expect(where.organizationId).toBeTruthy();
    });

    it("get NOT_FOUND", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("complete NOT_FOUND si ya cerrada", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.complete({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("complete OK setea status=COMPLETED + endedAt", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.complete({ id: u });
      const data = prisma.respiratoryOrder.updateMany.mock.calls[0]![0]!.data as {
        status: string;
        endedAt: Date;
      };
      expect(data.status).toBe("COMPLETED");
      expect(data.endedAt).toBeInstanceOf(Date);
    });

    it("cancel OK setea CANCELLED", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.cancel({ id: u });
      const data = prisma.respiratoryOrder.updateMany.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(data.status).toBe("CANCELLED");
    });
  });

  // -------------------------------------------------------------------------
  // order.renew (Beta.12)
  // -------------------------------------------------------------------------

  describe("order.renew (Beta.12)", () => {
    it("renew NOT_FOUND si orden no activa", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.renew({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("renew OK setea renewedAt y expiresAt +24h", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const before = Date.now();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.order.renew({ id: u });
      expect(r.ok).toBe(true);
      const data = prisma.respiratoryOrder.updateMany.mock.calls[0]![0]!.data as {
        renewedAt: Date;
        expiresAt: Date;
      };
      expect(data.renewedAt).toBeInstanceOf(Date);
      expect(data.expiresAt).toBeInstanceOf(Date);
      const delta = data.expiresAt.getTime() - before;
      expect(delta).toBeGreaterThan(23 * 3600 * 1000);
      expect(delta).toBeLessThan(25 * 3600 * 1000);
    });

    it("renew filtra status=ACTIVE", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.renew({ id: u });
      const where = prisma.respiratoryOrder.updateMany.mock.calls[0]![0]!.where as {
        status: string;
      };
      expect(where.status).toBe("ACTIVE");
    });
  });

  // -------------------------------------------------------------------------
  // order.getExpired (Beta.12)
  // -------------------------------------------------------------------------

  describe("order.getExpired (Beta.12)", () => {
    it("retorna resultados con where correctos", async () => {
      prisma.respiratoryOrder.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const asOf = new Date("2026-05-13T10:00:00Z");
      await caller.order.getExpired({ asOf, limit: 10 });
      const where = prisma.respiratoryOrder.findMany.mock.calls[0]![0]!.where as {
        status: string;
        expiresAt: { lt: Date };
      };
      expect(where.status).toBe("ACTIVE");
      expect(where.expiresAt.lt).toEqual(asOf);
    });

    it("usa now() cuando asOf no se provee", async () => {
      prisma.respiratoryOrder.findMany.mockResolvedValue([] as never);
      const before = Date.now();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.getExpired({ limit: 5 });
      const where = prisma.respiratoryOrder.findMany.mock.calls[0]![0]!.where as {
        expiresAt: { lt: Date };
      };
      expect(where.expiresAt.lt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // ventilator.create / end / list
  // -------------------------------------------------------------------------

  describe("ventilator.create / end / list", () => {
    it("create BAD_REQUEST si PEEP fuera de rango (Beta.12)", async () => {
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({ orderId: u, mode: "AC", peep: 25 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create BAD_REQUEST si FiO2 fuera de rango (Beta.12)", async () => {
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({ orderId: u, mode: "AC", fio2: 1.2 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create BAD_REQUEST si RR fuera de rango (Beta.12)", async () => {
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({ orderId: u, mode: "PSV", rrSet: 5 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create BAD_REQUEST si Vt fuera de rango (Beta.12)", async () => {
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({ orderId: u, mode: "AC", tidalVolume: 30 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create NOT_FOUND si orden no es MECHANICAL_VENT activa", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({ orderId: u, mode: "AC", tidalVolume: 450, peep: 8, fio2: 0.4, rrSet: 14 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK persiste params en rango", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.ventilatorSession.create.mockResolvedValue({ id: u } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.create({
        orderId: u,
        mode: "SIMV",
        rrSet: 14,
        peep: 8,
        fio2: 0.35,
        tidalVolume: 500,
        patientWeightKg: 70,
      });
      expect(r.id).toBe(u);
    });

    it("end NOT_FOUND si ya finalizada", async () => {
      prisma.ventilatorSession.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.ventilator.end({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("end OK setea endedAt", async () => {
      prisma.ventilatorSession.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.end({ id: u });
      expect(r.ok).toBe(true);
    });

    it("list filtra por order.organizationId", async () => {
      prisma.ventilatorSession.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.ventilator.list({ limit: 50 });
      const where = prisma.ventilatorSession.findMany.mock.calls[0]![0]!.where as {
        order: { organizationId: string };
      };
      expect(where.order.organizationId).toBeTruthy();
    });

    it("list filtra por statusSM (Beta.12)", async () => {
      prisma.ventilatorSession.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.ventilator.list({ statusSM: "WEANING", limit: 10 });
      const where = prisma.ventilatorSession.findMany.mock.calls[0]![0]!.where as {
        statusSM: string;
      };
      expect(where.statusSM).toBe("WEANING");
    });
  });

  // -------------------------------------------------------------------------
  // ventilator.transition (Beta.12)
  // -------------------------------------------------------------------------

  describe("ventilator.transition (Beta.12)", () => {
    it("NOT_FOUND si sesión no existe", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.transition({ id: u, to: "WEANING" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si sesión ya finalizada", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "ACTIVE",
        endedAt: new Date(),
      } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.transition({ id: u, to: "WEANING" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("BAD_REQUEST en transición ilegal ACTIVE→EXTUBATED", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "ACTIVE",
        endedAt: null,
      } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.transition({ id: u, to: "EXTUBATED" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("BAD_REQUEST en transición ilegal EXTUBATED→ACTIVE", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "EXTUBATED",
        endedAt: null,
      } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.transition({ id: u, to: "ACTIVE" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("OK transición válida ACTIVE→WEANING", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "ACTIVE",
        endedAt: null,
      } as never);
      prisma.ventilatorSession.update.mockResolvedValue({ id: u, statusSM: "WEANING" } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.transition({ id: u, to: "WEANING" });
      expect((r as { statusSM: string }).statusSM).toBe("WEANING");
    });

    it("OK transición válida WEANING→ESCALATED", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "WEANING",
        endedAt: null,
      } as never);
      prisma.ventilatorSession.update.mockResolvedValue({ id: u, statusSM: "ESCALATED" } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.transition({ id: u, to: "ESCALATED" });
      expect((r as { statusSM: string }).statusSM).toBe("ESCALATED");
    });

    it("OK transición válida WEANING→FAILED_EXTUBATION", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "WEANING",
        endedAt: null,
      } as never);
      prisma.ventilatorSession.update.mockResolvedValue({
        id: u,
        statusSM: "FAILED_EXTUBATION",
      } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.transition({ id: u, to: "FAILED_EXTUBATION" });
      expect((r as { statusSM: string }).statusSM).toBe("FAILED_EXTUBATION");
    });

    it("OK transición válida ESCALATED→ACTIVE (deterioro)", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "ESCALATED",
        endedAt: null,
      } as never);
      prisma.ventilatorSession.update.mockResolvedValue({ id: u, statusSM: "ACTIVE" } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.transition({ id: u, to: "ACTIVE" });
      expect((r as { statusSM: string }).statusSM).toBe("ACTIVE");
    });
  });

  // -------------------------------------------------------------------------
  // gas.create / list
  // -------------------------------------------------------------------------

  describe("gas.create / list", () => {
    it("create NOT_FOUND si orden no es del tenant", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.gas.create({ orderId: u, gasType: "O2", volumeLiters: 100 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK setea recordedById", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.medicalGasUsage.create.mockResolvedValue({ id: u } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.gas.create({
        orderId: u,
        gasType: "O2",
        volumeLiters: 250.5,
      });
      const data = prisma.medicalGasUsage.create.mock.calls[0]![0]!.data as {
        gasType: string;
        recordedById: string;
      };
      expect(data.gasType).toBe("O2");
      expect(data.recordedById).toBeTruthy();
    });

    it("list filtra por gasType y fechas", async () => {
      prisma.medicalGasUsage.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.gas.list({
        gasType: "O2",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
        limit: 100,
      });
      const where = prisma.medicalGasUsage.findMany.mock.calls[0]![0]!.where as {
        gasType: string;
        measuredAt: { gte: Date; lte: Date };
      };
      expect(where.gasType).toBe("O2");
      expect(where.measuredAt.gte).toBeInstanceOf(Date);
    });
  });

  // ---------------------------------------------------------------------------
  // CC-0042 — CPOE-TR (orden, sesión con cargo al ejecutar, SLA, configuración)
  // ---------------------------------------------------------------------------

  describe("tr (CC-0042)", () => {
    const CUENTA = { id: u, patientId: v, encounterId: u };
    const AER_CFG = {
      hint: "jet",
      meds: ["ipratropio", "salbutamol"],
      unidades: ["mg", "µg", "g", "mL"],
      diluyentes: ["Solución salina normal 0.9 % · 4 mL", "Sin diluyente"],
      diluyenteDefault: 0,
      extra: { label: "Flujo impulsor de oxígeno", opciones: ["6 L/min"], default: 0 },
    };
    const PROCS = [
      proc("TR-OXI-01", "Inicio de oxigenoterapia de bajo flujo", 1, { pareoCon: "TR-OXI-02" }),
      proc("TR-OXI-02", "Supervisión y cuidado de O₂ bajo flujo", 1),
      proc("TR-OXI-03", "Inicio de oxigenoterapia de alto flujo", 1, { pareoCon: "TR-OXI-04" }),
      proc("TR-OXI-04", "Supervisión y cuidado de O₂ alto flujo", 1),
      proc("TR-AER-01", "Nebulización convencional (jet)", 2, { aerosolConfig: AER_CFG }),
      proc("TR-AER-05", "Educación de técnica inhalatoria", 2),
      proc("TR-FIS-03", "Espirómetro incentivo", 3),
    ];
    const MEDS = [
      {
        id: "m1",
        organizationId: null,
        clave: "ipratropio",
        nombre: "Bromuro de ipratropio («Tropium») — solución 0.25 mg/mL",
        unidadBase: "mg",
        dosisMin: 0.25,
        dosisMax: 0.5,
        dosisDefault: 0.5,
        altoRiesgo: false,
        precaucion: false,
        mensaje: "x",
        displayOrder: 1,
        activo: true,
      },
      {
        id: "m2",
        organizationId: null,
        clave: "salbutamol",
        nombre: "Salbutamol — solución 5 mg/mL",
        unidadBase: "mg",
        dosisMin: 2.5,
        dosisMax: 5,
        dosisDefault: 2.5,
        altoRiesgo: false,
        precaucion: false,
        mensaje: "x",
        displayOrder: 2,
        activo: true,
      },
    ];

    function proc(
      codigo: string,
      nombre: string,
      seccionOrden: number,
      extra: Partial<Record<string, unknown>> = {},
    ) {
      return {
        id: `p-${codigo}`,
        organizationId: null,
        codigo,
        nombre,
        categoria: "x",
        seccionOrden,
        subSeccion: null,
        unidadCobro: "Evento",
        requiereConsentimiento: false,
        delegablePorProtocolo: false,
        pareoCon: null,
        tiempoEstandarMin: null,
        tarifaBase: null,
        aerosolConfig: null,
        displayOrder: 0,
        activo: true,
        ...extra,
      };
    }

    function stubCrear() {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA as never);
      prisma.trProcedimiento.findMany.mockResolvedValue(PROCS as never);
      prisma.trMedicamentoInhalado.findMany.mockResolvedValue(MEDS as never);
      prisma.trSlaConfig.findMany.mockResolvedValue([] as never);
      prisma.serviceUnit.findFirst.mockResolvedValue(null as never);
      prisma.respiratoryOrder.create.mockResolvedValue({ id: u } as never);
      prisma.respiratoryOrderItem.create.mockResolvedValue({ id: v } as never);
      prisma.careTask.create.mockResolvedValue({ id: u } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: u } as never);
      capturarCargoMock.mockClear();
    }

    const baseInput = {
      cuentaId: u,
      dxCodigo: "CA22.0",
      dxDescripcion: "EPOC con exacerbación aguda",
      prioridad: "URGENT" as const,
      vigenciaHoras: 72,
      declaraciones: {
        oxigenoterapia: "SELECCIONADA" as const,
        aerosolterapia: "NO_REQUIERE" as const,
        seccion3: "NO_REQUIERE" as const,
      },
      meta: { tipo: "88-92" as const },
      items: [{ codigo: "TR-OXI-01" }],
    };

    const soloAer = (medicamento?: Record<string, unknown>) => ({
      ...baseInput,
      declaraciones: {
        oxigenoterapia: "NO_REQUIERE" as const,
        aerosolterapia: "SELECCIONADA" as const,
        seccion3: "NO_REQUIERE" as const,
      },
      meta: undefined,
      items: [{ codigo: "TR-AER-01", ...(medicamento ? { medicamento } : {}) }],
    });

    const MED_OK = {
      clave: "ipratropio",
      dosis: 0.5,
      unidad: "mg",
      diluyente: "Solución salina normal 0.9 % · 4 mL",
      frecuencia: "Cada 6 horas",
    };

    it("RN-TR-33: pareo automático — TR-OXI-01 agrega TR-OXI-02 y crea una CareTask por sesión SIN cargo", async () => {
      stubCrear();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.tr.orden.crear(baseInput);

      expect(r.items.map((i) => i.codigo).sort()).toEqual(["TR-OXI-01", "TR-OXI-02"]);
      expect(prisma.respiratoryOrderItem.create).toHaveBeenCalledTimes(2);
      expect(prisma.careTask.create).toHaveBeenCalledTimes(2);
      const tarea = prisma.careTask.create.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(tarea.data).toMatchObject({
        sourceType: "TR_ORDEN_ITEM",
        assignedRoleCode: "RESP_THERAPIST",
        taskType: "TR_EJECUTAR",
        priority: "HIGH",
        slaMinutes: 60, // default TR para URGENT (parametrizable en TrSlaConfig)
        status: "PENDIENTE",
      });
      // RN-TR-24 — el cargo NUNCA nace al firmar la orden.
      expect(capturarCargoMock).not.toHaveBeenCalled();
      const orden = prisma.respiratoryOrder.create.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(orden.data).toMatchObject({
        esCpoeTr: true,
        dxCodigo: "CA22.0",
        metaSaturacion: "88-92",
        type: "OXYGEN_THERAPY",
      });
    });

    it("RN-TR-33: bajo flujo y alto flujo juntos ⇒ BAD_REQUEST (selección única)", async () => {
      stubCrear();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.tr.orden.crear({ ...baseInput, items: [{ codigo: "TR-OXI-01" }, { codigo: "TR-OXI-03" }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("RN-TR-32/35: sección declarada SELECCIONADA sin procedimientos ⇒ BAD_REQUEST", async () => {
      stubCrear();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.tr.orden.crear({ ...baseInput, items: [] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Oxigenoterapia"),
      });
    });

    it("meta obligatoria con oxigenoterapia; OTRO exige rango 70–100 y justificación ≥15 (RN-TR-34)", async () => {
      stubCrear();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.tr.orden.crear({ ...baseInput, meta: undefined })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("meta de saturación"),
      });
      await expect(
        caller.tr.orden.crear({
          ...baseInput,
          meta: { tipo: "OTRO", min: 90, max: 94, justificacion: "corta" },
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("justificación clínica"),
      });
    });

    it("RN-TR-36: la unidad «g» se rechaza con el mensaje clínico (incidente Tropium 0.5 g)", async () => {
      stubCrear();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.tr.orden.crear(soloAer({ ...MED_OK, unidad: "g" })),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Use miligramos o microgramos"),
      });
    });

    it("RN-TR-36: dosis > 2× máximo bloquea; diluyente fuera de la lista cerrada bloquea; AER-05 no admite medicamento", async () => {
      stubCrear();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.tr.orden.crear(soloAer({ ...MED_OK, dosis: 1.1 })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("por encima del máximo") });
      await expect(
        caller.tr.orden.crear(soloAer({ ...MED_OK, diluyente: "Agua de coco" })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("lista parametrizada") });
      await expect(
        caller.tr.orden.crear({
          ...soloAer(),
          items: [{ codigo: "TR-AER-05", medicamento: MED_OK }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("no admite bloque de medicamento") });
    });

    it("dosis en µg equivalente dentro de rango pasa (500 µg de ipratropio)", async () => {
      stubCrear();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.tr.orden.crear(soloAer({ ...MED_OK, dosis: 500, unidad: "µg" })),
      ).resolves.toBeDefined();
      const item = prisma.respiratoryOrderItem.create.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(item.data).toMatchObject({ procedimientoCodigo: "TR-AER-01" });
      expect((item.data.medicamento as { dosis: number }).dosis).toBe(500);
    });

    describe("sesion.ejecutar (RN-TR-24 — cargo al ejecutar)", () => {
      const ITEM = {
        id: v,
        estado: "PROGRAMADA",
        procedimientoCodigo: "TR-AER-01",
        procedimientoNombre: "Nebulización convencional (jet)",
        order: { id: u, patientId: v, encounterId: u, patientAccountId: u, status: "ACTIVE" },
      };

      it("EJECUTADA ⇒ capturarCargo origen TERAPIA_RESPIRATORIA + tarea CUMPLIDA", async () => {
        capturarCargoMock.mockClear();
        prisma.respiratoryOrderItem.findFirst.mockResolvedValue(ITEM as never);
        prisma.respiratoryOrderItem.update.mockResolvedValue({ id: v } as never);
        prisma.careTask.updateMany.mockResolvedValue({ count: 1 } as never);
        const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
        const r = await caller.tr.sesion.ejecutar({ itemId: v, resultado: "EJECUTADA" });

        expect(r.cargoStatus).toBe("VIGENTE");
        expect(r.unitPrice).toBe(20.15);
        expect(capturarCargoMock).toHaveBeenCalledWith(
          prisma,
          expect.objectContaining({
            origen: "TERAPIA_RESPIRATORIA",
            code: "TR-AER-01",
            quantity: 1,
            accountId: u,
            referenciaId: v,
          }),
        );
        const upd = prisma.respiratoryOrderItem.update.mock.calls[0]![0] as { data: Record<string, unknown> };
        expect(upd.data).toMatchObject({ estado: "EJECUTADA", cargoId: "cargo-tr" });
        const tarea = prisma.careTask.updateMany.mock.calls[0]![0] as {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        };
        expect(tarea.where).toMatchObject({ sourceType: "TR_ORDEN_ITEM", sourceId: v });
        expect(tarea.data).toMatchObject({ status: "CUMPLIDA" });
      });

      it("NO_EJECUTADA ⇒ SIN cargo, causa obligatoria, tarea CANCELADA", async () => {
        capturarCargoMock.mockClear();
        prisma.respiratoryOrderItem.findFirst.mockResolvedValue(ITEM as never);
        prisma.respiratoryOrderItem.update.mockResolvedValue({ id: v } as never);
        prisma.careTask.updateMany.mockResolvedValue({ count: 1 } as never);
        const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
        await caller.tr.sesion.ejecutar({
          itemId: v,
          resultado: "NO_EJECUTADA",
          causaNoEjecucion: "Paciente en estudio de imagen",
        });
        expect(capturarCargoMock).not.toHaveBeenCalled();
        const tarea = prisma.careTask.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
        expect(tarea.data).toMatchObject({
          status: "CANCELADA",
          cancelReason: "Paciente en estudio de imagen",
        });
      });

      it("sesión ya cerrada ⇒ CONFLICT", async () => {
        prisma.respiratoryOrderItem.findFirst.mockResolvedValue({ ...ITEM, estado: "EJECUTADA" } as never);
        const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
        await expect(
          caller.tr.sesion.ejecutar({ itemId: v, resultado: "EJECUTADA" }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      });
    });

    it("sla.list retorna defaults TR (STAT 15') y upsert exige ADMIN/DIR", async () => {
      prisma.trSlaConfig.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const rows = await caller.tr.sla.list();
      expect(rows.find((r) => r.priority === "STAT")).toMatchObject({ slaMinutes: 15, esDefault: true });

      const sinAdmin = respiratoryRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] } }),
      );
      await expect(
        sinAdmin.tr.sla.upsert({ priority: "STAT", slaMinutes: 10, warningMinutes: 3 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("configuración: editar una fila GLOBAL materializa el override del tenant (tarifa base)", async () => {
      const fila = {
        ...proc("TR-AER-01", "Nebulización convencional (jet)", 2, { aerosolConfig: AER_CFG }),
        id: "00000000-0000-0000-0000-00000000aa01",
      };
      prisma.trProcedimiento.findFirst.mockResolvedValue(fila as never);
      prisma.trProcedimiento.create.mockResolvedValue({ ...fila, id: "nuevo" } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.tr.catalogo.updateProcedimiento({ id: fila.id, tarifaBase: 20.15 });

      expect(prisma.trProcedimiento.update).not.toHaveBeenCalled();
      const creado = prisma.trProcedimiento.create.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(creado.data).toMatchObject({
        codigo: "TR-AER-01",
        tarifaBase: 20.15,
        organizationId: MOCK_TENANT.organizationId,
      });
    });

    it("supervisión: sesión PROGRAMADA vieja ⇒ VENCIDO con SLA default", async () => {
      prisma.respiratoryOrderItem.findMany.mockResolvedValue([
        {
          id: v,
          orderId: u,
          procedimientoCodigo: "TR-AER-01",
          procedimientoNombre: "Nebulización convencional (jet)",
          medicamento: null,
          estado: "PROGRAMADA",
          ejecutadaEn: null,
          causaNoEjecucion: null,
          cargoId: null,
          order: {
            id: u,
            prioridad: "ROUTINE",
            startedAt: new Date(Date.now() - 500 * 60_000),
            encounterId: null,
            dxCodigo: "CA22.0",
            patient: { firstName: "Ana", lastName: "Cruz", expediente: "EXP-1", mrn: "M1" },
          },
        },
      ] as never);
      prisma.respiratoryOrder.findMany.mockResolvedValue([{ id: u, patientAccountId: null }] as never);
      prisma.patientAccount.findMany.mockResolvedValue([] as never);
      prisma.careTask.findMany.mockResolvedValue([] as never);
      prisma.trSlaConfig.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const res = await caller.tr.supervision({ incluirCompletados: true, limit: 200 });
      expect(res.rows[0]).toMatchObject({
        slaEstado: "VENCIDO",
        estado: "PROGRAMADA",
        atencion: "AMBULATORIO",
      });
      expect(res.kpis.vencidas).toBe(1);
    });
  });
});
