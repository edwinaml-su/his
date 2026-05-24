/**
 * Tests — US.F2.6.31-33 BCMA bedside: schemas Zod.
 *
 * Cubre:
 *   - recordBedsideAdminInput: campos GS1 requeridos y opcionales
 *   - cancelAdminInput: motivo min 10 chars
 *   - listByPatientInput: filtros fecha + status + limit
 *   - kardexStatsInput: rango de fechas
 */
import { describe, it, expect } from "vitest";
import {
  recordBedsideAdminInput,
  cancelAdminInput,
  listByPatientInput,
  kardexStatsInput,
} from "../medication-admin";

const VALID_UUID  = "00000000-0000-0000-0000-000000000001";
const GTIN        = "07501000001234";
const LOTE        = "L2024A";
// JCI Standard: IPSG.1 ME 2 — identificadores requeridos
const GSRN_PAX    = "801874130000000001";
const SECOND_ID   = { type: "DUI" as const, value: "01234567-8" };

// ---------------------------------------------------------------------------
// recordBedsideAdminInput
// ---------------------------------------------------------------------------
describe("recordBedsideAdminInput", () => {
  // Fixture mínimo válido con los 2 identificadores IPSG.1 requeridos
  const VALID_MIN = {
    indicationId:     VALID_UUID,
    gtin:             GTIN,
    lote:             LOTE,
    gsrnPaciente:     GSRN_PAX,
    secondIdentifier: SECOND_ID,
    nurseId:          VALID_UUID,
    patientId:        VALID_UUID,
  };

  it("acepta input mínimo válido con 2 identificadores IPSG.1", () => {
    const r = recordBedsideAdminInput.safeParse(VALID_MIN);
    expect(r.success).toBe(true);
  });

  it("acepta input completo con todos los campos GS1", () => {
    const r = recordBedsideAdminInput.safeParse({
      validationId:     VALID_UUID,
      indicationId:     VALID_UUID,
      gtin:             GTIN,
      lote:             LOTE,
      serie:            "21000001",
      glnUbicacion:     "7413000000001",
      gsrnPaciente:     GSRN_PAX,
      gsrnEnfermera:    "801874130000000002",
      secondIdentifier: SECOND_ID,
      nurseId:          VALID_UUID,
      patientId:        VALID_UUID,
      reservationId:    VALID_UUID,
      route:            "IV",
      site:             "Brazo izquierdo",
      notes:            "Sin incidentes",
    });
    expect(r.success).toBe(true);
  });

  it("acepta secondIdentifier tipo MRN", () => {
    const r = recordBedsideAdminInput.safeParse({
      ...VALID_MIN,
      secondIdentifier: { type: "MRN", value: "HIS-001234" },
    });
    expect(r.success).toBe(true);
  });

  it("rechaza si falta gsrnPaciente (primer identificador IPSG.1)", () => {
    const { gsrnPaciente: _, ...rest } = VALID_MIN;
    const r = recordBedsideAdminInput.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rechaza si falta secondIdentifier (segundo identificador IPSG.1)", () => {
    const { secondIdentifier: _, ...rest } = VALID_MIN;
    const r = recordBedsideAdminInput.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rechaza secondIdentifier tipo inválido", () => {
    const r = recordBedsideAdminInput.safeParse({
      ...VALID_MIN,
      secondIdentifier: { type: "PASSPORT", value: "A1234567" },
    });
    expect(r.success).toBe(false);
  });

  it("rechaza si indicationId no es UUID", () => {
    const r = recordBedsideAdminInput.safeParse({
      ...VALID_MIN,
      indicationId: "no-es-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza si gtin tiene menos de 8 chars", () => {
    const r = recordBedsideAdminInput.safeParse({
      ...VALID_MIN,
      gtin: "1234567", // 7 chars
    });
    expect(r.success).toBe(false);
  });

  it("rechaza si lote está vacío", () => {
    const r = recordBedsideAdminInput.safeParse({
      ...VALID_MIN,
      lote: "",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza route inválido", () => {
    const r = recordBedsideAdminInput.safeParse({
      ...VALID_MIN,
      route: "INTRAMUSCULAR_PROFUNDO", // no está en el enum
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cancelAdminInput
// ---------------------------------------------------------------------------
describe("cancelAdminInput", () => {
  it("acepta adminId UUID y motivo >= 10 chars", () => {
    const r = cancelAdminInput.safeParse({
      adminId:      VALID_UUID,
      cancelReason: "Error detectado en el GTIN escaneado",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza motivo con menos de 10 caracteres", () => {
    const r = cancelAdminInput.safeParse({
      adminId:      VALID_UUID,
      cancelReason: "Corto",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza motivo con más de 500 caracteres", () => {
    const r = cancelAdminInput.safeParse({
      adminId:      VALID_UUID,
      cancelReason: "A".repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it("rechaza si adminId no es UUID", () => {
    const r = cancelAdminInput.safeParse({
      adminId:      "no-uuid",
      cancelReason: "Motivo válido de cancelación",
    });
    expect(r.success).toBe(false);
  });

  it("trim() en cancelReason antes de validar longitud", () => {
    // "   " → trim → "" → length 0 → falla min(10)
    const r = cancelAdminInput.safeParse({
      adminId:      VALID_UUID,
      cancelReason: "   ",
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listByPatientInput
// ---------------------------------------------------------------------------
describe("listByPatientInput", () => {
  it("acepta solo patientId (todos los demás opcionales)", () => {
    const r = listByPatientInput.safeParse({ patientId: VALID_UUID });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(50); // default
    }
  });

  it("acepta filtro de status ADMINISTERED", () => {
    const r = listByPatientInput.safeParse({
      patientId: VALID_UUID,
      status:    "ADMINISTERED",
    });
    expect(r.success).toBe(true);
  });

  it("acepta filtro de status CANCELED", () => {
    const r = listByPatientInput.safeParse({
      patientId: VALID_UUID,
      status:    "CANCELED",
    });
    expect(r.success).toBe(true);
  });

  it("acepta rango de fechas", () => {
    const r = listByPatientInput.safeParse({
      patientId: VALID_UUID,
      fromDate:  "2026-05-01",
      toDate:    "2026-05-31",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.fromDate).toBeInstanceOf(Date);
    }
  });

  it("rechaza limit > 200", () => {
    const r = listByPatientInput.safeParse({
      patientId: VALID_UUID,
      limit:     201,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza si patientId no es UUID", () => {
    const r = listByPatientInput.safeParse({ patientId: "no-uuid" });
    expect(r.success).toBe(false);
  });

  it("rechaza status inválido", () => {
    const r = listByPatientInput.safeParse({
      patientId: VALID_UUID,
      status:    "INVALID_STATUS",
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// kardexStatsInput
// ---------------------------------------------------------------------------
describe("kardexStatsInput", () => {
  it("acepta rango fromDate/toDate como strings ISO", () => {
    const r = kardexStatsInput.safeParse({
      fromDate: "2026-05-01",
      toDate:   "2026-05-31",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.fromDate).toBeInstanceOf(Date);
      expect(r.data.toDate).toBeInstanceOf(Date);
    }
  });

  it("acepta objetos Date directamente", () => {
    const r = kardexStatsInput.safeParse({
      fromDate: new Date("2026-05-01"),
      toDate:   new Date("2026-05-31"),
    });
    expect(r.success).toBe(true);
  });

  it("rechaza si falta fromDate", () => {
    const r = kardexStatsInput.safeParse({ toDate: "2026-05-31" });
    expect(r.success).toBe(false);
  });

  it("rechaza si falta toDate", () => {
    const r = kardexStatsInput.safeParse({ fromDate: "2026-05-01" });
    expect(r.success).toBe(false);
  });
});
