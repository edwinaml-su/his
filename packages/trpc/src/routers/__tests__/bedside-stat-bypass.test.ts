/**
 * Tests — Modo STAT server-side (US.F2.6.47): downgrade de hard-stops
 * bypassables a warning en bedside.validate5Correctos + enlace de la
 * administración a la sesión STAT en bedside.administration.record.
 *
 * Cubre las dos rutas, con y sin sesión STAT activa:
 *  validate5Correctos
 *   1. Sin STAT: PACIENTE_NO_COINCIDE sigue siendo hard-stop (sin UPDATE stat_event)
 *   2. Con STAT: PACIENTE_NO_COINCIDE degrada a warning + rastro completo
 *      (ledger bedside_validation con [STAT_BYPASS] + stat_event.hard_stops_bypassed)
 *   3. Con STAT: FUERA_DE_VENTANA degrada y el merge conserva bypasses previos
 *   4. Con STAT: DOSIS_INCORRECTA (NO bypassable) sigue bloqueando
 *   5. Happy path: no se consulta ece.stat_event (lookup lazy)
 *  administration.record
 *   6. Sin STAT: statEventId null
 *   7. Con STAT: enlaza medication_administration_id y retorna statEventId
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { bedsideRouter } from "../bedside.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID_ORG        = "aaaaaaaa-0000-0000-0000-000000000001";
const UUID_PATIENT    = "bbbbbbbb-0000-0000-0000-000000000001";
const UUID_PATIENT_2  = "bbbbbbbb-0000-0000-0000-000000000002";
const UUID_USER       = "cccccccc-0000-0000-0000-000000000001";
const UUID_PRESC      = "dddddddd-0000-0000-0000-000000000001";
const UUID_ADMIN      = "eeeeeeee-0000-0000-0000-000000000001";
const UUID_DRUG       = "eeeeeeee-0000-0000-0000-000000000002";
const UUID_INDICATION = "ffffffff-0000-0000-0000-000000000001";
const UUID_STAT       = "99999999-0000-0000-0000-000000000001";

const GSRN_PATIENT = "801874130000000018";
const GSRN_NURSE   = "801874130000000019";
const GTIN_OK      = "07501000001234";
const GTIN_OTRO    = "07501000009999";
const DM_OK        = `(01)${GTIN_OK}(10)L2024A(17)261231(21)SER0001`;

const STAT_ROW = { id: UUID_STAT, hard_stops_bypassed: [] as string[] };

const INDICATION_BASE = {
  id: UUID_INDICATION,
  patient_id: UUID_PATIENT,
  patient_gsrn: GSRN_PATIENT,
  gtin: GTIN_OK,
  dose: "500mg",
  route: "oral",
  frequency: "cada 8h",
  status: "ACTIVA",
};

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

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  // resolveEceEstablecimientoId (fuera de la tx demotada) usa $queryRaw tagged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$queryRaw = vi
    .fn()
    .mockResolvedValue([{ id: "eeeeeeee-0000-0000-0000-00000000000e" }]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$executeRawUnsafe = vi.fn().mockResolvedValue(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$transaction = vi.fn().mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(prisma),
  );
});

/** Mocks por SQL (dispatcher) para el flujo validate5Correctos. */
function installValidateMocks(opts: {
  indication?: Record<string, unknown>;
  statRows?: unknown[];
  presentacion?: string;
  lastAdminRows?: unknown[];
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("FROM ece.gs1_gsrn"))
      return Promise.resolve([{ referencia_id: UUID_PATIENT, activo: true }]);
    if (sql.includes("FROM ece.indicaciones_medicas i"))
      return Promise.resolve([opts.indication ?? INDICATION_BASE]);
    if (sql.includes("FROM ece.stat_event"))
      return Promise.resolve(opts.statRows ?? []);
    if (sql.includes("FROM ece.gs1_gtin"))
      return Promise.resolve([{ presentacion: opts.presentacion ?? "Amoxicilina 500mg/cap" }]);
    if (sql.includes('FROM "MedicationAdministration"'))
      return Promise.resolve(opts.lastAdminRows ?? []);
    if (sql.includes("INSERT INTO ece.bedside_validation"))
      return Promise.resolve([{ id: "validation-1" }]);
    return Promise.resolve([{ current_user: "authenticated" }]);
  });
}

/** Mocks por SQL para administration.record. */
function installRecordMocks(opts: { statUpdateRows?: unknown[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("FROM ece.gs1_gsrn"))
      return Promise.resolve([{ referencia_id: UUID_PATIENT }]);
    if (sql.includes('FROM "StaffGsrn"'))
      return Promise.resolve([{ user_id: UUID_USER }]);
    if (sql.includes("SELECT prescription_item_id"))
      return Promise.resolve([{ prescription_item_id: UUID_PRESC }]);
    if (sql.includes("ii.frecuencia"))
      return Promise.resolve([{ fecha_hora: null, frecuencia: null }]);
    if (sql.includes('WHERE d."active"'))
      return Promise.resolve([]);
    if (sql.includes('"PrescriptionItem" pi'))
      return Promise.resolve([{ drug_id: UUID_DRUG, alert_level: "standard" }]);
    if (sql.includes("lasa_pair"))
      return Promise.resolve([]);
    if (sql.includes("UPDATE ece.stat_event"))
      return Promise.resolve(opts.statUpdateRows ?? []);
    return Promise.resolve([{ current_user: "authenticated" }]);
  });
  prisma.medicationAdministration.create.mockResolvedValue({ id: UUID_ADMIN } as never);
}

function baseValidateInput() {
  return {
    gsrnEnfermera:  GSRN_NURSE,
    gsrnPaciente:   GSRN_PATIENT,
    gs1Medicamento: DM_OK,
    indicationId:   UUID_INDICATION,
    timestamp:      new Date(),
  };
}

function baseRecordInput() {
  return {
    patientGsrn:     GSRN_PATIENT,
    staffGsrn:       GSRN_NURSE,
    medicamentoGtin: GTIN_OK,
    lote:            "L2024A",
    dosis:           "500mg/cap",
    via:             "IV" as const,
    indicationId:    UUID_INDICATION,
  };
}

/** Calls a $executeRawUnsafe cuyo SQL contiene el fragmento dado. */
function execCallsContaining(fragment: string): unknown[][] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma.$executeRawUnsafe as any).mock.calls.filter((c: unknown[]) =>
    String(c[0]).includes(fragment),
  );
}

// ---------------------------------------------------------------------------
// validate5Correctos — sin STAT
// ---------------------------------------------------------------------------

describe("validate5Correctos sin sesión STAT", () => {
  it("PACIENTE_NO_COINCIDE sigue siendo hard-stop y no toca stat_event", async () => {
    installValidateMocks({
      indication: { ...INDICATION_BASE, patient_id: UUID_PATIENT_2 },
      statRows: [], // sin sesión abierta
    });

    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseValidateInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("PACIENTE_NO_COINCIDE");
    }
    expect(execCallsContaining("UPDATE ece.stat_event")).toHaveLength(0);
    // El ledger registra la detección sin prefijo STAT.
    const ledger = execCallsContaining("INSERT INTO ece.bedside_validation");
    expect(ledger).toHaveLength(1);
    expect(
      ledger[0]!.some((p) => typeof p === "string" && p.includes("[STAT_BYPASS")),
    ).toBe(false);
  });

  it("happy path no consulta ece.stat_event (lookup lazy)", async () => {
    installValidateMocks({ statRows: [STAT_ROW] });

    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseValidateInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.statBypass).toBeUndefined();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statLookups = (prisma.$queryRawUnsafe as any).mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("FROM ece.stat_event"),
    );
    expect(statLookups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validate5Correctos — con STAT
// ---------------------------------------------------------------------------

describe("validate5Correctos con sesión STAT activa", () => {
  it("PACIENTE_NO_COINCIDE degrada a warning con rastro completo", async () => {
    installValidateMocks({
      indication: { ...INDICATION_BASE, patient_id: UUID_PATIENT_2 },
      statRows: [STAT_ROW],
    });

    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseValidateInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validationId).toBe("validation-1");
      expect(result.statBypass).toBeDefined();
      expect(result.statBypass!.statEventId).toBe(UUID_STAT);
      expect(result.statBypass!.warnings).toHaveLength(1);
      expect(result.statBypass!.warnings[0]!.hardStop).toBe("PACIENTE_NO_COINCIDE");
    }

    // Ledger inmutable: la detección se persiste igual, marcada como bypass.
    const ledger = execCallsContaining("INSERT INTO ece.bedside_validation");
    expect(ledger).toHaveLength(1);
    expect(
      ledger[0]!.some(
        (p) => typeof p === "string" && p.includes(`[STAT_BYPASS ${UUID_STAT}]`),
      ),
    ).toBe(true);

    // stat_event registra server-side qué hard-stop se degradó.
    const statUpdates = execCallsContaining("UPDATE ece.stat_event");
    expect(statUpdates).toHaveLength(1);
    expect(statUpdates[0]![1]).toBe(UUID_STAT);
    expect(statUpdates[0]![2]).toBe(JSON.stringify(["PACIENTE_NO_COINCIDE"]));
    expect(statUpdates[0]![3]).toBe(UUID_ORG);
  });

  it("FUERA_DE_VENTANA degrada y el merge conserva bypasses previos", async () => {
    installValidateMocks({
      statRows: [{ id: UUID_STAT, hard_stops_bypassed: ["PACIENTE_NO_COINCIDE"] }],
      // última admin hace 1h con frecuencia 8h → fuera de ventana
      lastAdminRows: [{ administered_at: new Date(Date.now() - 60 * 60_000) }],
    });

    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseValidateInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.statBypass!.warnings.map((w) => w.hardStop)).toEqual([
        "FUERA_DE_VENTANA",
      ]);
    }

    const statUpdates = execCallsContaining("UPDATE ece.stat_event");
    expect(statUpdates).toHaveLength(1);
    const merged = JSON.parse(String(statUpdates[0]![2])) as string[];
    expect(merged).toContain("PACIENTE_NO_COINCIDE");
    expect(merged).toContain("FUERA_DE_VENTANA");
  });

  it("MEDICAMENTO_NO_COINCIDE degrada a warning", async () => {
    installValidateMocks({
      indication: { ...INDICATION_BASE, gtin: GTIN_OTRO, dose: null },
      statRows: [STAT_ROW],
    });

    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseValidateInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.statBypass!.warnings.map((w) => w.hardStop)).toEqual([
        "MEDICAMENTO_NO_COINCIDE",
      ]);
    }
  });

  it("DOSIS_INCORRECTA (NO bypassable) sigue bloqueando aunque haya STAT", async () => {
    installValidateMocks({
      indication: { ...INDICATION_BASE, dose: "1000mg" },
      presentacion: "Amoxicilina 500mg/cap", // no coincide con 1000mg
      statRows: [STAT_ROW],
    });

    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseValidateInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("DOSIS_INCORRECTA");
    }
    expect(execCallsContaining("UPDATE ece.stat_event")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// administration.record — enlace de la sesión STAT
// ---------------------------------------------------------------------------

describe("administration.record y sesión STAT", () => {
  it("sin sesión STAT abierta retorna statEventId null", async () => {
    installRecordMocks({ statUpdateRows: [] });

    const caller = makeCaller();
    const result = await caller.administration.record(baseRecordInput());

    expect(result.administrationId).toBe(UUID_ADMIN);
    expect(result.statEventId).toBeNull();
  });

  it("con sesión STAT abierta enlaza la administración y retorna statEventId", async () => {
    installRecordMocks({ statUpdateRows: [{ id: UUID_STAT }] });

    const caller = makeCaller();
    const result = await caller.administration.record(baseRecordInput());

    expect(result.administrationId).toBe(UUID_ADMIN);
    expect(result.statEventId).toBe(UUID_STAT);

    // El UPDATE enlaza medication_administration_id server-side.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statUpdate = (prisma.$queryRawUnsafe as any).mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("UPDATE ece.stat_event"),
    );
    expect(statUpdate).toBeDefined();
    expect(String(statUpdate![0])).toContain("medication_administration_id");
    expect(statUpdate!.slice(1)).toEqual([UUID_ORG, UUID_INDICATION, UUID_ADMIN]);
  });
});
