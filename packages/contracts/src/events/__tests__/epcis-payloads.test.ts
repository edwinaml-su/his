/**
 * epcis-payloads.test.ts — Verifica que los schemas de eventos GS1 EPCIS
 * y Farmacovigilancia están correctamente registrados en el discriminated union.
 *
 * US.F2.6.53-58
 */

import { describe, it, expect } from "vitest";
import {
  domainEventPayloadSchema,
  gs1EpcisDispensacionPayloadSchema,
  gs1EpcisBedsidePayloadSchema,
  gs1EpcisSubstitucionPayloadSchema,
  farmacovigilanciaAlergiaPayloadSchema,
  farmacovigilanciaRecallPayloadSchema,
  farmacovigilanciaDobleDispPayloadSchema,
  farmacovigilanciaVencidoPayloadSchema,
} from "../payloads";
import { EVENT_TYPES } from "../catalog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ESTAB_ID = "00000000-0000-0000-0000-000000000001";
const PATIENT_ID = "00000000-0000-0000-0000-000000000002";
const ALLERGY_ID = "00000000-0000-0000-0000-000000000003";
const DRUG_ID = "00000000-0000-0000-0000-000000000004";
const PRES_ID = "00000000-0000-0000-0000-000000000005";
const INC_ID = "00000000-0000-0000-0000-000000000006";

const BASE_EPCIS = {
  epcisEventId: "00000000-0000-0000-0000-000000000007",
  what: { gtin: "07501000001234" },
  where: { readPoint: "7413000000001" },
  why: { businessStep: "administering" as const, disposition: "consumed" as const },
  who: {},
  payloadHash: "a".repeat(64),
  establecimientoId: ESTAB_ID,
};

const BASE_INC = {
  incidentId: INC_ID,
  severity: "HIGH" as const,
  patientId: PATIENT_ID,
  gtin: "07501000001234",
  establecimientoId: ESTAB_ID,
  detectedAt: "2026-05-18T10:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

describe("EVENT_TYPES catalog", () => {
  it("incluye los 7 nuevos eventTypes de GS1/Farmacovigilancia", () => {
    const required = [
      "gs1.epcis.dispensacion",
      "gs1.epcis.bedside",
      "gs1.epcis.sustitucion",
      "farmacovigilancia.alergia_detectada",
      "farmacovigilancia.recall_detectado",
      "farmacovigilancia.doble_dispensacion",
      "farmacovigilancia.dosis_vencida",
    ];
    for (const et of required) {
      expect(EVENT_TYPES).toContain(et);
    }
  });
});

// ---------------------------------------------------------------------------
// Schemas individuales
// ---------------------------------------------------------------------------

describe("gs1EpcisDispensacionPayloadSchema", () => {
  it("valida un payload correcto de dispensación", () => {
    const result = gs1EpcisDispensacionPayloadSchema.safeParse({
      ...BASE_EPCIS,
      tipoEvento: "ObjectEvent",
      subtipo: "PHARMACY_DISPENSE",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza subtipo incorrecto", () => {
    const result = gs1EpcisDispensacionPayloadSchema.safeParse({
      ...BASE_EPCIS,
      tipoEvento: "ObjectEvent",
      subtipo: "BEDSIDE_ADMIN",  // incorrecto para dispensación
    });
    expect(result.success).toBe(false);
  });
});

describe("gs1EpcisBedsidePayloadSchema", () => {
  it("valida un payload correcto de bedside", () => {
    const result = gs1EpcisBedsidePayloadSchema.safeParse({
      ...BASE_EPCIS,
      tipoEvento: "ObjectEvent",
      subtipo: "BEDSIDE_ADMIN",
    });
    expect(result.success).toBe(true);
  });

  it("acepta indicationId opcional", () => {
    const result = gs1EpcisBedsidePayloadSchema.safeParse({
      ...BASE_EPCIS,
      tipoEvento: "ObjectEvent",
      subtipo: "BEDSIDE_ADMIN",
      indicationId: "00000000-0000-0000-0000-000000000010",
    });
    expect(result.success).toBe(true);
  });
});

describe("gs1EpcisSubstitucionPayloadSchema", () => {
  it("valida un payload de sustitución con gtinOriginal", () => {
    const result = gs1EpcisSubstitucionPayloadSchema.safeParse({
      ...BASE_EPCIS,
      tipoEvento: "TransactionEvent",
      subtipo: "SUBSTITUTION",
      gtinOriginal: "07501000009999",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza sin gtinOriginal", () => {
    const result = gs1EpcisSubstitucionPayloadSchema.safeParse({
      ...BASE_EPCIS,
      tipoEvento: "TransactionEvent",
      subtipo: "SUBSTITUTION",
      // sin gtinOriginal
    });
    expect(result.success).toBe(false);
  });
});

describe("farmacovigilanciaAlergiaPayloadSchema", () => {
  it("valida un payload de alergia detectada", () => {
    const result = farmacovigilanciaAlergiaPayloadSchema.safeParse({
      ...BASE_INC,
      tipo: "ALERGIA_DETECTADA",
      allergyId: ALLERGY_ID,
      drugId: DRUG_ID,
      prescriberId: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("farmacovigilanciaRecallPayloadSchema", () => {
  it("valida un payload de recall detectado", () => {
    const result = farmacovigilanciaRecallPayloadSchema.safeParse({
      ...BASE_INC,
      tipo: "RECALL_DETECTADO",
      lote: "L2024A",
      glnUbicacion: "7413000000010",
    });
    expect(result.success).toBe(true);
  });

  it("requiere lote", () => {
    const result = farmacovigilanciaRecallPayloadSchema.safeParse({
      ...BASE_INC,
      tipo: "RECALL_DETECTADO",
    });
    expect(result.success).toBe(false);
  });
});

describe("farmacovigilanciaDobleDispPayloadSchema", () => {
  it("valida un payload de doble dispensación", () => {
    const result = farmacovigilanciaDobleDispPayloadSchema.safeParse({
      ...BASE_INC,
      tipo: "DOBLE_DISPENSACION",
      prescriptionItemId: PRES_ID,
      ventanaHoras: 8,
    });
    expect(result.success).toBe(true);
  });
});

describe("farmacovigilanciaVencidoPayloadSchema", () => {
  it("valida un payload de dosis vencida", () => {
    const result = farmacovigilanciaVencidoPayloadSchema.safeParse({
      ...BASE_INC,
      tipo: "DOSIS_VENCIDA",
      lote: "L2024A",
      vencimiento: "2024-01-01",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// domainEventPayloadSchema — discriminated union
// ---------------------------------------------------------------------------

describe("domainEventPayloadSchema (discriminated union)", () => {
  it("acepta gs1.epcis.bedside con payload correcto", () => {
    const result = domainEventPayloadSchema.safeParse({
      eventType: "gs1.epcis.bedside",
      payload: {
        ...BASE_EPCIS,
        tipoEvento: "ObjectEvent",
        subtipo: "BEDSIDE_ADMIN",
      },
    });
    expect(result.success).toBe(true);
  });

  it("acepta gs1.epcis.dispensacion", () => {
    const result = domainEventPayloadSchema.safeParse({
      eventType: "gs1.epcis.dispensacion",
      payload: {
        ...BASE_EPCIS,
        tipoEvento: "ObjectEvent",
        subtipo: "PHARMACY_DISPENSE",
      },
    });
    expect(result.success).toBe(true);
  });

  it("acepta farmacovigilancia.alergia_detectada", () => {
    const result = domainEventPayloadSchema.safeParse({
      eventType: "farmacovigilancia.alergia_detectada",
      payload: {
        ...BASE_INC,
        tipo: "ALERGIA_DETECTADA",
        allergyId: ALLERGY_ID,
        prescriberId: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it("acepta farmacovigilancia.recall_detectado", () => {
    const result = domainEventPayloadSchema.safeParse({
      eventType: "farmacovigilancia.recall_detectado",
      payload: {
        ...BASE_INC,
        tipo: "RECALL_DETECTADO",
        lote: "L2024A",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rechaza eventType desconocido", () => {
    const result = domainEventPayloadSchema.safeParse({
      eventType: "farmacovigilancia.desconocido",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rechaza gs1.epcis.bedside con payload incorrecto", () => {
    const result = domainEventPayloadSchema.safeParse({
      eventType: "gs1.epcis.bedside",
      payload: { wrong: "shape" },
    });
    expect(result.success).toBe(false);
  });
});
