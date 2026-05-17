/**
 * Tests del eceBridgePatientRouter (Fase 2 — Bridge ECE↔HIS).
 *
 * Estrategia:
 *   - Prisma se mockea con vitest-mock-extended (DeepMockProxy).
 *   - emitDomainEvent se mockea para evitar INSERT a DomainEvent.
 *   - $queryRaw / $executeRaw / $queryRawUnsafe se mockan por caso.
 *
 * Cubre (≥6 tests):
 *   1. linkPatient — happy path
 *   2. linkPatient — NOT_FOUND Patient HIS
 *   3. linkPatient — CONFLICT vínculo previo diferente
 *   4. unlinkPatient — happy path
 *   5. syncFromHis — crea nueva fila ECE (sin ecePacienteId)
 *   6. syncFromHis — BAD_REQUEST conflicto DUI
 *   7. syncToHis   — happy path
 *   8. syncToHis   — NOT_FOUND ece.paciente sin vínculo
 *   9. listLinkedPatients — paginación con nextCursor
 *  10. listLinkedPatients — sin resultados (nextCursor null)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { eceBridgePatientRouter } from "../ece-bridge-patient.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN } from "@his/test-utils";

// ─── Mock emitDomainEvent ─────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-mock-id" }),
  };
});

import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID        = MOCK_TENANT.organizationId;
const USER_ID       = MOCK_USER_ADMIN.id;
const PATIENT_ID    = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ECE_ID        = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ECE_ID_OTHER  = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ESTAB_ID      = MOCK_TENANT.establishmentId!;

const ECE_TENANT = {
  ...MOCK_TENANT,
  roleCodes: ["ARCH", "ADM"],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePrisma() {
  return mockDeep<PrismaClient>();
}

/** Encapsula $transaction para pasar el mismo mock como tx. */
function setupTransaction(prisma: DeepMockProxy<PrismaClient>) {
  prisma.$transaction.mockImplementation(async (fn) => {
    // Pasar el mismo mock como cliente de transacción.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return fn(prisma as any);
  });
}

function makeCaller(prisma: DeepMockProxy<PrismaClient>) {
  const ctx = makeCtx({ prisma: prisma as unknown as Partial<PrismaClient>, tenant: ECE_TENANT });
  return eceBridgePatientRouter.createCaller(ctx);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("eceBridgePatientRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  // ── 1. linkPatient — happy path ──────────────────────────────────────────

  it("linkPatient: vincula ece.paciente a Patient HIS y emite evento", async () => {
    setupTransaction(prisma);

    // Patient HIS existe
    prisma.patient.findFirst.mockResolvedValue({ id: PATIENT_ID } as never);

    // ece.paciente sin vínculo previo
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: ECE_ID, public_patient_id: null },
    ]);
    prisma.$executeRaw.mockResolvedValue(1);

    const caller = makeCaller(prisma);
    const result = await caller.linkPatient({ patientId: PATIENT_ID, ecePacienteId: ECE_ID });

    expect(result).toEqual({ ecePacienteId: ECE_ID, publicPatientId: PATIENT_ID });
    expect(emitDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "ece.paciente.linked" }),
    );
  });

  // ── 2. linkPatient — NOT_FOUND Patient HIS ───────────────────────────────

  it("linkPatient: lanza NOT_FOUND si Patient HIS no existe en el tenant", async () => {
    setupTransaction(prisma);
    prisma.patient.findFirst.mockResolvedValue(null);

    const caller = makeCaller(prisma);
    await expect(
      caller.linkPatient({ patientId: PATIENT_ID, ecePacienteId: ECE_ID }),
    ).rejects.toThrow(TRPCError);
  });

  // ── 3. linkPatient — CONFLICT vínculo previo diferente ───────────────────

  it("linkPatient: lanza CONFLICT si ece.paciente ya está vinculado a otro Patient", async () => {
    setupTransaction(prisma);
    prisma.patient.findFirst.mockResolvedValue({ id: PATIENT_ID } as never);

    // Vínculo previo a un Patient diferente
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: ECE_ID, public_patient_id: ECE_ID_OTHER },
    ]);

    const caller = makeCaller(prisma);
    await expect(
      caller.linkPatient({ patientId: PATIENT_ID, ecePacienteId: ECE_ID }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // ── 4. unlinkPatient — happy path ────────────────────────────────────────

  it("unlinkPatient: establece public_patient_id = NULL", async () => {
    prisma.$executeRaw.mockResolvedValue(1);

    const ctx = makeCtx({
      prisma: prisma as unknown as Partial<PrismaClient>,
      tenant: ECE_TENANT,
    });
    const caller = eceBridgePatientRouter.createCaller(ctx);
    const result = await caller.unlinkPatient({ patientId: PATIENT_ID, ecePacienteId: ECE_ID });

    expect(result).toEqual({ ecePacienteId: ECE_ID, unlinked: true });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  // ── 5. syncFromHis — crea nueva fila ECE ─────────────────────────────────

  it("syncFromHis: crea ece.paciente cuando no se pasa ecePacienteId", async () => {
    setupTransaction(prisma);

    prisma.patient.findFirst.mockResolvedValue({
      id: PATIENT_ID,
      firstName: "María",
      lastName: "García",
      secondLastName: "López",
      birthDate: new Date("1990-05-10"),
      biologicalSexId: "sex-uuid",
      identifiers: [{ kind: "DUI", value: "01234567-8" }],
    } as never);

    // INSERT RETURNING id
    prisma.$queryRaw.mockResolvedValueOnce([{ id: ECE_ID }]);

    const caller = makeCaller(prisma);
    const result = await caller.syncFromHis({ patientId: PATIENT_ID });

    expect(result.ecePacienteId).toBe(ECE_ID);
    expect(result.publicPatientId).toBe(PATIENT_ID);
    expect(result.fieldsUpdated).toContain("firstName");
    expect(emitDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "ece.paciente.synced" }),
    );
  });

  // ── 6. syncFromHis — BAD_REQUEST conflicto DUI ───────────────────────────

  it("syncFromHis: lanza BAD_REQUEST si DUI del HIS difiere del DUI ECE", async () => {
    setupTransaction(prisma);

    prisma.patient.findFirst.mockResolvedValue({
      id: PATIENT_ID,
      firstName: "Juan",
      lastName: "Pérez",
      secondLastName: null,
      birthDate: null,
      biologicalSexId: "sex-uuid",
      identifiers: [{ kind: "DUI", value: "09876543-2" }],
    } as never);

    // ece.paciente con DUI distinto
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: ECE_ID,
        public_patient_id: null,
        primer_nombre: "Juan",
        primer_apellido: "Pérez",
        segundo_apellido: null,
        fecha_nacimiento: null,
        sexo_biologico_id: "sex-uuid",
        expediente_numero: null,
        dui: "01234567-8",   // diferente al del HIS
        nie: null,
        establecimiento_id: ESTAB_ID,
      },
    ]);

    const caller = makeCaller(prisma);
    await expect(
      caller.syncFromHis({ patientId: PATIENT_ID, ecePacienteId: ECE_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("DUI") });
  });

  // ── 7. syncToHis — happy path ────────────────────────────────────────────

  it("syncToHis: actualiza Patient HIS con campos NTEC Art. 15 y emite evento", async () => {
    setupTransaction(prisma);

    // ece.paciente con vínculo
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: ECE_ID,
        public_patient_id: PATIENT_ID,
        primer_nombre: "Ana",
        primer_apellido: "Martínez",
        segundo_apellido: "Rivas",
        fecha_nacimiento: new Date("1985-03-22"),
        sexo_biologico_id: "sex-f",
        expediente_numero: "EXP-001",
        dui: "01234567-8",
        nie: null,
        establecimiento_id: ESTAB_ID,
      },
    ]);

    // Patient HIS sin conflicto de identificadores
    prisma.patient.findFirst.mockResolvedValue({
      id: PATIENT_ID,
      identifiers: [{ kind: "DUI", value: "01234567-8" }],
    } as never);

    prisma.patient.update.mockResolvedValue({} as never);

    const caller = makeCaller(prisma);
    const result = await caller.syncToHis({ ecePacienteId: ECE_ID });

    expect(result.publicPatientId).toBe(PATIENT_ID);
    expect(result.fieldsUpdated).toContain("lastName");
    expect(prisma.patient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PATIENT_ID },
        data: expect.objectContaining({ firstName: "Ana" }),
      }),
    );
    expect(emitDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "ece.paciente.synced" }),
    );
  });

  // ── 8. syncToHis — BAD_REQUEST sin vínculo ───────────────────────────────

  it("syncToHis: lanza BAD_REQUEST si ece.paciente no tiene public_patient_id", async () => {
    setupTransaction(prisma);

    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: ECE_ID,
        public_patient_id: null,
        primer_nombre: "Test",
        primer_apellido: "Test",
        segundo_apellido: null,
        fecha_nacimiento: null,
        sexo_biologico_id: null,
        expediente_numero: null,
        dui: null,
        nie: null,
        establecimiento_id: ESTAB_ID,
      },
    ]);

    const caller = makeCaller(prisma);
    await expect(
      caller.syncToHis({ ecePacienteId: ECE_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── 9. listLinkedPatients — paginación con nextCursor ────────────────────

  it("listLinkedPatients: devuelve nextCursor cuando hay más resultados que el límite", async () => {
    // Simular limit=2, resultado 3 filas → hasMore=true
    const fakeRows = [
      { ece_id: "id-1", public_patient_id: PATIENT_ID, primer_nombre: "A", primer_apellido: "B", expediente_numero: null, dui: null },
      { ece_id: "id-2", public_patient_id: PATIENT_ID, primer_nombre: "C", primer_apellido: "D", expediente_numero: null, dui: null },
      { ece_id: "id-3", public_patient_id: PATIENT_ID, primer_nombre: "E", primer_apellido: "F", expediente_numero: null, dui: null },
    ];
    prisma.$queryRawUnsafe.mockResolvedValue(fakeRows);

    const ctx = makeCtx({
      prisma: prisma as unknown as Partial<PrismaClient>,
      tenant: ECE_TENANT,
    });
    const caller = eceBridgePatientRouter.createCaller(ctx);
    const result = await caller.listLinkedPatients({ limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe("id-2");
  });

  // ── 10. listLinkedPatients — sin más resultados ──────────────────────────

  it("listLinkedPatients: devuelve nextCursor null cuando no hay más páginas", async () => {
    const fakeRows = [
      { ece_id: "id-1", public_patient_id: PATIENT_ID, primer_nombre: "A", primer_apellido: "B", expediente_numero: null, dui: null },
    ];
    prisma.$queryRawUnsafe.mockResolvedValue(fakeRows);

    const ctx = makeCtx({
      prisma: prisma as unknown as Partial<PrismaClient>,
      tenant: ECE_TENANT,
    });
    const caller = eceBridgePatientRouter.createCaller(ctx);
    const result = await caller.listLinkedPatients({ limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });
});
