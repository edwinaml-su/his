/**
 * Tests del gs1PatientTraceRouter — consulta de trazabilidad EPCIS de
 * movimiento de paciente (ADR 0019 D7 / dictamen @AE §4 restricción 9).
 *
 * Cobertura mínima exigida (gap detectado por @QA — el router no tenía
 * ningún test cuando se agregó `gs1-patient-trace.router.ts`):
 *   1. Happy path: devuelve eventos y registra su propio AuditLog READ.
 *   2. El AuditLog se registra con entity='PatientLocationTrace' (restricción 9:
 *      sensibilidad equivalente a exportar el expediente).
 *   3. La query SQL excluye status='SUPPRESSED' (no debe filtrar en memoria,
 *      lo hace la propia query — ver ADR 0019 D5 anonimización).
 *   4. Paciente sin GSRN: no consulta ece.gs1_epcis_patient_event ni escribe
 *      AuditLog (nada que trazar todavía).
 *   5. Sin establecimiento activo: BAD_REQUEST, no llega a tocar prisma.
 *   6. ECE no inicializado para el establecimiento: PRECONDITION_FAILED.
 *   7. Paciente no encontrado (o de otra organización): NOT_FOUND.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { gs1PatientTraceRouter } from "../gs1-patient-trace.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_TENANT_NO_ESTABLISHMENT } from "@his/test-utils";

const PATIENT_ID = "00000000-0000-0000-0000-0000000000a1";
const ECE_ESTABLECIMIENTO_ID = "00000000-0000-0000-0000-0000000000e9";
const GSRN = "750300000000001234";

const EVENT_ROW = {
  id: "00000000-0000-0000-0000-000000000ea1",
  subtipo: "PATIENT_ADMISSION",
  what: { epcList: ["urn:epc:id:gsrn:7503000.0000000123"], gsrn: GSRN },
  where_data: { readPoint: null, bizLocation: null, internalRef: {} },
  event_time: new Date("2026-08-18T12:00:00.000Z"),
  why: { businessStep: "arriving", disposition: "active", bizTransactionList: [] },
  who: { sourceList: [], recordedById: "u1" },
  status: "COMMITTED",
};

describe("gs1PatientTraceRouter.history", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // withEceContext real (no mockeado) envuelve en $transaction — necesita
    // que el mock invoque el callback con el mismo prisma como `tx`, igual
    // que installTenantContextMock pero también soportando $queryRawUnsafe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(prisma));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$executeRaw = vi.fn().mockResolvedValue(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$executeRawUnsafe = vi.fn().mockResolvedValue(1);
  });

  function mockEceEstablecimiento() {
    // resolveEceEstablecimientoId hace $queryRaw (tagged template) sobre
    // ece.establecimiento — se resuelve vía la primera llamada a $queryRaw.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRaw = vi.fn().mockResolvedValue([{ id: ECE_ESTABLECIMIENTO_ID }]);
  }

  it("happy path: devuelve eventos y registra AuditLog READ propio (restricción 9)", async () => {
    mockEceEstablecimiento();
    prisma.patient.findFirst.mockResolvedValue({ id: PATIENT_ID, gsrn: GSRN } as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([EVENT_ROW]);
    prisma.auditLog.create.mockResolvedValue({ id: "audit-1" } as never);

    const caller = gs1PatientTraceRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT }));
    const result = await caller.history({ patientId: PATIENT_ID });

    expect(result.gsrn).toBe(GSRN);
    expect(result.events).toEqual([EVENT_ROW]);

    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    const auditArgs = prisma.auditLog.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(auditArgs.data).toMatchObject({
      action: "READ",
      entity: "PatientLocationTrace",
      entityId: PATIENT_ID,
    });
  });

  it("la query SQL excluye eventos SUPPRESSED (no confía en filtrado en memoria)", async () => {
    mockEceEstablecimiento();
    prisma.patient.findFirst.mockResolvedValue({ id: PATIENT_ID, gsrn: GSRN } as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = queryRawUnsafe;
    prisma.auditLog.create.mockResolvedValue({ id: "audit-2" } as never);

    const caller = gs1PatientTraceRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT }));
    await caller.history({ patientId: PATIENT_ID });

    expect(queryRawUnsafe).toHaveBeenCalledOnce();
    const [sql, gsrnParam] = queryRawUnsafe.mock.calls[0] as [string, string];
    expect(sql).toContain("status <> 'SUPPRESSED'");
    expect(gsrnParam).toBe(GSRN);
  });

  it("paciente sin GSRN: no consulta ece.gs1_epcis_patient_event ni escribe AuditLog", async () => {
    mockEceEstablecimiento();
    prisma.patient.findFirst.mockResolvedValue({ id: PATIENT_ID, gsrn: null } as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryRawUnsafe = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = queryRawUnsafe;

    const caller = gs1PatientTraceRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT }));
    const result = await caller.history({ patientId: PATIENT_ID });

    expect(result).toEqual({ patientId: PATIENT_ID, gsrn: null, events: [] });
    expect(queryRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("sin establecimiento activo: BAD_REQUEST", async () => {
    const caller = gs1PatientTraceRouter.createCaller(
      makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
    );
    await expect(caller.history({ patientId: PATIENT_ID })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(prisma.patient.findFirst).not.toHaveBeenCalled();
  });

  it("ECE no inicializado para el establecimiento: PRECONDITION_FAILED", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRaw = vi.fn().mockResolvedValue([]);

    const caller = gs1PatientTraceRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT }));
    await expect(caller.history({ patientId: PATIENT_ID })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("paciente no encontrado (o de otra organización): NOT_FOUND", async () => {
    mockEceEstablecimiento();
    prisma.patient.findFirst.mockResolvedValue(null);

    const caller = gs1PatientTraceRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT }));
    await expect(caller.history({ patientId: PATIENT_ID })).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.history({ patientId: PATIENT_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
