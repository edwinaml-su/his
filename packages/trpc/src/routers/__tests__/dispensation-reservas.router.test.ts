/**
 * Tests: dispensationRouter — procedures de reserva consolidados (US.F2.6.8-9).
 *
 * Migrado desde pharmacy-dispensation.router.test.ts (PR #581): el router
 * pharmacy-dispensation fue absorbido por pharmacy/dispensation.router.ts,
 * que es el canónico porque tiene la validación de inventario R07.
 *
 * US.F2.6.8 — Reserva lógica:
 *   - Alta: crea PharmacyReservation RESERVED con expiresAt=now()+4h.
 *   - SIN_RECETA_ACTIVA si la receta no existe / no es dispensable (nuevo).
 *   - Idempotencia: mismo serial + mismo paciente devuelve la reserva existente.
 *   - Hard Stop: serial ya RESERVED por otro paciente → CONFLICT.
 *   - R07: hard stop de inventario + descuento atómico (nuevo, PR #581).
 *   - Cancelación: cambia status → CANCELLED + repone stock descontado.
 *   - Cancelación: NOT_FOUND si reserva no existe o ya está CANCELLED.
 *
 * US.F2.6.9 — Detección de duplicados:
 *   - Nunca dispensado → allowed=true.
 *   - Dispensado dentro de ventana → allowed=false + reason.
 *   - Dispensado fuera de ventana → allowed=true.
 *   - Frecuencia PRN → allowed=true (sin Hard Stop de ventana).
 *   - Ítem no encontrado → NOT_FOUND.
 *
 * orderDetail — datos de receta para la estación de despacho.
 *
 * Mocks:
 *   - PrismaClient via vitest-mock-extended.
 *   - $transaction delegado al mismo mock (inline).
 *   - vitest.setSystemTime para control de fecha en tests de ventana.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { makeCtx } from "../../__tests__/helpers/caller";

// Mock @his/database para que emitDomainEvent sea un no-op en tests
vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "event-id" }),
  };
});

import { dispensationRouter } from "../pharmacy/dispensation.router";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// MOCK_TENANT.organizationId / establishmentId (desde test-utils)
const ORG = "00000000-0000-0000-0000-0000000000aa";
const ESTABLISHMENT = "00000000-0000-0000-0000-0000000000cc";
const PATIENT = "00000000-0000-0000-0000-000000000003";
const ORDER = "00000000-0000-0000-0000-000000000004";
const ITEM = "00000000-0000-0000-0000-000000000005";
const RES = "00000000-0000-0000-0000-000000000006";
const OTHER_PATIENT = "00000000-0000-0000-0000-000000000007";
const STOCK_ITEM_ID = "00000000-0000-0000-0000-0000000000e1";
const STOCK_LOT_ID = "00000000-0000-0000-0000-0000000000e2";

const GTIN = "07501000001234"; // 14 dígitos
const LOTE = "L2024A";
const SERIE = "21000001";

function makeReservation(overrides: Partial<{
  id: string;
  status: string;
  patientId: string;
  expiresAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? RES,
    organizationId: ORG,
    pharmacyOrderId: ORDER,
    patientId: overrides.patientId ?? PATIENT,
    gtin: GTIN,
    lote: LOTE,
    serie: SERIE,
    status: overrides.status ?? "RESERVED",
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 4 * 60 * 60 * 1000),
    cancelMotivo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
describe("dispensationRouter — reservas consolidadas", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // Delegar $transaction al mismo mock para que withTenantContext funcione
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") {
        return (cb as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return cb;
    });
    // emitDomainEvent usa $executeRawUnsafe y tablas de outbox; no-op en tests
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
    // reserveItem exige receta dispensable (Paso 0) — default: existe
    prisma.prescription.findFirst.mockResolvedValue({ id: ORDER } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // US.F2.6.8 — reserveItem
  // -------------------------------------------------------------------------
  describe("reserveItem", () => {
    it("crea reserva RESERVED cuando el serial no está tomado", async () => {
      prisma.pharmacyReservation.findFirst.mockResolvedValue(null as never);
      prisma.pharmacyReservation.create.mockResolvedValue(
        makeReservation() as never,
      );

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.reserveItem({
        pharmacyOrderId: ORDER,
        gtin: GTIN,
        lote: LOTE,
        serie: SERIE,
        patientId: PATIENT,
      });

      expect(result.status).toBe("RESERVED");
      expect(prisma.pharmacyReservation.create).toHaveBeenCalledOnce();

      const createArg =
        prisma.pharmacyReservation.create.mock.calls[0]![0].data;
      expect(createArg.organizationId).toBe(ORG);
      expect(createArg.gtin).toBe(GTIN);
      expect(createArg.status).toBe("RESERVED");

      // expiresAt debe ser ~4h en el futuro (±60s de tolerancia en test)
      const exp = new Date(createArg.expiresAt as Date).getTime();
      expect(exp).toBeGreaterThan(Date.now() + 3 * 60 * 60 * 1000);
    });

    it("Hard Stop SIN_RECETA_ACTIVA cuando la receta no existe o no es dispensable", async () => {
      prisma.prescription.findFirst.mockResolvedValue(null as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.reserveItem({
          pharmacyOrderId: ORDER,
          gtin: GTIN,
          lote: LOTE,
          serie: SERIE,
          patientId: PATIENT,
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "SIN_RECETA_ACTIVA",
      });

      expect(prisma.pharmacyReservation.create).not.toHaveBeenCalled();
    });

    it("Hard Stop CONFLICT cuando el serial ya está RESERVED por OTRO paciente", async () => {
      prisma.pharmacyReservation.findFirst.mockResolvedValue(
        makeReservation({ patientId: OTHER_PATIENT }) as never,
      );

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.reserveItem({
          pharmacyOrderId: ORDER,
          gtin: GTIN,
          lote: LOTE,
          serie: SERIE,
          patientId: PATIENT,
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "SERIAL_YA_RESERVADO_OTRO_PACIENTE",
      });

      expect(prisma.pharmacyReservation.create).not.toHaveBeenCalled();
    });

    it("idempotente: devuelve reserva existente si mismo paciente + mismo serial RESERVED (sin re-descontar stock)", async () => {
      const existing = makeReservation({ patientId: PATIENT });
      prisma.pharmacyReservation.findFirst.mockResolvedValue(
        existing as never,
      );
      prisma.pharmacyReservation.findUniqueOrThrow.mockResolvedValue(
        existing as never,
      );

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.reserveItem({
        pharmacyOrderId: ORDER,
        gtin: GTIN,
        lote: LOTE,
        serie: SERIE,
        patientId: PATIENT,
      });

      expect(result.id).toBe(RES);
      expect(prisma.pharmacyReservation.create).not.toHaveBeenCalled();
      expect(prisma.stockLot.updateMany).not.toHaveBeenCalled();
    });

    it("sin número de serie: omite el check UNIQUE (serie=null) y crea directamente", async () => {
      // Sin serie → no ejecuta findFirst de serial (no hay UNIQUE constraint para null)
      prisma.pharmacyReservation.create.mockResolvedValue(
        makeReservation({ id: "new-id" }) as never,
      );

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      await caller.reserveItem({
        pharmacyOrderId: ORDER,
        gtin: GTIN,
        lote: LOTE,
        // serie omitida
        patientId: PATIENT,
      });

      // findFirst de reserva NO debe haberse llamado (sin serie no hay check de conflicto)
      expect(prisma.pharmacyReservation.findFirst).not.toHaveBeenCalled();
      expect(prisma.pharmacyReservation.create).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // R07 — hard stop de inventario en reserveItem (PR #581)
  // -------------------------------------------------------------------------
  describe("reserveItem — R07 validación de inventario", () => {
    beforeEach(() => {
      prisma.pharmacyReservation.findFirst.mockResolvedValue(null as never);
      prisma.pharmacyReservation.create.mockResolvedValue(
        makeReservation() as never,
      );
    });

    it("reserva sin bloquear cuando el GTIN no tiene StockItem (catálogo sin cargar)", async () => {
      prisma.stockItem.findFirst.mockResolvedValue(null as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.reserveItem({
        pharmacyOrderId: ORDER,
        gtin: GTIN,
        lote: LOTE,
        serie: SERIE,
        patientId: PATIENT,
      });

      expect(result.status).toBe("RESERVED");
      expect(prisma.stockLot.updateMany).not.toHaveBeenCalled();
    });

    it("Hard Stop LOTE_NO_EXISTE_EN_INVENTARIO cuando el lote nunca ingresó a la bodega", async () => {
      prisma.stockItem.findFirst.mockResolvedValue({ id: STOCK_ITEM_ID } as never);
      prisma.stockLot.findFirst.mockResolvedValue(null as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.reserveItem({
          pharmacyOrderId: ORDER,
          gtin: GTIN,
          lote: "L-FANTASMA",
          serie: SERIE,
          patientId: PATIENT,
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "LOTE_NO_EXISTE_EN_INVENTARIO",
      });
    });

    it("Hard Stop LOTE_NO_DISPONIBLE_INVENTARIO cuando el lote está en cuarentena/recall", async () => {
      prisma.stockItem.findFirst.mockResolvedValue({ id: STOCK_ITEM_ID } as never);
      prisma.stockLot.findFirst.mockResolvedValue({
        id: STOCK_LOT_ID,
        qualityStatus: "QUARANTINE",
      } as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.reserveItem({
          pharmacyOrderId: ORDER,
          gtin: GTIN,
          lote: LOTE,
          serie: SERIE,
          patientId: PATIENT,
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "LOTE_NO_DISPONIBLE_INVENTARIO",
      });
      expect(prisma.stockLot.updateMany).not.toHaveBeenCalled();
    });

    it("Hard Stop STOCK_INSUFICIENTE cuando quantityOnHand < 1 (updateMany no afecta filas)", async () => {
      prisma.stockItem.findFirst.mockResolvedValue({ id: STOCK_ITEM_ID } as never);
      prisma.stockLot.findFirst.mockResolvedValue({
        id: STOCK_LOT_ID,
        qualityStatus: "AVAILABLE",
      } as never);
      prisma.stockLot.updateMany.mockResolvedValue({ count: 0 } as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.reserveItem({
          pharmacyOrderId: ORDER,
          gtin: GTIN,
          lote: LOTE,
          serie: SERIE,
          patientId: PATIENT,
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "STOCK_INSUFICIENTE",
      });
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it("happy path — descuenta 1 unidad y registra StockMovement OUT con referenceCode = reserva", async () => {
      prisma.stockItem.findFirst.mockResolvedValue({ id: STOCK_ITEM_ID } as never);
      prisma.stockLot.findFirst.mockResolvedValue({
        id: STOCK_LOT_ID,
        qualityStatus: "AVAILABLE",
      } as never);
      prisma.stockLot.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.stockMovement.create.mockResolvedValue({ id: "mov-1" } as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.reserveItem({
        pharmacyOrderId: ORDER,
        gtin: GTIN,
        lote: LOTE,
        serie: SERIE,
        patientId: PATIENT,
      });

      expect(result.status).toBe("RESERVED");
      expect(prisma.stockLot.updateMany).toHaveBeenCalledWith({
        where: { id: STOCK_LOT_ID, quantityOnHand: { gte: 1 } },
        data: { quantityOnHand: { decrement: 1 } },
      });
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "OUT",
            quantity: 1,
            itemId: STOCK_ITEM_ID,
            lotId: STOCK_LOT_ID,
            gtinFisico: GTIN,
            referenceCode: RES,
            establishmentId: ESTABLISHMENT,
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // US.F2.6.8 — cancelReservation
  // -------------------------------------------------------------------------
  describe("cancelReservation", () => {
    it("cambia status a CANCELLED y guarda el motivo", async () => {
      const existing = makeReservation({ status: "RESERVED" });
      prisma.pharmacyReservation.findFirst.mockResolvedValue(
        existing as never,
      );
      prisma.pharmacyReservation.update.mockResolvedValue(
        { ...existing, status: "CANCELLED", cancelMotivo: "Orden suspendida" } as never,
      );

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.cancelReservation({
        reservationId: RES,
        motivo: "Orden suspendida",
      });

      expect(result.status).toBe("CANCELLED");
      expect(result.cancelMotivo).toBe("Orden suspendida");

      const updateArg =
        prisma.pharmacyReservation.update.mock.calls[0]![0].data;
      expect(updateArg.status).toBe("CANCELLED");
      expect(updateArg.cancelMotivo).toBe("Orden suspendida");
    });

    it("repone la unidad descontada (increment + StockMovement IN) si la reserva descontó stock", async () => {
      const existing = makeReservation({ status: "RESERVED" });
      prisma.pharmacyReservation.findFirst.mockResolvedValue(
        existing as never,
      );
      prisma.pharmacyReservation.update.mockResolvedValue(
        { ...existing, status: "CANCELLED", cancelMotivo: "x" } as never,
      );
      prisma.stockMovement.findFirst.mockResolvedValue({
        itemId: STOCK_ITEM_ID,
        lotId: STOCK_LOT_ID,
        quantity: 1,
        establishmentId: ESTABLISHMENT,
      } as never);
      prisma.stockMovement.create.mockResolvedValue({ id: "mov-in" } as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      await caller.cancelReservation({ reservationId: RES, motivo: "x" });

      expect(prisma.stockLot.updateMany).toHaveBeenCalledWith({
        where: { id: STOCK_LOT_ID },
        data: { quantityOnHand: { increment: 1 } },
      });
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "IN",
            quantity: 1,
            itemId: STOCK_ITEM_ID,
            lotId: STOCK_LOT_ID,
            referenceCode: RES,
          }),
        }),
      );
    });

    it("no repone stock si la reserva nunca descontó (sin StockMovement OUT)", async () => {
      const existing = makeReservation({ status: "RESERVED" });
      prisma.pharmacyReservation.findFirst.mockResolvedValue(
        existing as never,
      );
      prisma.pharmacyReservation.update.mockResolvedValue(
        { ...existing, status: "CANCELLED" } as never,
      );
      prisma.stockMovement.findFirst.mockResolvedValue(null as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      await caller.cancelReservation({ reservationId: RES, motivo: "x" });

      expect(prisma.stockLot.updateMany).not.toHaveBeenCalled();
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it("NOT_FOUND si la reserva no existe en el tenant", async () => {
      prisma.pharmacyReservation.findFirst.mockResolvedValue(null as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.cancelReservation({
          reservationId: RES,
          motivo: "Error de sistema",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // -------------------------------------------------------------------------
  // US.F2.6.9 — checkDuplicate
  // -------------------------------------------------------------------------
  describe("checkDuplicate", () => {
    it("allowed=true cuando ítem nunca fue dispensado", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: ITEM,
        frequency: "Q8H",
        dispenses: [],
      } as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.checkDuplicate({
        patientId: PATIENT,
        prescriptionItemId: ITEM,
        gtin: GTIN,
      });

      expect(result.allowed).toBe(true);
      expect(result.lastDispensedAt).toBeNull();
    });

    it("HARD STOP: allowed=false cuando dispensado hace 1h y frecuencia Q8H", async () => {
      vi.useFakeTimers();
      const now = new Date("2026-05-18T12:00:00Z");
      vi.setSystemTime(now);

      const lastDispensedAt = new Date("2026-05-18T11:00:00Z"); // hace 1h
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: ITEM,
        frequency: "Q8H",
        dispenses: [{ dispensedAt: lastDispensedAt }],
      } as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.checkDuplicate({
        patientId: PATIENT,
        prescriptionItemId: ITEM,
        gtin: GTIN,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("ITEM_YA_DISPENSADO_EN_VENTANA");
      // nextWindowAt = 11:00 + 8h = 19:00
      expect(result.nextWindowAt?.toISOString()).toBe(
        "2026-05-18T19:00:00.000Z",
      );
    });

    it("allowed=true cuando dispensado hace 9h y frecuencia Q8H (fuera de ventana)", async () => {
      vi.useFakeTimers();
      const now = new Date("2026-05-18T12:00:00Z");
      vi.setSystemTime(now);

      const lastDispensedAt = new Date("2026-05-18T03:00:00Z"); // hace 9h
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: ITEM,
        frequency: "Q8H",
        dispenses: [{ dispensedAt: lastDispensedAt }],
      } as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.checkDuplicate({
        patientId: PATIENT,
        prescriptionItemId: ITEM,
        gtin: GTIN,
      });

      expect(result.allowed).toBe(true);
    });

    it("allowed=true para frecuencia PRN (no parseable como intervalo)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-18T12:00:00Z"));

      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: ITEM,
        frequency: "PRN",
        dispenses: [{ dispensedAt: new Date("2026-05-18T11:00:00Z") }],
      } as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.checkDuplicate({
        patientId: PATIENT,
        prescriptionItemId: ITEM,
        gtin: GTIN,
      });

      expect(result.allowed).toBe(true);
      expect(result.nextWindowAt).toBeNull();
    });

    it("Español 'cada 8 horas' como frecuencia es reconocida", async () => {
      vi.useFakeTimers();
      const now = new Date("2026-05-18T12:00:00Z");
      vi.setSystemTime(now);

      const lastDispensedAt = new Date("2026-05-18T09:00:00Z"); // hace 3h
      prisma.prescriptionItem.findFirst.mockResolvedValue({
        id: ITEM,
        frequency: "cada 8 horas",
        dispenses: [{ dispensedAt: lastDispensedAt }],
      } as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.checkDuplicate({
        patientId: PATIENT,
        prescriptionItemId: ITEM,
        gtin: GTIN,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("ITEM_YA_DISPENSADO_EN_VENTANA");
    });

    it("NOT_FOUND si el ítem no pertenece al paciente/tenant", async () => {
      prisma.prescriptionItem.findFirst.mockResolvedValue(null as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.checkDuplicate({
          patientId: PATIENT,
          prescriptionItemId: ITEM,
          gtin: GTIN,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // -------------------------------------------------------------------------
  // getReservation
  // -------------------------------------------------------------------------
  describe("getReservation", () => {
    it("devuelve la reserva del tenant", async () => {
      const res = makeReservation();
      prisma.pharmacyReservation.findFirst.mockResolvedValue(res as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.getReservation({ reservationId: RES });

      expect(result.id).toBe(RES);
    });

    it("NOT_FOUND si la reserva no existe en el tenant", async () => {
      prisma.pharmacyReservation.findFirst.mockResolvedValue(null as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.getReservation({ reservationId: RES }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // -------------------------------------------------------------------------
  // orderDetail
  // -------------------------------------------------------------------------
  describe("orderDetail", () => {
    it("devuelve paciente e ítems de la receta", async () => {
      prisma.prescription.findFirst.mockResolvedValue({
        id: ORDER,
        status: "SIGNED",
        patientId: PATIENT,
        patient: { firstName: "Ana", lastName: "Pérez", mrn: "MRN-001" },
        items: [
          {
            id: ITEM,
            dosage: "500mg",
            route: "ORAL",
            frequency: "Q8H",
            drug: { id: "d1", genericName: "Amoxicilina 500mg" },
          },
        ],
      } as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.orderDetail({ pharmacyOrderId: ORDER });

      expect(result.patientId).toBe(PATIENT);
      expect(result.patient.firstName).toBe("Ana");
      expect(result.items[0]?.drug.genericName).toBe("Amoxicilina 500mg");
    });

    it("NOT_FOUND si la receta no existe en el tenant", async () => {
      prisma.prescription.findFirst.mockResolvedValue(null as never);

      const caller = dispensationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.orderDetail({ pharmacyOrderId: ORDER }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
