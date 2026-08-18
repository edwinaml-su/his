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

/** Procesos logísticos GS1 Nivel 3 (recepción, cuarentena, almacenamiento, fraccionamiento). */
export type LogisticsSubtipo = "RECEPTION" | "QUARANTINE" | "STORAGE" | "FRACTIONATION";

/** Unión de todos los subtipos EPCIS válidos (espeja el CHECK de SQL 173). */
export type EpcisSubtipo = BedsideEventType | LogisticsSubtipo;

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
  subtipo: EpcisSubtipo;
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

// ---------------------------------------------------------------------------
// buildPatientMovementEvent — PATIENT_ADMISSION / PATIENT_TRANSFER_* / PATIENT_DISCHARGE
// (ADR 0019 — trazabilidad EPCIS del movimiento físico del paciente)
//
// Stream separado de EpcisEventRow/EpcisSubtipo (que describen filas para
// ece.gs1_epcis_event, farmacia): estos eventos van a ece.gs1_epcis_patient_event
// (ADR 0019 D5, SQL 199) — tabla nueva, sin trigger de inmutabilidad, con su propio
// CHECK de subtipo. Mezclar los tipos sería type-level una mentira — ver ADR 0019 D6.
// ---------------------------------------------------------------------------

export type PatientMovementSubtipo =
  | "PATIENT_ADMISSION"
  | "PATIENT_TRANSFER_DEPARTURE"
  | "PATIENT_TRANSFER_ARRIVAL"
  | "PATIENT_DISCHARGE";

/** Shape de salida — listo para INSERT en ece.gs1_epcis_patient_event (NO ece.gs1_epcis_event). */
export interface EpcisPatientEventRow {
  tipo_evento: "ObjectEvent";
  subtipo: PatientMovementSubtipo;
  what: object;
  where_data: object;
  event_time: Date;
  why: object;
  who: object;
  payload_hash: string;
  establecimiento_id: string;
  status: "COMMITTED";
}

export interface EpcisPatientMovementInput {
  type: PatientMovementSubtipo;
  /** GSRN-18 completo (con check digit) del paciente. */
  gsrnPaciente: string;
  /** Longitud del CompanyPrefix de la organización (7-9) — para construir la URN EPC. */
  companyPrefixLength: number;
  /** GLN-13 del punto donde se registra el evento. Null si no resuelto (ver ADR 0019 D8). */
  glnReadPoint: string | null;
  /** GLN-13 de la ubicación lógica de destino tras el evento. Null si no resuelto. */
  glnBizLocation: string | null;
  /** Fallback no-GS1 mientras el catálogo GLN de cama/servicio no está sembrado. */
  internalRef: {
    bedId: string | null;
    serviceUnitId: string | null;
    establishmentId: string; // public.Establishment.id (NO ece.establecimiento.id)
  };
  encounterId: string;
  /** Solo para PATIENT_TRANSFER_DEPARTURE / PATIENT_TRANSFER_ARRIVAL. */
  transferId?: string;
  recordedById: string;
  timestamp: Date;
  /** ece.establecimiento.id (tenant EPCIS) — resolver con resolveEceEstablecimientoId antes de llamar. */
  establecimientoId: string;
}

const PATIENT_MOVEMENT_STEP: Record<
  PatientMovementSubtipo,
  { businessStep: string; disposition: string }
> = {
  PATIENT_ADMISSION:           { businessStep: "arriving",  disposition: "active" },
  PATIENT_TRANSFER_DEPARTURE:  { businessStep: "departing", disposition: "in_transit" },
  PATIENT_TRANSFER_ARRIVAL:    { businessStep: "arriving",  disposition: "active" },
  PATIENT_DISCHARGE:           { businessStep: "departing", disposition: "inactive" },
};

/**
 * Convierte un GSRN-18 (con check digit) a su forma EPC pure-identity URI.
 * El check digit se descarta — no forma parte de la URI EPC (igual que SGTIN
 * descarta el check digit de GTIN). Ref: GS1 EPC Tag Data Standard.
 *
 * @param gsrn18 - 18 dígitos: CompanyPrefix + ServiceReference + CheckDigit
 * @param companyPrefixLength - longitud del CompanyPrefix de la organización (7-9)
 */
export function buildGsrnUrn(gsrn18: string, companyPrefixLength: number): string {
  if (!/^\d{18}$/.test(gsrn18)) {
    throw new Error(`GSRN debe ser 18 dígitos numéricos (recibido: ${gsrn18})`);
  }
  if (companyPrefixLength < 7 || companyPrefixLength > 9) {
    throw new Error(`companyPrefixLength fuera de rango 7-9 (recibido: ${companyPrefixLength})`);
  }
  const body = gsrn18.slice(0, 17); // descarta el check digit (posición 18)
  const companyPrefix = body.slice(0, companyPrefixLength);
  const serviceReference = body.slice(companyPrefixLength);
  return `urn:epc:id:gsrn:${companyPrefix}.${serviceReference}`;
}

export function buildPatientMovementEvent(
  input: EpcisPatientMovementInput,
): EpcisPatientEventRow {
  const gsrnUrn = buildGsrnUrn(input.gsrnPaciente, input.companyPrefixLength);

  const what = {
    epcList: [gsrnUrn],
    gsrn: input.gsrnPaciente,
  };

  const whereData = {
    readPoint: input.glnReadPoint ? glnUrn(input.glnReadPoint) : null,
    bizLocation: input.glnBizLocation ? glnUrn(input.glnBizLocation) : null,
    internalRef: input.internalRef,
  };

  const step = PATIENT_MOVEMENT_STEP[input.type];
  const bizTransactionList: { type: string; id: string }[] = [
    { type: "encounter", id: input.encounterId },
  ];
  if (input.transferId) {
    bizTransactionList.push({ type: "transfer", id: input.transferId });
  }

  const why = {
    businessStep: step.businessStep,
    disposition: step.disposition,
    bizTransactionList,
  };

  const who = {
    sourceList: [
      { type: "urn:epcglobal:cbv:sdt:possessing_party", gsrn: input.gsrnPaciente },
    ],
    recordedById: input.recordedById,
  };

  const fullPayload = { what, whereData, why, who };

  return {
    tipo_evento: "ObjectEvent",
    subtipo: input.type,
    what,
    where_data: whereData,
    event_time: input.timestamp,
    why,
    who,
    payload_hash: computeHash(fullPayload),
    establecimiento_id: input.establecimientoId,
    status: "COMMITTED",
  };
}

// ---------------------------------------------------------------------------
// buildLogisticsEvent — RECEPTION / QUARANTINE / STORAGE / FRACTIONATION
// (Procesos logísticos A/B/C, guía GS1 El Salvador Nivel 3)
// ---------------------------------------------------------------------------

export interface EpcisLogisticsInput {
  type: LogisticsSubtipo;
  gtin: string;
  lote?: string;
  serial?: string;
  vencimiento?: string;
  glnReadPoint: string;
  glnBizLocation?: string;
  gsrnProfesional?: string;
  timestamp: Date;
  establecimientoId: string;
}

/** businessStep/disposition CBV por subtipo logístico. */
const LOGISTICS_STEP: Record<LogisticsSubtipo, { businessStep: string; disposition: string }> = {
  RECEPTION:     { businessStep: "receiving",   disposition: "in_progress" },
  QUARANTINE:    { businessStep: "inspecting",  disposition: "recall" },
  STORAGE:       { businessStep: "storing",     disposition: "in_progress" },
  FRACTIONATION: { businessStep: "repackaging", disposition: "active" },
};

export function buildLogisticsEvent(input: EpcisLogisticsInput): EpcisEventRow {
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

  const step = LOGISTICS_STEP[input.type];
  const why = {
    businessStep: step.businessStep,
    disposition: step.disposition,
    bizTransactionList: [] as { type: string; id: string }[],
  };

  const who = {
    sourceList: input.gsrnProfesional
      ? [{ type: "urn:epcglobal:cbv:sdt:owning_party", gsrn: input.gsrnProfesional }]
      : [],
  };

  const fullPayload = { what, whereData, why, who };

  return {
    // El fraccionamiento transforma un empaque en unidosis → TransformationEvent.
    tipo_evento: input.type === "FRACTIONATION" ? "TransformationEvent" : "ObjectEvent",
    subtipo: input.type,
    what,
    where_data: whereData,
    event_time: input.timestamp,
    why,
    who,
    payload_hash: computeHash(fullPayload),
    indication_id: null,
    establecimiento_id: input.establecimientoId,
  };
}
