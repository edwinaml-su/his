/**
 * epcis-builder.test.ts — Tests unitarios del constructor EPCIS
 *
 * Verifica que cada función construye las 5 dimensiones completas
 * WHAT / WHERE / WHEN / WHY / WHO y que el hash es reproducible.
 */

import { describe, it, expect } from "vitest";
import {
  buildBedsideEvent,
  buildDispensationEvent,
  buildSubstitutionEvent,
  buildLogisticsEvent,
  buildGsrnUrn,
  buildPatientMovementEvent,
  type PatientMovementSubtipo,
} from "../epcis-builder";

const BASE = {
  gtin: "07501000001234",
  lote: "L2024A",
  serial: "21000001",
  vencimiento: "261231",
  gsrnPaciente: "801874130000000001",
  gsrnProfesional: "801874130000000002",
  glnReadPoint: "7413000000001",
  indicationId: "00000000-0000-0000-0000-000000000001",
  timestamp: new Date("2026-05-18T10:00:00.000Z"),
  organizationId: "org-001",
  establecimientoId: "00000000-0000-0000-0000-000000000002",
};

describe("buildBedsideEvent", () => {
  it("construye WHAT con gtin, lote, serial y epcList", () => {
    const row = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });

    const what = row.what as Record<string, unknown>;
    expect(what.gtin).toBe(BASE.gtin);
    expect(what.lote).toBe(BASE.lote);
    expect(what.serial).toBe(BASE.serial);
    expect(Array.isArray(what.epcList)).toBe(true);
    expect((what.epcList as string[])[0]).toContain(BASE.gtin);
  });

  it("construye WHERE con readPoint GLN URN", () => {
    const row = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });

    const where = row.where_data as Record<string, unknown>;
    expect(typeof where.readPoint).toBe("string");
    expect((where.readPoint as string)).toContain(BASE.glnReadPoint);
  });

  it("construye WHEN con el timestamp de entrada", () => {
    const row = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });
    expect(row.event_time).toEqual(BASE.timestamp);
  });

  it("construye WHY con businessStep=administering y disposition=consumed", () => {
    const row = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });

    const why = row.why as Record<string, unknown>;
    expect(why.businessStep).toBe("administering");
    expect(why.disposition).toBe("consumed");
  });

  it("construye WHO con ambos GSRN", () => {
    const row = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });

    const who = row.who as Record<string, unknown>;
    const sources = who.sourceList as Array<Record<string, string>>;
    const gsrns = sources.map((s) => s.gsrn);
    expect(gsrns).toContain(BASE.gsrnProfesional);
    expect(gsrns).toContain(BASE.gsrnPaciente);
  });

  it("genera payload_hash SHA-256 de 64 caracteres hex", () => {
    const row = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });
    expect(row.payload_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("el hash es determinístico para el mismo input", () => {
    const r1 = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });
    const r2 = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });
    expect(r1.payload_hash).toBe(r2.payload_hash);
  });

  it("el hash difiere cuando cambia el gtin", () => {
    const r1 = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });
    const r2 = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN", gtin: "07501000009999" });
    expect(r1.payload_hash).not.toBe(r2.payload_hash);
  });

  it("establece tipo_evento = ObjectEvent y subtipo = BEDSIDE_ADMIN", () => {
    const row = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });
    expect(row.tipo_evento).toBe("ObjectEvent");
    expect(row.subtipo).toBe("BEDSIDE_ADMIN");
  });

  it("guarda indication_id cuando se provee", () => {
    const row = buildBedsideEvent({ ...BASE, type: "BEDSIDE_ADMIN" });
    expect(row.indication_id).toBe(BASE.indicationId);
  });

  it("indication_id es null cuando no se provee", () => {
    const { indicationId: _, ...noIndication } = BASE;
    const row = buildBedsideEvent({ ...noIndication, type: "BEDSIDE_ADMIN" });
    expect(row.indication_id).toBeNull();
  });
});

describe("buildDispensationEvent", () => {
  const dispInput = {
    ...BASE,
    type: "PHARMACY_DISPENSE" as const,
    glnOrigen: "7413000000001",
    glnDestino: "7413000000010",
  };

  it("construye WHY con businessStep=dispensing y disposition=dispensed", () => {
    const row = buildDispensationEvent(dispInput);

    const why = row.why as Record<string, unknown>;
    expect(why.businessStep).toBe("dispensing");
    expect(why.disposition).toBe("dispensed");
  });

  it("construye subtipo = PHARMACY_DISPENSE", () => {
    const row = buildDispensationEvent(dispInput);
    expect(row.subtipo).toBe("PHARMACY_DISPENSE");
  });

  it("readPoint usa glnOrigen", () => {
    const row = buildDispensationEvent(dispInput);
    const where = row.where_data as Record<string, unknown>;
    expect((where.readPoint as string)).toContain(dispInput.glnOrigen);
  });

  it("WHAT tiene 5 dimensiones EPCIS completas en la fila", () => {
    const row = buildDispensationEvent(dispInput);
    // Verifica que existen todas las propiedades clave
    expect(row).toHaveProperty("what");
    expect(row).toHaveProperty("where_data");
    expect(row).toHaveProperty("event_time");
    expect(row).toHaveProperty("why");
    expect(row).toHaveProperty("who");
  });
});

describe("buildSubstitutionEvent", () => {
  const substInput = {
    ...BASE,
    type: "SUBSTITUTION" as const,
    gtinOriginal: "07501000001111",
  };

  it("incluye gtinOriginal en WHAT", () => {
    const row = buildSubstitutionEvent(substInput);
    const what = row.what as Record<string, unknown>;
    expect(what.gtinOriginal).toBe(substInput.gtinOriginal);
    expect(what.gtin).toBe(BASE.gtin);
  });

  it("tipo_evento = TransactionEvent", () => {
    const row = buildSubstitutionEvent(substInput);
    expect(row.tipo_evento).toBe("TransactionEvent");
    expect(row.subtipo).toBe("SUBSTITUTION");
  });

  it("businessStep = accepting", () => {
    const row = buildSubstitutionEvent(substInput);
    const why = row.why as Record<string, unknown>;
    expect(why.businessStep).toBe("accepting");
  });
});

describe("buildLogisticsEvent", () => {
  const logBase = {
    gtin: "07501000001234",
    lote: "L2024A",
    glnReadPoint: "7413000000001",
    timestamp: new Date("2026-06-16T08:00:00.000Z"),
    establecimientoId: "00000000-0000-0000-0000-000000000002",
  };

  it("RECEPTION → ObjectEvent, businessStep=receiving", () => {
    const row = buildLogisticsEvent({ ...logBase, type: "RECEPTION" });
    expect(row.tipo_evento).toBe("ObjectEvent");
    expect(row.subtipo).toBe("RECEPTION");
    expect((row.why as Record<string, unknown>).businessStep).toBe("receiving");
  });

  it("FRACTIONATION → TransformationEvent (repackaging)", () => {
    const row = buildLogisticsEvent({ ...logBase, type: "FRACTIONATION" });
    expect(row.tipo_evento).toBe("TransformationEvent");
    expect((row.why as Record<string, unknown>).businessStep).toBe("repackaging");
  });

  it("QUARANTINE refleja disposition=recall", () => {
    const row = buildLogisticsEvent({ ...logBase, type: "QUARANTINE" });
    expect((row.why as Record<string, unknown>).disposition).toBe("recall");
  });

  it("genera payload_hash SHA-256 de 64 hex", () => {
    const row = buildLogisticsEvent({ ...logBase, type: "STORAGE" });
    expect(row.payload_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// =============================================================================
// ADR 0019 — buildGsrnUrn / buildPatientMovementEvent
// (trazabilidad EPCIS del movimiento físico del paciente)
// =============================================================================

describe("buildGsrnUrn", () => {
  // GSRN-18 = CompanyPrefix(7503000, 7d) + ServiceReference(0000000123, 10d) + CheckDigit(4, 1d).
  // El check digit es irrelevante para buildGsrnUrn — se descarta siempre (posición 18).
  const GSRN_18 = "750300000000001234";

  it("descarta el check digit (posición 18)", () => {
    const urn = buildGsrnUrn(GSRN_18, 7);
    expect(urn).toBe("urn:epc:id:gsrn:7503000.0000000123");
    // El check digit '4' (posición 18) no debe aparecer en la URN.
    expect(urn.endsWith("4")).toBe(false);
  });

  it("ubica el punto de corte según companyPrefixLength (8 dígitos)", () => {
    // 18 dígitos: prefijo(8) + referencia(9) + check digit(1, descartado).
    const fixture = "12345678" + "123456789" + "0";
    expect(fixture).toHaveLength(18);
    const urn = buildGsrnUrn(fixture, 8);
    expect(urn).toBe("urn:epc:id:gsrn:12345678.123456789");
  });

  it("usa el formato urn:epc:id:gsrn:<prefix>.<ref> (EPC Tag Data Standard)", () => {
    const urn = buildGsrnUrn(GSRN_18, 7);
    expect(urn).toMatch(/^urn:epc:id:gsrn:\d{7}\.\d{10}$/);
  });

  it("lanza si el GSRN no tiene 18 dígitos numéricos", () => {
    expect(() => buildGsrnUrn("12345", 7)).toThrow(/18 dígitos/);
    expect(() => buildGsrnUrn("7503000000000012X4", 7)).toThrow(/18 dígitos/);
  });

  it("lanza si companyPrefixLength está fuera de rango 7-9", () => {
    expect(() => buildGsrnUrn(GSRN_18, 6)).toThrow(/companyPrefixLength/);
    expect(() => buildGsrnUrn(GSRN_18, 10)).toThrow(/companyPrefixLength/);
  });

  it("es determinístico para el mismo input", () => {
    const a = buildGsrnUrn(GSRN_18, 7);
    const b = buildGsrnUrn(GSRN_18, 7);
    expect(a).toBe(b);
  });
});

describe("buildPatientMovementEvent", () => {
  const PM_BASE = {
    gsrnPaciente: "750300000000001234",
    companyPrefixLength: 7,
    glnReadPoint: "7413000000001",
    glnBizLocation: "7413000000018" as string | null,
    internalRef: {
      bedId: "00000000-0000-0000-0000-0000000000b1",
      serviceUnitId: "00000000-0000-0000-0000-0000000000s1",
      establishmentId: "00000000-0000-0000-0000-0000000000e1",
    },
    encounterId: "00000000-0000-0000-0000-0000000000ec",
    recordedById: "00000000-0000-0000-0000-0000000000u1",
    timestamp: new Date("2026-08-18T12:00:00.000Z"),
    establecimientoId: "00000000-0000-0000-0000-0000000000ee",
  };

  const STEP_BY_TYPE: Record<PatientMovementSubtipo, { businessStep: string; disposition: string }> = {
    PATIENT_ADMISSION: { businessStep: "arriving", disposition: "active" },
    PATIENT_TRANSFER_DEPARTURE: { businessStep: "departing", disposition: "in_transit" },
    PATIENT_TRANSFER_ARRIVAL: { businessStep: "arriving", disposition: "active" },
    PATIENT_DISCHARGE: { businessStep: "departing", disposition: "inactive" },
  };

  it("tipo_evento siempre ObjectEvent, subtipo = input.type", () => {
    for (const type of Object.keys(STEP_BY_TYPE) as PatientMovementSubtipo[]) {
      const row = buildPatientMovementEvent({ ...PM_BASE, type });
      expect(row.tipo_evento).toBe("ObjectEvent");
      expect(row.subtipo).toBe(type);
      expect(row.status).toBe("COMMITTED");
    }
  });

  it("WHAT: epcList con la URN del GSRN + gsrn en claro para lectura humana", () => {
    const row = buildPatientMovementEvent({ ...PM_BASE, type: "PATIENT_ADMISSION" });
    const what = row.what as { epcList: string[]; gsrn: string };
    expect(what.epcList).toEqual([buildGsrnUrn(PM_BASE.gsrnPaciente, PM_BASE.companyPrefixLength)]);
    expect(what.gsrn).toBe(PM_BASE.gsrnPaciente);
  });

  it("WHERE: readPoint/bizLocation como URN SGLN + internalRef con los IDs opacos", () => {
    const row = buildPatientMovementEvent({ ...PM_BASE, type: "PATIENT_TRANSFER_DEPARTURE" });
    const where = row.where_data as {
      readPoint: string | null;
      bizLocation: string | null;
      internalRef: typeof PM_BASE.internalRef;
    };
    expect(where.readPoint).toBe(`urn:epc:id:sgln:${PM_BASE.glnReadPoint}`);
    expect(where.bizLocation).toBe(`urn:epc:id:sgln:${PM_BASE.glnBizLocation}`);
    expect(where.internalRef).toEqual(PM_BASE.internalRef);
  });

  it("WHERE: readPoint/bizLocation son null cuando el GLN no está resuelto (ADR 0019 D8)", () => {
    const row = buildPatientMovementEvent({
      ...PM_BASE,
      type: "PATIENT_ADMISSION",
      glnReadPoint: null,
      glnBizLocation: null,
    });
    const where = row.where_data as { readPoint: string | null; bizLocation: string | null };
    expect(where.readPoint).toBeNull();
    expect(where.bizLocation).toBeNull();
  });

  it("WHEN: event_time = input.timestamp", () => {
    const row = buildPatientMovementEvent({ ...PM_BASE, type: "PATIENT_DISCHARGE" });
    expect(row.event_time).toEqual(PM_BASE.timestamp);
  });

  it.each(Object.keys(STEP_BY_TYPE) as PatientMovementSubtipo[])(
    "WHY: businessStep/disposition correctos para %s (tabla D3/D4)",
    (type) => {
      const row = buildPatientMovementEvent({ ...PM_BASE, type });
      const why = row.why as { businessStep: string; disposition: string };
      expect(why.businessStep).toBe(STEP_BY_TYPE[type].businessStep);
      expect(why.disposition).toBe(STEP_BY_TYPE[type].disposition);
    },
  );

  it("WHY: bizTransactionList referencia encounterId (sin transferId si no se provee)", () => {
    const row = buildPatientMovementEvent({ ...PM_BASE, type: "PATIENT_ADMISSION" });
    const why = row.why as { bizTransactionList: { type: string; id: string }[] };
    expect(why.bizTransactionList).toEqual([{ type: "encounter", id: PM_BASE.encounterId }]);
  });

  it("WHY: bizTransactionList incluye transferId en PATIENT_TRANSFER_*", () => {
    const transferId = "00000000-0000-0000-0000-0000000000tr";
    const row = buildPatientMovementEvent({
      ...PM_BASE,
      type: "PATIENT_TRANSFER_ARRIVAL",
      transferId,
    });
    const why = row.why as { bizTransactionList: { type: string; id: string }[] };
    expect(why.bizTransactionList).toEqual([
      { type: "encounter", id: PM_BASE.encounterId },
      { type: "transfer", id: transferId },
    ]);
  });

  it("WHO: sourceList con possessing_party=GSRN paciente + recordedById", () => {
    const row = buildPatientMovementEvent({ ...PM_BASE, type: "PATIENT_ADMISSION" });
    const who = row.who as {
      sourceList: { type: string; gsrn: string }[];
      recordedById: string;
    };
    expect(who.sourceList).toEqual([
      { type: "urn:epcglobal:cbv:sdt:possessing_party", gsrn: PM_BASE.gsrnPaciente },
    ]);
    expect(who.recordedById).toBe(PM_BASE.recordedById);
  });

  it("genera payload_hash SHA-256 de 64 hex, determinístico para el mismo input", () => {
    const r1 = buildPatientMovementEvent({ ...PM_BASE, type: "PATIENT_ADMISSION" });
    const r2 = buildPatientMovementEvent({ ...PM_BASE, type: "PATIENT_ADMISSION" });
    expect(r1.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r1.payload_hash).toBe(r2.payload_hash);
  });

  it("establecimiento_id = input.establecimientoId (ece.establecimiento.id, no público)", () => {
    const row = buildPatientMovementEvent({ ...PM_BASE, type: "PATIENT_ADMISSION" });
    expect(row.establecimiento_id).toBe(PM_BASE.establecimientoId);
  });

  // ── Test de cumplimiento (dictamen @AE §4 restricción 4) ──────────────────
  // "Payload limitado a identificadores opacos, cero texto libre, cero PHI
  // directa (nombre/documento/diagnóstico)." Este test NO es cosmético: si
  // alguien agrega un campo de texto libre al builder, debe fallar aquí.

  it("cumplimiento: ninguna dimensión incluye PHI directa (nombre/documento/diagnóstico)", () => {
    const row = buildPatientMovementEvent({
      ...PM_BASE,
      type: "PATIENT_TRANSFER_DEPARTURE",
      transferId: "00000000-0000-0000-0000-0000000000tr",
    });
    const serialized = JSON.stringify({ what: row.what, where_data: row.where_data, why: row.why, who: row.who });

    // Prohibiciones explícitas del dictamen §3.2/§4.4: sin nombre, DUI/NIE/NIT,
    // diagnóstico, ni el motivo clínico en texto libre (EncounterTransfer.reason).
    // \b evita falsos positivos con substrings legítimos (ej. "serviceUnitId" ⊃ "nit").
    const forbiddenPatterns = [/\bnombre\b/, /\bname\b/, /\bdui\b/, /\bnie\b/, /\bnit\b/, /diagnos/, /\breason\b/, /\bmotivo\b/];
    const lower = serialized.toLowerCase();
    for (const pattern of forbiddenPatterns) {
      expect(lower).not.toMatch(pattern);
    }
  });

  it("cumplimiento: WHAT/WHERE/WHY/WHO solo exponen las claves documentadas en ADR 0019 D5", () => {
    const row = buildPatientMovementEvent({ ...PM_BASE, type: "PATIENT_ADMISSION" });

    expect(Object.keys(row.what as object).sort()).toEqual(["epcList", "gsrn"].sort());
    expect(Object.keys(row.where_data as object).sort()).toEqual(
      ["readPoint", "bizLocation", "internalRef"].sort(),
    );
    expect(Object.keys(row.why as object).sort()).toEqual(
      ["businessStep", "disposition", "bizTransactionList"].sort(),
    );
    expect(Object.keys(row.who as object).sort()).toEqual(["sourceList", "recordedById"].sort());
  });

  it("cumplimiento: internalRef solo lleva IDs opacos (bedId/serviceUnitId/establishmentId), nunca nombres", () => {
    const row = buildPatientMovementEvent({ ...PM_BASE, type: "PATIENT_ADMISSION" });
    const where = row.where_data as { internalRef: Record<string, unknown> };
    expect(Object.keys(where.internalRef).sort()).toEqual(
      ["bedId", "serviceUnitId", "establishmentId"].sort(),
    );
  });
});
