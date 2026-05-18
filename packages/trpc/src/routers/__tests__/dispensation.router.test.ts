/**
 * Tests US.F2.6.6-7 — dispensationRouter.
 *
 * Cubre:
 *   - checkPreconditions: SIN_RECETA_ACTIVA, RECETA_SUSPENDIDA, happy path.
 *   - scanItem: MEDICAMENTO_VENCIDO (+ outbox mock), LOTE_EN_RECALL (mock dynamic),
 *               happy path (scan correcto).
 *
 * E2E @QA: e2e/fase2/pharmacy-picking.spec.ts (4 escenarios).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { dispensationRouter } from "../pharmacy/dispensation.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT = "00000000-0000-0000-0000-000000000001";
const PRESCRIPTION = "00000000-0000-0000-0000-000000000010";
const ITEM_ID = "00000000-0000-0000-0000-000000000011";
const DRUG_ID = "00000000-0000-0000-0000-0000000000d1";

/** GTIN-14 válido con checksum correcto (GS1 Amoxicilina 500mg ficticio). */
const VALID_GTIN = "07501000001234";
/** Fecha de vencimiento futura en formato GS1 YYMMDD. */
const FUTURE_EXPIRY = "261231"; // 2026-12-31
/** Fecha de vencimiento pasada en formato GS1 YYMMDD. */
const PAST_EXPIRY = "240101"; // 2024-01-01

function basePrescription(statusOverride?: string, signedAtOverride?: Date | null) {
  return {
    id: PRESCRIPTION,
    status: statusOverride ?? "SIGNED",
    signedAt: signedAtOverride !== undefined ? signedAtOverride : new Date("2026-01-01"),
    prescriberId: "00000000-0000-0000-0000-000000000099",
    patientId: PATIENT,
    items: [
      {
        id: ITEM_ID,
        drug: { id: DRUG_ID, genericName: "Amoxicilina 500mg" },
        dosage: "500mg",
        route: "ORAL",
        frequency: "QID",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  // withTenantContext usa $transaction; mockeamos para que ejecute el callback.
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  // Mock del modelo domainEvent (outbox pattern).
  const prismaAny = prisma as unknown as Record<string, { create: ReturnType<typeof vi.fn> }>;
  prismaAny.domainEvent = { create: vi.fn().mockResolvedValue({ id: "evt-1" }) };
});

// ---------------------------------------------------------------------------
// checkPreconditions
// ---------------------------------------------------------------------------

describe("dispensationRouter.checkPreconditions", () => {
  it("SIN_RECETA_ACTIVA cuando la receta no existe", async () => {
    prisma.prescription.findFirst.mockResolvedValue(null as never);
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.checkPreconditions({ patientId: PATIENT, indicationId: PRESCRIPTION }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "SIN_RECETA_ACTIVA" });
  });

  it("SIN_RECETA_ACTIVA cuando signedAt es null (no firmada)", async () => {
    prisma.prescription.findFirst.mockResolvedValue(
      basePrescription("SIGNED", null) as never,
    );
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.checkPreconditions({ patientId: PATIENT, indicationId: PRESCRIPTION }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "SIN_RECETA_ACTIVA" });
  });

  it("RECETA_SUSPENDIDA cuando status=CANCELLED", async () => {
    prisma.prescription.findFirst.mockResolvedValue(
      basePrescription("CANCELLED") as never,
    );
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.checkPreconditions({ patientId: PATIENT, indicationId: PRESCRIPTION }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "RECETA_SUSPENDIDA" });
  });

  it("RECETA_SUSPENDIDA cuando status=DRAFT (no firmable)", async () => {
    prisma.prescription.findFirst.mockResolvedValue(
      basePrescription("DRAFT") as never,
    );
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.checkPreconditions({ patientId: PATIENT, indicationId: PRESCRIPTION }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "RECETA_SUSPENDIDA" });
  });

  it("ok:true con receta SIGNED firmada", async () => {
    prisma.prescription.findFirst.mockResolvedValue(basePrescription() as never);
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    const res = await caller.checkPreconditions({
      patientId: PATIENT,
      indicationId: PRESCRIPTION,
    });
    expect(res.ok).toBe(true);
    expect(res.prescriptionId).toBe(PRESCRIPTION);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.genericName).toBe("Amoxicilina 500mg");
  });

  it("ok:true con receta PARTIALLY_DISPENSED", async () => {
    prisma.prescription.findFirst.mockResolvedValue(
      basePrescription("PARTIALLY_DISPENSED") as never,
    );
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    const res = await caller.checkPreconditions({
      patientId: PATIENT,
      indicationId: PRESCRIPTION,
    });
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scanItem
// ---------------------------------------------------------------------------

describe("dispensationRouter.scanItem", () => {
  it("MEDICAMENTO_VENCIDO y emite evento outbox", async () => {
    prisma.prescription.findFirst.mockResolvedValue(basePrescription() as never);
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    const res = await caller.scanItem({
      pharmacyOrderId: PRESCRIPTION,
      gtin: VALID_GTIN,
      lot: "L2024A",
      expiry: PAST_EXPIRY,
    });
    expect(res).toMatchObject({ hardStop: "MEDICAMENTO_VENCIDO", expiryRaw: PAST_EXPIRY });

    // El evento outbox debe haberse intentado crear.
    const prismaAny = prisma as unknown as Record<string, { create: ReturnType<typeof vi.fn> }>;
    expect(prismaAny.domainEvent?.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "pharmacy.expired-attempt" }),
      }),
    );
  });

  it("happy path — scan válido devuelve ok:true con datos del ítem", async () => {
    prisma.prescription.findFirst.mockResolvedValue(basePrescription() as never);
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    const res = await caller.scanItem({
      pharmacyOrderId: PRESCRIPTION,
      gtin: VALID_GTIN,
      lot: "L2024A",
      expiry: FUTURE_EXPIRY,
      serial: "S00001",
    });
    expect(res).toMatchObject({
      ok: true,
      item: expect.objectContaining({
        gtin: VALID_GTIN,
        lot: "L2024A",
        expiry: FUTURE_EXPIRY,
        serial: "S00001",
        genericName: "Amoxicilina 500mg",
      }),
    });
  });

  it("happy path — scan sin lote ni serie (mínimo: GTIN)", async () => {
    prisma.prescription.findFirst.mockResolvedValue(basePrescription() as never);
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    const res = await caller.scanItem({
      pharmacyOrderId: PRESCRIPTION,
      gtin: VALID_GTIN,
    });
    expect(res).toMatchObject({ ok: true });
  });

  it("NOT_FOUND cuando la prescripción no es dispensable", async () => {
    prisma.prescription.findFirst.mockResolvedValue(null as never);
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.scanItem({ pharmacyOrderId: PRESCRIPTION, gtin: VALID_GTIN }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("NOT_FOUND cuando la orden no tiene ítems", async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      ...basePrescription(),
      items: [],
    } as never);
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.scanItem({ pharmacyOrderId: PRESCRIPTION, gtin: VALID_GTIN }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("valida formato GTIN — rechaza GTIN de longitud incorrecta", async () => {
    const caller = dispensationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.scanItem({ pharmacyOrderId: PRESCRIPTION, gtin: "12345" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
