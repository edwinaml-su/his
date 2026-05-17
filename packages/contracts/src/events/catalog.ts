import { z } from "zod";

/**
 * Catálogo canónico de `eventType` Beta.15.
 *
 * Patrón: `<domain>.<noun-or-verb>` (kebab-case dentro del segmento).
 * Cada eventType DEBE tener un schema Zod registrado en `payloads.ts`
 * (`domainEventPayloadSchema` — discriminated union sobre `eventType`).
 *
 * Por qué VARCHAR en BD y enum TS en lugar de enum PostgreSQL:
 *   `ALTER TYPE ADD VALUE` no puede co-existir con uso del valor en la
 *   misma transacción (caso `SurgeryCaseStatus.POST_OP` de Beta.6).
 *   Añadir 1 eventType es 1 entrada acá + 1 schema; cero migración SQL.
 *
 * Ver ADR 0008 (§D3).
 */
export const EVENT_TYPES = [
  "vital.critical",
  "lab.criticalValue",
  "drug.interaction",
  "allergy.mismatch",
  // Beta.16 — banco de sangre
  "transfusion.crossmatchFailed",
  "transfusion.adverseReaction",
  // Beta.17 — Patología
  "pathology.reportSigned",
  "pathology.criticalFinding",
  // Beta.18 — Contabilidad multi-libro (TDR §23, ADR 0007)
  "accounting.periodClosed",
  "accounting.journalPostedHighValue",
  // UAT-BUG-02 — Nutrición: override clínico de conflicto alérgico en orden
  "nutrition.allergyOverride",
  // Fase 2 — Motor de Workflow ECE (Stream 15)
  "workflow.transitionExecuted",
  // Fase 2 — ECE Triaje NTEC (Stream 02)
  "ece.triaje.firmado",
  // Fase 2 — Indicaciones Médicas ECE (IND_MED)
  "ece.indicaciones.firmadas",
  // Fase 2 — ECE Registro de Enfermería (Stream 30)
  "ece.administracion.registrada",
  // Fase 2 — ECE Evolución Médica (Stream 11)
  "ece.evolucion.firmada",
  // Fase 2 — ECE Epicrisis de Egreso (NTEC §3.15, Art. 21)
  "ece.epicrisis.certificada",
  // Fase 2 — Certificación DIR (Art. 21 NTEC)
  "ece.documento.certificado",
  // Fase 2 — Bridge ECE↔HIS (Stream bridge-patient)
  "ece.paciente.linked",
  "ece.paciente.synced",
  // Fase 2 — Bridge ECE↔HIS Encounter (Stream 22b)
  "ece.episodio.linkedToEncounter",
  // Fase 2 — Bridge Triage HIS ↔ ECE (Stream 18-ext)
  "ece.triaje.linkedToHisTriage",
  // Fase 2 — ECE Episodio de Atención (apertura / cierre)
  "ece.episodio.abierto",
  "ece.episodio.cerrado",
  // Fase 2 — ECE Atención de Emergencia (NTEC Doc 5, ATN_EMERG)
  "ece.atencion_emergencia.firmada",
  // Fase 2 — ECE RRI (NTEC Doc 10)
  "ece.rri.firmada",
  "ece.rri.respondida",
  // Fase 2 — ECE Solicitud/Resultado Estudio (NTEC Doc 18)
  "ece.solicitud_estudio.firmada",
  "ece.solicitud_estudio.validada",
  "ece.solicitud_estudio.anulada",
  "ece.resultado_estudio.registrado",
  "ece.resultado_estudio.aprobado",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Zod enum que valida que un string es un eventType conocido. */
export const eventTypeSchema = z.enum(EVENT_TYPES);
