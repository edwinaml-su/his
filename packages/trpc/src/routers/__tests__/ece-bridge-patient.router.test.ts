/**
 * Tests del eceBridgePatientRouter (Fase 2 — Bridge ECE↔HIS).
 *
 * REFACTOR 2026-05-29: schema real de ece.paciente NO tiene columnas
 * demográficas (primer_nombre/primer_apellido/fecha_nacimiento/etc).
 * Tiene solo identificadores + flags admin. Los fixtures usan las
 * columnas reales: numero_expediente, dui, carnet_minoridad,
 * tipo_registro_identidad, estado_expediente, estado_registro, fallecido.
 *
 * Estrategia:
 *   - Prisma se mockea con vitest-mock-extended (DeepMockProxy).
 *   - emitDomainEvent se mockea para evitar INSERT a DomainEvent.
 *   - $queryRaw / $executeRaw / $queryRawUnsafe se mockan por caso.
 *
 * Cubre (10 tests):
 *   1. linkPatient — happy path
 *   2. linkPatient — NOT_FOUND Patient HIS
 *   3. linkPatient — CONFLICT vínculo previo diferente
 *   4. unlinkPatient — happy path
 *   5. syncFromHis — crea nueva fila ECE (sin ecePacienteId)
 *   6. syncFromHis — BAD_REQUEST conflicto DUI
 *   7. syncToHis   — happy path (actualiza mrn si HIS vacío)
 *   8. syncToHis   — BAD_REQUEST sin vínculo public_patient_id
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
const MRN           = "EXP-2026-0001";

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

/** Construye un fixture row de ece.paciente con todas las columnas reales. */
function makeEceRow(overrides: Partial<{
  id: string;
  public_patient_id: string | null;
  establecimiento_id: string;
  numero_expediente: string;
  dui: string | null;
  nui: string | null;
  cun: string | null;
  carnet_minoridad: string | null;
  pasaporte: string | null;
  tipo_registro_identidad: string;
  estado_expediente: string;
  estado_registro: string;
  fallecido: boolean;
}> = {}) {
  return {
    id: ECE_ID,
    public_patient_id: null,
    establecimiento_id: ESTAB_ID,
    numero_expediente: MRN,
    dui: null,
    nui: null,
    cun: null,
    carnet_minoridad: null,
    pasaporte: null,
    tipo_registro_identidad: "verificado",
    estado_expediente: "activo",
    estado_registro: "vigente",
    fallecido: false,
    ...overrides,
  };
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

    // El router lee mrn + identifiers (no firstName/lastName/etc).
    prisma.patient.findFirst.mockResolvedValue({
      id: PATIENT_ID,
      mrn: MRN,
      identifiers: [{ kind: "DUI", value: "01234567-8" }],
    } as never);

    // INSERT RETURNING id
    prisma.$queryRaw.mockResolvedValueOnce([{ id: ECE_ID }]);

    const caller = makeCaller(prisma);
    const result = await caller.syncFromHis({ patientId: PATIENT_ID });

    expect(result.ecePacienteId).toBe(ECE_ID);
    expect(result.publicPatientId).toBe(PATIENT_ID);
    expect(result.fieldsUpdated).toContain("numero_expediente");
    expect(result.fieldsUpdated).toContain("dui");
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
      mrn: MRN,
      identifiers: [{ kind: "DUI", value: "09876543-2" }],
    } as never);

    // ece.paciente con DUI distinto (usando schema real).
    prisma.$queryRaw.mockResolvedValueOnce([
      makeEceRow({ dui: "01234567-8" }),
    ]);

    const caller = makeCaller(prisma);
    await expect(
      caller.syncFromHis({ patientId: PATIENT_ID, ecePacienteId: ECE_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("DUI") });
  });

  // ── 7. syncToHis — happy path ────────────────────────────────────────────

  it("syncToHis: actualiza mrn HIS desde numero_expediente cuando HIS está vacío", async () => {
    setupTransaction(prisma);

    // ece.paciente con vínculo y numero_expediente
    prisma.$queryRaw.mockResolvedValueOnce([
      makeEceRow({
        public_patient_id: PATIENT_ID,
        numero_expediente: "EXP-001",
        dui: "01234567-8",
      }),
    ]);

    // Patient HIS sin mrn (escenario donde el ECE tiene el valor canónico).
    prisma.patient.findFirst.mockResolvedValue({
      id: PATIENT_ID,
      mrn: null,
      identifiers: [{ kind: "DUI", value: "01234567-8" }],
    } as never);

    prisma.patient.update.mockResolvedValue({} as never);

    const caller = makeCaller(prisma);
    const result = await caller.syncToHis({ ecePacienteId: ECE_ID });

    expect(result.publicPatientId).toBe(PATIENT_ID);
    expect(result.fieldsUpdated).toContain("mrn");
    expect(prisma.patient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PATIENT_ID },
        data: expect.objectContaining({ mrn: "EXP-001" }),
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
      makeEceRow({ public_patient_id: null }),
    ]);

    const caller = makeCaller(prisma);
    await expect(
      caller.syncToHis({ ecePacienteId: ECE_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── 9. listLinkedPatients — paginación con nextCursor ────────────────────

  it("listLinkedPatients: devuelve nextCursor cuando hay más resultados que el límite", async () => {
    // El router ahora hace LEFT JOIN a public.Patient — shape distinta.
    const fakeRows = [
      { ece_id: "id-1", public_patient_id: PATIENT_ID, numero_expediente: "E-1", dui: null, first_name: "Ana",  last_name: "Pérez" },
      { ece_id: "id-2", public_patient_id: PATIENT_ID, numero_expediente: "E-2", dui: null, first_name: "Beto", last_name: "García" },
      { ece_id: "id-3", public_patient_id: PATIENT_ID, numero_expediente: "E-3", dui: null, first_name: "Cris", last_name: "Lima" },
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
      { ece_id: "id-1", public_patient_id: PATIENT_ID, numero_expediente: "E-1", dui: null, first_name: "Ana", last_name: "Pérez" },
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
