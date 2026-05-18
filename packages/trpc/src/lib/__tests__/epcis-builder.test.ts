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
