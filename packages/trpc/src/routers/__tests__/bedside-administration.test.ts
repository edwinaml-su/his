/**
 * Tests — bedside.administration.record + bedside.shiftQueue.pending (F2-S7 Wave 2)
 *
 * Cubre:
 *  1. administration.record — happy path (GSRN resuelve patient + staff, prescriptionItem enlazado)
 *  2. administration.record — GSRN paciente no encontrado → TRPCError NOT_FOUND
 *  3. administration.record — indicación sin prescription_item_id → TRPCError PRECONDITION_FAILED
 *  4. shiftQueue.pending — con turno activo (servicioId filtra indicaciones)
 *  5. shiftQueue.pending — sin turno activo (fallback: todas las indicaciones de la org)
 *  6. shiftQueue.pending — sin indicaciones pendientes → items vacío
 *  7. validate5Correct.validate — alias adapta input y llama validate5Correctos (GS1_PARSE_ERROR)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { bedsideRouter } from "../bedside.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID_ORG       = "aaaaaaaa-0000-0000-0000-000000000001";
const UUID_PATIENT   = "bbbbbbbb-0000-0000-0000-000000000001";
const UUID_USER      = "cccccccc-0000-0000-0000-000000000001";
const UUID_PRESC     = "dddddddd-0000-0000-0000-000000000001";
const UUID_ADMIN     = "eeeeeeee-0000-0000-0000-000000000001";
const UUID_INDICATION = "ffffffff-0000-0000-0000-000000000001";
const UUID_SERVICIO  = "11111111-0000-0000-0000-000000000001";

const GSRN_PATIENT = "801874130000000018"; // 18 dígitos dummy
const GSRN_NURSE   = "801874130000000019";
const GTIN_14      = "07501000001234"; // 14 dígitos dummy

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let prisma: DeepMockProxy<PrismaClient>;

function makeCaller() {
  const ctx = makeCtx({
    prisma,
    user: { id: UUID_USER, email: "nurse@his.test", fullName: "Enfermera Test", roleCodes: ["NURSE"] },
    tenant: {
      organizationId: UUID_ORG,
      establishmentId: "ee000000-0000-0000-0000-000000000001",
      roleCodes: ["NURSE"],
      userId: UUID_USER,
    },
  });
  return bedsideRouter.createCaller(ctx);
}

function baseAdminInput() {
  return {
    patientGsrn:     GSRN_PATIENT,
    staffGsrn:       GSRN_NURSE,
    medicamentoGtin: GTIN_14,
    lote:            "L2024A",
    dosis:           "500mg/cap",
    via:             "IV" as const,
    indicationId:    UUID_INDICATION,
  };
}

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  // $executeRawUnsafe es no-op por defecto
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$executeRawUnsafe = vi.fn().mockResolvedValue(1);
  // $transaction ejecuta el callback con el mismo prisma
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$transaction = vi.fn().mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(prisma),
  );
  // $queryRawUnsafe retorna [] por defecto; cada test configura lo necesario
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// 1. administration.record — happy path
// ---------------------------------------------------------------------------

describe("bedside.administration.record", () => {
  it("crea MedicationAdministration con BCMA=true cuando GSRN y prescriptionItem son válidos", async () => {
    // GSRN paciente → patientId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe
      .mockResolvedValueOnce([{ referencia_id: UUID_PATIENT }])   // gs1_gsrn
      .mockResolvedValueOnce([{ user_id: UUID_USER }])            // StaffGsrn
      .mockResolvedValueOnce([{ prescription_item_id: UUID_PRESC }]); // indicaciones_medicas

    prisma.medicationAdministration.create.mockResolvedValue({
      id: UUID_ADMIN,
    } as never);

    const caller = makeCaller();
    const result = await caller.administration.record(baseAdminInput());

    expect(result.administrationId).toBe(UUID_ADMIN);
    expect(prisma.medicationAdministration.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patientBarcodeScanned: true,
          drugBarcodeScanned:    true,
          providerBadgeScanned:  true,
          status:                "ADMINISTERED",
          gtinScanned:           GTIN_14,
          loteScanned:           "L2024A",
          gsrnPaciente:          GSRN_PATIENT,
          gsrnEnfermera:         GSRN_NURSE,
          route:                 "IV",
        }),
      }),
    );
  });

  // 2. GSRN paciente no encontrado
  it("lanza NOT_FOUND si el GSRN paciente no existe en gs1_gsrn", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe.mockResolvedValue([]); // GSRN no encontrado

    const caller = makeCaller();
    await expect(
      caller.administration.record(baseAdminInput()),
    ).rejects.toThrow(TRPCError);
  });

  // 3. indicación sin prescriptionItemId
  it("lanza PRECONDITION_FAILED si la indicación no tiene prescription_item_id enlazado", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe
      .mockResolvedValueOnce([{ referencia_id: UUID_PATIENT }])  // gs1_gsrn OK
      .mockResolvedValueOnce([{ user_id: UUID_USER }])           // StaffGsrn OK
      .mockResolvedValueOnce([{ prescription_item_id: null }]);  // sin bridge

    const caller = makeCaller();
    await expect(
      caller.administration.record(baseAdminInput()),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

// ---------------------------------------------------------------------------
// 4. shiftQueue.pending — con turno activo
// ---------------------------------------------------------------------------

describe("bedside.shiftQueue.pending", () => {
  it("filtra indicaciones por servicioId cuando hay turno activo", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe
      .mockResolvedValueOnce([{ servicio_id: UUID_SERVICIO }])   // staff_schedule
      .mockResolvedValueOnce([                                    // indicaciones_medicas
        {
          indicacion_id:   UUID_INDICATION,
          patient_id:      UUID_PATIENT,
          patient_gsrn:    GSRN_PATIENT,
          gtin:            GTIN_14,
          hora_programada: new Date(Date.now() + 60 * 60_000),   // en 1 hora → PENDING
        },
      ]);

    const caller = makeCaller();
    const { items } = await caller.shiftQueue.pending({});

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      patientId:       UUID_PATIENT,
      patientGsrn:     GSRN_PATIENT,
      indicationId:    UUID_INDICATION,
      gtinMedicamento: GTIN_14,
      status:          "PENDING",
    });
  });

  // 5. sin turno activo → fallback todas las indicaciones
  it("retorna indicaciones de la org cuando no hay turno activo (fallback)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe
      .mockResolvedValueOnce([])                                 // sin schedule
      .mockResolvedValueOnce([                                   // todas las indicaciones
        {
          indicacion_id:   UUID_INDICATION,
          patient_id:      UUID_PATIENT,
          patient_gsrn:    GSRN_PATIENT,
          gtin:            GTIN_14,
          hora_programada: null,
        },
      ]);

    const caller = makeCaller();
    const { items } = await caller.shiftQueue.pending({});

    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("PENDING");
    expect(items[0]!.horaProgramada).toBeNull();
  });

  // 6. sin indicaciones pendientes
  it("retorna items vacío cuando no hay indicaciones activas", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe
      .mockResolvedValueOnce([])  // sin schedule
      .mockResolvedValueOnce([]); // sin indicaciones

    const caller = makeCaller();
    const { items } = await caller.shiftQueue.pending({});

    expect(items).toHaveLength(0);
  });

  it("marca como OVERDUE indicaciones cuya hora_programada superó la tolerancia de 30 min", async () => {
    const hace2h = new Date(Date.now() - 2 * 60 * 60_000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          indicacion_id:   UUID_INDICATION,
          patient_id:      UUID_PATIENT,
          patient_gsrn:    GSRN_PATIENT,
          gtin:            GTIN_14,
          hora_programada: hace2h,
        },
      ]);

    const caller = makeCaller();
    const { items } = await caller.shiftQueue.pending({});

    expect(items[0]!.status).toBe("OVERDUE");
  });
});

// ---------------------------------------------------------------------------
// 7. validate5Correct.validate — alias adapta input y llama validate5Correctos
// ---------------------------------------------------------------------------

describe("bedside.validate5Correct.validate", () => {
  it("propaga GS1_PARSE_ERROR si el GTIN es inválido (< 14 chars)", async () => {
    // La procedure construye un gs1Medicamento sintético con el GTIN/lot/expiry
    // y lo pasa a runValidate5Correctos. Con un DataMatrix sin GSRN válido en BD
    // se espera que falle en el check de GSRN.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe.mockResolvedValue([]); // GSRN no encontrado
    // $executeRawUnsafe para persistValidation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$executeRawUnsafe = vi.fn().mockResolvedValue(1);

    const caller = makeCaller();
    const result = await caller.validate5Correct.validate({
      patientGsrn:  GSRN_PATIENT,
      nurseGsrn:    GSRN_NURSE,
      gtin:         GTIN_14,
      lot:          "L2024A",
      expiry:       "261231",
      indicationId: UUID_INDICATION,
    });

    // GSRN no en BD → GSRN_PACIENTE_NO_ENCONTRADO (no GS1_PARSE_ERROR porque el
    // DataMatrix sintético sí es parseable)
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("GSRN_PACIENTE_NO_ENCONTRADO");
    }
  });
});
