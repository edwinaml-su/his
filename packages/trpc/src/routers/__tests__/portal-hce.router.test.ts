// @ts-nocheck - portal HCE router tests (Beta.20b E.B20.2)
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { portalRouter } from "../portal.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PA = "00000000-0000-0000-0000-000000000001"; // portalAccountId
const PT = "00000000-0000-0000-0000-000000000002"; // patientId (own)
const PT2 = "00000000-0000-0000-0000-000000000003"; // otro paciente (IDOR check)
const WD = "00000000-0000-0000-0000-000000000004"; // ward patient
const RES1 = "00000000-0000-0000-0000-000000000005"; // resultId
const EM = "p@test.com";

const pc = (prisma) =>
  makeCtx({ prisma, user: null, tenant: null, portalAccount: { id: PA, patientId: PT, email: EM } });

// withPortalContext abre una $transaction; mockear para que ejecute el callback directo
function mockTx(prisma) {
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
}

// ─── appointments.list ────────────────────────────────────────────────────────

describe("portal.hce.appointments.list", () => {
  let prisma;
  beforeEach(() => {
    prisma = mockDeep();
    mockTx(prisma);
  });

  it("retorna solo citas del propio patientId", async () => {
    const appt = {
      id: RES1,
      scheduledAt: new Date(Date.now() - 1000),
      durationMinutes: 20,
      status: "COMPLETED",
      reason: "Consulta",
      provider: { fullName: "Dr. Test" },
    };
    prisma.outpatientAppointment.findMany.mockResolvedValue([appt]);

    const result = await portalRouter
      .createCaller(pc(prisma))
      .hce.appointments.list({});

    expect(result).toHaveLength(1);
    // La query debe filtrar por el patientId del JWT, no por un input
    const callArgs = prisma.outpatientAppointment.findMany.mock.calls[0][0];
    expect(callArgs.where.patientId).toBe(PT);
  });

  it("upcoming=true filtra scheduledAt >= now", async () => {
    prisma.outpatientAppointment.findMany.mockResolvedValue([]);
    await portalRouter.createCaller(pc(prisma)).hce.appointments.list({ upcoming: true });

    const callArgs = prisma.outpatientAppointment.findMany.mock.calls[0][0];
    expect(callArgs.where.scheduledAt).toMatchObject({ gte: expect.any(Date) });
  });

  it("upstream patientId nunca viene del input — defensa IDOR", async () => {
    // Si el test inyecta wardPatientId sin relación ACTIVE, debe fallar FORBIDDEN
    prisma.guardianRelationship.findFirst.mockResolvedValue(null);

    await expect(
      portalRouter
        .createCaller(pc(prisma))
        .hce.appointments.list({ wardPatientId: PT2 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── appointments.upcoming ────────────────────────────────────────────────────

describe("portal.hce.appointments.upcoming", () => {
  let prisma;
  beforeEach(() => {
    prisma = mockDeep();
    mockTx(prisma);
  });

  it("limita a 5 citas futuras", async () => {
    prisma.outpatientAppointment.findMany.mockResolvedValue([]);
    await portalRouter.createCaller(pc(prisma)).hce.appointments.upcoming({});
    const callArgs = prisma.outpatientAppointment.findMany.mock.calls[0][0];
    expect(callArgs.take).toBe(5);
    expect(callArgs.where.scheduledAt).toMatchObject({ gte: expect.any(Date) });
  });
});

// ─── labResults.list ─────────────────────────────────────────────────────────

describe("portal.hce.labResults.list", () => {
  let prisma;
  beforeEach(() => {
    prisma = mockDeep();
    mockTx(prisma);
  });

  it("solo retorna resultados con validatedAt != null (VALIDATED)", async () => {
    const result = {
      id: RES1,
      flag: "NORMAL",
      valueNumeric: 5.0,
      valueText: null,
      valueUnit: "mg/dL",
      validatedAt: new Date(),
      resultedAt: new Date(),
      orderItem: {
        test: { name: "Glucosa", code: "GLUC" },
        order: { orderedAt: new Date() },
      },
    };
    prisma.labResult.findMany.mockResolvedValue([result]);

    const res = await portalRouter.createCaller(pc(prisma)).hce.labResults.list({});
    expect(res).toHaveLength(1);

    const callArgs = prisma.labResult.findMany.mock.calls[0][0];
    // validatedAt debe filtrar NOT null
    expect(callArgs.where.validatedAt).toMatchObject({ not: null });
  });

  it("filtra por patientId via orderItem.order.patientId", async () => {
    prisma.labResult.findMany.mockResolvedValue([]);
    await portalRouter.createCaller(pc(prisma)).hce.labResults.list({});
    const callArgs = prisma.labResult.findMany.mock.calls[0][0];
    expect(callArgs.where.orderItem.order.patientId).toBe(PT);
  });

  it("resultados DRAFT (validatedAt=null) NO aparecen", async () => {
    prisma.labResult.findMany.mockResolvedValue([]);
    await portalRouter.createCaller(pc(prisma)).hce.labResults.list({});
    // El mock devuelve vacío — en prod los DRAFT quedarían fuera por el filtro
    // Verificamos que el filtro está presente
    const callArgs = prisma.labResult.findMany.mock.calls[0][0];
    expect(callArgs.where.validatedAt).toBeDefined();
  });

  it("guardian flow: wardPatientId ACTIVE permite consultar", async () => {
    prisma.guardianRelationship.findFirst.mockResolvedValue({ wardPatientId: WD });
    prisma.labResult.findMany.mockResolvedValue([]);

    await portalRouter
      .createCaller(pc(prisma))
      .hce.labResults.list({ wardPatientId: WD });

    const callArgs = prisma.labResult.findMany.mock.calls[0][0];
    expect(callArgs.where.orderItem.order.patientId).toBe(WD);
  });

  it("guardian flow: wardPatientId REVOKED → FORBIDDEN", async () => {
    prisma.guardianRelationship.findFirst.mockResolvedValue(null);

    await expect(
      portalRouter
        .createCaller(pc(prisma))
        .hce.labResults.list({ wardPatientId: WD }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── labResults.get ───────────────────────────────────────────────────────────

describe("portal.hce.labResults.get", () => {
  let prisma;
  beforeEach(() => {
    prisma = mockDeep();
    mockTx(prisma);
  });

  it("retorna detalle de resultado validado del propio paciente", async () => {
    const result = {
      id: RES1,
      flag: "HIGH",
      valueNumeric: 12.0,
      valueText: null,
      valueUnit: "mmol/L",
      notes: null,
      validatedAt: new Date(),
      resultedAt: new Date(),
      orderItem: {
        test: {
          name: "HbA1c",
          code: "HBA1C",
          refRangeLow: 4.0,
          refRangeHigh: 5.7,
          unit: "%",
        },
        order: { orderedAt: new Date(), patientId: PT },
      },
    };
    prisma.labResult.findFirst.mockResolvedValue(result);

    const res = await portalRouter
      .createCaller(pc(prisma))
      .hce.labResults.get({ resultId: RES1 });

    expect(res.flag).toBe("HIGH");
    expect(res.id).toBe(RES1);
  });

  it("lanza NOT_FOUND si el resultado no pertenece al paciente", async () => {
    // Mock $transaction then findFirst returns null
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.labResult.findFirst.mockResolvedValue(null);

    await expect(
      portalRouter
        .createCaller(pc(prisma))
        .hce.labResults.get({ resultId: RES1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── prescriptions.list ───────────────────────────────────────────────────────

describe("portal.hce.prescriptions.list", () => {
  let prisma;
  beforeEach(() => {
    prisma = mockDeep();
    mockTx(prisma);
  });

  it("incluye items y dispensaciones", async () => {
    const rx = {
      id: RES1,
      prescribedAt: new Date(),
      status: "SIGNED",
      signedAt: new Date(),
      items: [
        {
          id: "00000000-0000-0000-0000-000000000006",
          dosage: "500mg",
          route: "ORAL",
          frequency: "BID",
          durationDays: 7,
          prescribedQty: 14,
          administeredQty: 0,
          drug: { genericName: "Amoxicilina", brandName: "Amoxil" },
          dispenses: [],
        },
      ],
    };
    prisma.prescription.findMany.mockResolvedValue([rx]);

    const res = await portalRouter.createCaller(pc(prisma)).hce.prescriptions.list({});
    expect(res).toHaveLength(1);
    expect(res[0].items).toHaveLength(1);
    expect(res[0].items[0].drug.genericName).toBe("Amoxicilina");
  });

  it("filtra solo SIGNED y PARTIALLY_DISPENSED — no DRAFT ni EXPIRED", async () => {
    prisma.prescription.findMany.mockResolvedValue([]);
    await portalRouter.createCaller(pc(prisma)).hce.prescriptions.list({});
    const callArgs = prisma.prescription.findMany.mock.calls[0][0];
    expect(callArgs.where.status.in).toContain("SIGNED");
    expect(callArgs.where.status.in).toContain("PARTIALLY_DISPENSED");
    expect(callArgs.where.status.in).not.toContain("DRAFT");
  });

  it("filtra por patientId del JWT", async () => {
    prisma.prescription.findMany.mockResolvedValue([]);
    await portalRouter.createCaller(pc(prisma)).hce.prescriptions.list({});
    const callArgs = prisma.prescription.findMany.mock.calls[0][0];
    expect(callArgs.where.patientId).toBe(PT);
  });
});

// ─── vaccinations.list ────────────────────────────────────────────────────────

describe("portal.hce.vaccinations.list", () => {
  let prisma;
  beforeEach(() => {
    prisma = mockDeep();
    mockTx(prisma);
  });

  it("retorna vacunaciones del paciente", async () => {
    const vacc = {
      id: RES1,
      doseNumber: 1,
      administeredAt: new Date(),
      lotNumber: "LOT-123",
      anatomicalSite: "Brazo izquierdo",
      vaccine: { name: "BCG", code: "BCG", scheduleNote: "Al nacer" },
    };
    prisma.patientVaccination.findMany.mockResolvedValue([vacc]);

    const res = await portalRouter.createCaller(pc(prisma)).hce.vaccinations.list({});
    expect(res).toHaveLength(1);
    expect(res[0].vaccine.code).toBe("BCG");
  });

  it("filtra por patientId del JWT — no acepta patientId externo", async () => {
    prisma.patientVaccination.findMany.mockResolvedValue([]);
    await portalRouter.createCaller(pc(prisma)).hce.vaccinations.list({});
    const callArgs = prisma.patientVaccination.findMany.mock.calls[0][0];
    expect(callArgs.where.patientId).toBe(PT);
  });

  it("guardian flow: ward ACTIVE puede ver vacunación", async () => {
    prisma.guardianRelationship.findFirst.mockResolvedValue({ wardPatientId: WD });
    prisma.patientVaccination.findMany.mockResolvedValue([]);

    await portalRouter
      .createCaller(pc(prisma))
      .hce.vaccinations.list({ wardPatientId: WD });

    const callArgs = prisma.patientVaccination.findMany.mock.calls[0][0];
    expect(callArgs.where.patientId).toBe(WD);
  });
});
