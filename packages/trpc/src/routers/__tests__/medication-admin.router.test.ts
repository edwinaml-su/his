/**
 * Tests del medicationAdminRouter -- Beta.8 hardening layer 1.
 *
 * Cubre las 5 reglas:
 *   1. BCMA: 3 scans requeridos para ADMINISTERED.
 *   2. Doble-check para alto riesgo (requiresControlledLog / RX_CONTROLLED).
 *   3. Timing-window +-N min; override con reason auditado.
 *   4. State machine: INSERT acepta estados destino directos desde SCHEDULED.
 *   5. Cumulative qty: administeredQty + dose > prescribedQty rechazado.
 *
 * Mantiene cobertura de tests skeleton (tenant isolation, list, get).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import {
  medicationAdminRouter,
  isWithinTimingWindow,
} from "../medication-admin.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";

// -- Fixtures --

const normalDrug = {
  requiresControlledLog: false,
  dispensingClass: "RX" as const,
};

const highRiskDrug = {
  requiresControlledLog: true,
  dispensingClass: "RX_CONTROLLED" as const,
};

function makeItem(
  overrides: {
    drug?: typeof normalDrug;
    prescribedQty?: number;
    administeredQty?: number;
  } = {},
) {
  return {
    id: u,
    drug: overrides.drug ?? normalDrug,
    prescribedQty: overrides.prescribedQty ?? 0,
    administeredQty: overrides.administeredQty ?? 0,
  };
}

const bcmaComplete = {
  patientBarcodeScanned: true,
  drugBarcodeScanned: true,
  providerBadgeScanned: true,
  scannedAt: new Date(),
};

// -- Suite --

describe("medicationAdminRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // -- isWithinTimingWindow --
  describe("isWithinTimingWindow", () => {
    it("retorna true si la diferencia es exactamente igual al window", () => {
      const base = new Date("2026-05-13T08:00:00Z");
      const now = new Date("2026-05-13T08:30:00Z");
      expect(isWithinTimingWindow(base, now, 30)).toBe(true);
    });

    it("retorna false si la diferencia supera el window por 1ms", () => {
      const base = new Date("2026-05-13T08:00:00Z");
      const now = new Date(base.getTime() + 30 * 60 * 1000 + 1);
      expect(isWithinTimingWindow(base, now, 30)).toBe(false);
    });

    it("retorna true si la administracion es antes del horario (window negativo)", () => {
      const base = new Date("2026-05-13T08:00:00Z");
      const now = new Date("2026-05-13T07:45:00Z");
      expect(isWithinTimingWindow(base, now, 30)).toBe(true);
    });
  });

  // -- record --
  describe("record", () => {
    it("NOT_FOUND si item no pertenece a prescription firmada del tenant", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue(null as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.record({ prescriptionItemId: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("SCHEDULED sin scans se registra (status inicial valido)", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
      prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.record({ prescriptionItemId: u });
      const args = prisma.medicationAdministration.create.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("SCHEDULED");
    });

    // -- Regla 1: BCMA --
    describe("Regla 1 -- BCMA", () => {
      it("PRECONDITION_FAILED si status=ADMINISTERED y faltan scans", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await expect(
          caller.record({
            prescriptionItemId: u,
            status: "ADMINISTERED",
            patientBarcodeScanned: true,
            drugBarcodeScanned: false,
            providerBadgeScanned: true,
          }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      });

      it("PRECONDITION_FAILED si ningun scan fue hecho para ADMINISTERED", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await expect(
          caller.record({ prescriptionItemId: u, status: "ADMINISTERED" }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      });

      it("registra ADMINISTERED cuando los 3 scans estan completos", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await caller.record({
          prescriptionItemId: u,
          status: "ADMINISTERED",
          ...bcmaComplete,
        });
        const args = prisma.medicationAdministration.create.mock.calls[0]![0];
        expect((args.data as { status: string }).status).toBe("ADMINISTERED");
        expect((args.data as { patientBarcodeScanned: boolean }).patientBarcodeScanned).toBe(true);
        expect((args.data as { drugBarcodeScanned: boolean }).drugBarcodeScanned).toBe(true);
        expect((args.data as { providerBadgeScanned: boolean }).providerBadgeScanned).toBe(true);
      });
    });

    // -- Regla 2: Doble-check --
    describe("Regla 2 -- Doble-check alto riesgo", () => {
      it("PRECONDITION_FAILED si drug.requiresControlledLog y no hay secondVerifierId", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem({ drug: highRiskDrug }) as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await expect(
          caller.record({ prescriptionItemId: u, status: "ADMINISTERED", ...bcmaComplete }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      });

      it("BAD_REQUEST si secondVerifierId === administeredById", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem({ drug: highRiskDrug }) as never);
        const ctx = makeCtx({ prisma });
        const adminId = ctx.user!.id;
        const caller = medicationAdminRouter.createCaller(ctx);
        await expect(
          caller.record({
            prescriptionItemId: u,
            status: "ADMINISTERED",
            ...bcmaComplete,
            secondVerifierId: adminId,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      });

      it("registra ADMINISTERED con alto riesgo cuando secondVerifierId != administeredById", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem({ drug: highRiskDrug }) as never);
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await caller.record({
          prescriptionItemId: u,
          status: "ADMINISTERED",
          ...bcmaComplete,
          secondVerifierId: v,
        });
        const args = prisma.medicationAdministration.create.mock.calls[0]![0];
        expect((args.data as { secondVerifierId: string }).secondVerifierId).toBe(v);
      });
    });

    // -- Regla 3: Timing-window --
    describe("Regla 3 -- Timing-window", () => {
      it("PRECONDITION_FAILED si fuera de ventana sin overrideReason", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        const scheduledTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
        await expect(
          caller.record({
            prescriptionItemId: u,
            status: "ADMINISTERED",
            ...bcmaComplete,
            scheduledTime,
          }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      });

      it("acepta fuera de ventana si overrideReason esta presente", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        const scheduledTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
        await caller.record({
          prescriptionItemId: u,
          status: "ADMINISTERED",
          ...bcmaComplete,
          scheduledTime,
          overrideReason: "Paciente estaba en procedimiento de imagen urgente",
        });
        const args = prisma.medicationAdministration.create.mock.calls[0]![0];
        expect((args.data as { overrideReason: string }).overrideReason).toContain("procedimiento");
      });

      it("acepta ADMINISTERED dentro de la ventana sin overrideReason", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        const scheduledTime = new Date(Date.now() - 5 * 60 * 1000);
        await caller.record({
          prescriptionItemId: u,
          status: "ADMINISTERED",
          ...bcmaComplete,
          scheduledTime,
        });
        expect(prisma.medicationAdministration.create.mock.calls.length).toBe(1);
      });
    });

    // -- Regla 4: State machine --
    describe("Regla 4 -- State machine en INSERT", () => {
      it("acepta REFUSED directamente (enfermera registra rechazo)", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await caller.record({ prescriptionItemId: u, status: "REFUSED", notes: "Paciente rechazo" });
        const args = prisma.medicationAdministration.create.mock.calls[0]![0];
        expect((args.data as { status: string }).status).toBe("REFUSED");
      });

      it("acepta MISSED directamente (dosis no administrada)", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await caller.record({ prescriptionItemId: u, status: "MISSED" });
        const args = prisma.medicationAdministration.create.mock.calls[0]![0];
        expect((args.data as { status: string }).status).toBe("MISSED");
      });

      it("acepta HELD directamente (medicamento en espera clinica)", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await caller.record({ prescriptionItemId: u, status: "HELD" });
        const args = prisma.medicationAdministration.create.mock.calls[0]![0];
        expect((args.data as { status: string }).status).toBe("HELD");
      });

      it("DOCUMENTED_LATE legacy se permite (compatibilidad)", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await caller.record({ prescriptionItemId: u, status: "DOCUMENTED_LATE" });
        const args = prisma.medicationAdministration.create.mock.calls[0]![0];
        expect((args.data as { status: string }).status).toBe("DOCUMENTED_LATE");
      });

      it("GIVEN legacy se permite (compatibilidad)", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await caller.record({ prescriptionItemId: u, status: "GIVEN", patientWristbandScanned: true });
        const args = prisma.medicationAdministration.create.mock.calls[0]![0];
        expect((args.data as { status: string }).status).toBe("GIVEN");
      });
    });

    // -- Regla 5: Cumulative qty --
    describe("Regla 5 -- Cumulative qty", () => {
      it("PRECONDITION_FAILED si dose + administeredQty > prescribedQty", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(
          makeItem({ prescribedQty: 10, administeredQty: 8 }) as never,
        );
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await expect(
          caller.record({
            prescriptionItemId: u,
            status: "ADMINISTERED",
            ...bcmaComplete,
            doseAmount: 5,
          }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      });

      it("acepta si dose + administeredQty === prescribedQty (limite exacto)", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(
          makeItem({ prescribedQty: 10, administeredQty: 8 }) as never,
        );
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await caller.record({
          prescriptionItemId: u,
          status: "ADMINISTERED",
          ...bcmaComplete,
          doseAmount: 2,
        });
        expect(prisma.medicationAdministration.create.mock.calls.length).toBe(1);
      });

      it("acepta si prescribedQty = 0 (no configurado)", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(
          makeItem({ prescribedQty: 0, administeredQty: 0 }) as never,
        );
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await caller.record({
          prescriptionItemId: u,
          status: "ADMINISTERED",
          ...bcmaComplete,
          doseAmount: 99,
        });
        expect(prisma.medicationAdministration.create.mock.calls.length).toBe(1);
      });

      it("acepta qty excedida con overrideReason (bypass auditado)", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(
          makeItem({ prescribedQty: 10, administeredQty: 9 }) as never,
        );
        prisma.medicationAdministration.create.mockResolvedValue({ id: u } as never);
        const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
        await caller.record({
          prescriptionItemId: u,
          status: "ADMINISTERED",
          ...bcmaComplete,
          doseAmount: 5,
          overrideReason: "Orden medica verbal de dosis adicional de emergencia",
        });
        const args = prisma.medicationAdministration.create.mock.calls[0]![0];
        expect((args.data as { overrideReason: string }).overrideReason).toBeTruthy();
      });
    });

    // -- Legacy compatibility --
    describe("Campos legacy", () => {
      it("guarda doubleCheckById cuando se proporciona", async () => {
        prisma.prescriptionItem.findFirst.mockResolvedValue(makeItem() as never);
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
  });

  // -- list --
  describe("list", () => {
    it("filtra por organizationId y status", async () => {
      prisma.medicationAdministration.findMany.mockResolvedValue([] as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ status: "ADMINISTERED", administeredById: u, limit: 25 });
      const args = prisma.medicationAdministration.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBeTruthy();
      expect(args!.take).toBe(25);
    });

    it("aplica rango de fechas", async () => {
      prisma.medicationAdministration.findMany.mockResolvedValue([] as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ fromDate: new Date("2026-01-01"), toDate: new Date("2026-12-31") });
      const args = prisma.medicationAdministration.findMany.mock.calls[0]![0];
      const where = args!.where as { administeredAt?: { gte?: Date; lte?: Date } };
      expect(where.administeredAt?.gte).toBeInstanceOf(Date);
      expect(where.administeredAt?.lte).toBeInstanceOf(Date);
    });

    it("acepta filtro status SCHEDULED", async () => {
      prisma.medicationAdministration.findMany.mockResolvedValue([] as never);
      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ status: "SCHEDULED" });
      const args = prisma.medicationAdministration.findMany.mock.calls[0]![0];
      expect((args!.where as { status?: string }).status).toBe("SCHEDULED");
    });
  });

  // -- get --
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
      await expect(caller.get({ id: u })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
