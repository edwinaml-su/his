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

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const GTIN       = "07501000001234";
const LOTE       = "L2024A";

// ---------------------------------------------------------------------------
// recordBedsideAdminInput
// ---------------------------------------------------------------------------
describe("recordBedsideAdminInput", () => {
  it("acepta input mínimo válido (sin campos opcionales)", () => {
    const r = recordBedsideAdminInput.safeParse({
      indicationId:  VALID_UUID,
      gtin:          GTIN,
      lote:          LOTE,
      nurseId:       VALID_UUID,
      patientId:     VALID_UUID,
    });
    expect(r.success).toBe(true);
  });

  it("acepta input completo con todos los campos GS1", () => {
    const r = recordBedsideAdminInput.safeParse({
      validationId:  VALID_UUID,
      indicationId:  VALID_UUID,
      gtin:          GTIN,
      lote:          LOTE,
      serie:         "21000001",
      glnUbicacion:  "7413000000001",
      gsrnPaciente:  "801874130000000001",
      gsrnEnfermera: "801874130000000002",
      nurseId:       VALID_UUID,
      patientId:     VALID_UUID,
      reservationId: VALID_UUID,
      route:         "IV",
      site:          "Brazo izquierdo",
      notes:         "Sin incidentes",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza si indicationId no es UUID", () => {
    const r = recordBedsideAdminInput.safeParse({
      indicationId: "no-es-uuid",
      gtin:         GTIN,
      lote:         LOTE,
      nurseId:      VALID_UUID,
      patientId:    VALID_UUID,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza si gtin tiene menos de 8 chars", () => {
    const r = recordBedsideAdminInput.safeParse({
      indicationId: VALID_UUID,
      gtin:         "1234567", // 7 chars
      lote:         LOTE,
      nurseId:      VALID_UUID,
      patientId:    VALID_UUID,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza si lote está vacío", () => {
    const r = recordBedsideAdminInput.safeParse({
      indicationId: VALID_UUID,
      gtin:         GTIN,
      lote:         "",
      nurseId:      VALID_UUID,
      patientId:    VALID_UUID,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza route inválido", () => {
    const r = recordBedsideAdminInput.safeParse({
      indicationId: VALID_UUID,
      gtin:         GTIN,
      lote:         LOTE,
      nurseId:      VALID_UUID,
      patientId:    VALID_UUID,
      route:        "INTRAMUSCULAR_PROFUNDO", // no está en el enum
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
