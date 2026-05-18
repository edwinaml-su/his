/**
 * epcis-builder.ts — Constructor centralizado de eventos EPCIS GS1 1.2 / 2.0
 *
 * Genera eventos EPCIS con las 5 dimensiones completas (WHAT/WHERE/WHEN/WHY/WHO)
 * para los procesos D (dispensación) y E (bedside) de la guía GS1 Healthcare.
 *
 * El hash SHA-256 del payload garantiza inmutabilidad una vez persistido.
 * Cada función retorna el shape listo para INSERT en ece.gs1_epcis_event.
 *
 * US.F2.6.53-58 — Sección 6 Épica E.F2.6
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type BedsideEventType =
  | "BEDSIDE_ADMIN"
  | "PHARMACY_DISPENSE"
  | "RESERVATION"
  | "SUBSTITUTION"
  | "RETURN";

export interface EpcisEventInput {
  type: BedsideEventType;
  gtin: string;
  lote?: string;
  serial?: string;
  vencimiento?: string;
  gsrnPaciente?: string;
  gsrnProfesional?: string;
  glnReadPoint: string;
  glnBizLocation?: string;
  indicationId?: string;
  timestamp: Date;
  organizationId: string;
  establecimientoId: string;
}

export interface EpcisDispensationInput extends EpcisEventInput {
  type: "PHARMACY_DISPENSE";
  glnOrigen: string;
  glnDestino?: string;
  prescriptionItemId?: string;
}

export interface EpcisSubstitutionInput extends EpcisEventInput {
  type: "SUBSTITUTION";
  gtinOriginal: string;
}

// ---------------------------------------------------------------------------
// Shape de salida (listo para INSERT en ece.epcis_event)
// ---------------------------------------------------------------------------

export interface EpcisEventRow {
  tipo_evento: string;
  subtipo: BedsideEventType;
  what: object;
  where_data: object;
  event_time: Date;
  why: object;
  who: object;
  payload_hash: string;
  indication_id: string | null;
  establecimiento_id: string;
}

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

function computeHash(payload: object): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function buildSgtin(gtin: string, serial?: string): string {
  return serial ? `urn:epc:id:sgtin:${gtin}.${serial}` : `urn:epc:id:gtin:${gtin}`;
}

function glnUrn(gln: string): string {
  return `urn:epc:id:sgln:${gln}`;
}

// ---------------------------------------------------------------------------
// buildBedsideEvent — BEDSIDE_ADMIN (Process E)
// ---------------------------------------------------------------------------

export function buildBedsideEvent(input: EpcisEventInput): EpcisEventRow {
  const what = {
    epcList: [buildSgtin(input.gtin, input.serial)],
    gtin: input.gtin,
    lote: input.lote ?? null,
    serial: input.serial ?? null,
    vencimiento: input.vencimiento ?? null,
  };

  const whereData = {
    readPoint: glnUrn(input.glnReadPoint),
    bizLocation: input.glnBizLocation ? glnUrn(input.glnBizLocation) : null,
  };

  const why = {
    businessStep: "administering",
    disposition: "consumed",
    bizTransactionList: input.indicationId
      ? [{ type: "po", id: input.indicationId }]
      : [],
  };

  const who = {
    sourceList: [
      ...(input.gsrnProfesional
        ? [{ type: "urn:epcglobal:cbv:sdt:owning_party", gsrn: input.gsrnProfesional }]
        : []),
      ...(input.gsrnPaciente
        ? [{ type: "urn:epcglobal:cbv:sdt:possessing_party", gsrn: input.gsrnPaciente }]
        : []),
    ],
  };

  const fullPayload = { what, whereData, why, who };

  return {
    tipo_evento: "ObjectEvent",
    subtipo: "BEDSIDE_ADMIN",
    what,
    where_data: whereData,
    event_time: input.timestamp,
    why,
    who,
    payload_hash: computeHash(fullPayload),
    indication_id: input.indicationId ?? null,
    establecimiento_id: input.establecimientoId,
  };
}

// ---------------------------------------------------------------------------
// buildDispensationEvent — PHARMACY_DISPENSE (Process D)
// ---------------------------------------------------------------------------

export function buildDispensationEvent(input: EpcisDispensationInput): EpcisEventRow {
  const what = {
    epcList: [buildSgtin(input.gtin, input.serial)],
    gtin: input.gtin,
    lote: input.lote ?? null,
    serial: input.serial ?? null,
    vencimiento: input.vencimiento ?? null,
  };

  const whereData = {
    readPoint: glnUrn(input.glnOrigen),
    bizLocation: input.glnDestino ? glnUrn(input.glnDestino) : null,
  };

  const why = {
    businessStep: "dispensing",
    disposition: "dispensed",
    bizTransactionList: input.indicationId
      ? [{ type: "po", id: input.indicationId }]
      : [],
  };

  const who = {
    sourceList: input.gsrnProfesional
      ? [{ type: "urn:epcglobal:cbv:sdt:owning_party", gsrn: input.gsrnProfesional }]
      : [],
    destinationList: input.gsrnPaciente
      ? [{ type: "urn:epcglobal:cbv:sdt:possessing_party", gsrn: input.gsrnPaciente }]
      : [],
  };

  const fullPayload = { what, whereData, why, who };

  return {
    tipo_evento: "ObjectEvent",
    subtipo: "PHARMACY_DISPENSE",
    what,
    where_data: whereData,
    event_time: input.timestamp,
    why,
    who,
    payload_hash: computeHash(fullPayload),
    indication_id: input.indicationId ?? null,
    establecimiento_id: input.establecimientoId,
  };
}

// ---------------------------------------------------------------------------
// buildSubstitutionEvent — SUBSTITUTION (TransactionEvent)
// ---------------------------------------------------------------------------

export function buildSubstitutionEvent(input: EpcisSubstitutionInput): EpcisEventRow {
  const what = {
    epcList: [buildSgtin(input.gtin, input.serial)],
    gtin: input.gtin,
    gtinOriginal: input.gtinOriginal,
    lote: input.lote ?? null,
    serial: input.serial ?? null,
    vencimiento: input.vencimiento ?? null,
  };

  const whereData = {
    readPoint: glnUrn(input.glnReadPoint),
    bizLocation: input.glnBizLocation ? glnUrn(input.glnBizLocation) : null,
  };

  const why = {
    businessStep: "accepting",
    disposition: "dispensed",
    bizTransactionList: input.indicationId
      ? [{ type: "po", id: input.indicationId }]
      : [],
  };

  const who = {
    sourceList: input.gsrnProfesional
      ? [{ type: "urn:epcglobal:cbv:sdt:owning_party", gsrn: input.gsrnProfesional }]
      : [],
  };

  const fullPayload = { what, whereData, why, who };

  return {
    tipo_evento: "TransactionEvent",
    subtipo: "SUBSTITUTION",
    what,
    where_data: whereData,
    event_time: input.timestamp,
    why,
    who,
    payload_hash: computeHash(fullPayload),
    indication_id: input.indicationId ?? null,
    establecimiento_id: input.establecimientoId,
  };
}
