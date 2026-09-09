/**
 * IDs deterministas sembrados por packages/database/scripts/seed-e2e-fixtures.mjs
 * en la BD efímera de CI (paso "Seed fixtures clínicos E2E" de e2e.yml /
 * e2e-smoke.yml). Si cambiás un id allá, actualizá este archivo en el mismo
 * commit — son la misma constante en dos runtimes distintos (.mjs vs .ts).
 */
export const E2E_FIXTURES = {
  /** Paciente María Pérez (public."Patient" y ece.paciente comparten id). */
  patientId: "e2ef1000-0000-4000-8000-000000000001",
  /** Encounter abierto (dischargedAt NULL) — visible en /transfers. */
  encounterId: "e2ef1000-0000-4000-8000-000000000002",
  /** Cama E2E-01 en estado FREE (HOSP). */
  bedFreeId: "e2ef1000-0000-4000-8000-0000000000b1",
  /** Cama E2E-02 OCCUPIED — con BedAssignment y ece.asignacion_cama activas. */
  bedOccupiedId: "e2ef1000-0000-4000-8000-0000000000b2",
  /** Episodio hospitalario ECE del paciente ocupando E2E-02. */
  episodioHospitalarioId: "e2ef1000-0000-4000-8000-00000000e904",
  /** encounterNumber sigue el patrón ENC-{AAAA}-000101 (año UTC del seed). */
  encounterNumberPattern: /ENC-\d{4}-\d{6}/,
  /**
   * Indicación médica firmada (ece.indicaciones_medicas) con un item
   * MEDICAMENTO (Amoxicilina 500mg IV cada 8h) — alimenta /bedside y el
   * wizard /bedside/[patientId]/[indicationId] (bedside-hard-stops.spec.ts).
   */
  indicationId: "e2ef1000-0000-4000-8000-00000000e907",
} as const;

/**
 * Valores GS1 sembrados por packages/database/scripts/seed-e2e-fixtures.mjs
 * (§4 "GS1 escaneable") — mismos literales, no recalculados. Usados por
 * bedside-hard-stops.spec.ts para simular escaneos de pulsera/badge/DataMatrix.
 */
export const E2E_GS1 = {
  /** GSRN-18 de la pulsera de María Pérez (E2E_FIXTURES.patientId). */
  gsrnPaciente: "801874130000000011",
  /** GSRN-18 del badge de la enfermera QA (activo). */
  gsrnEnfermera: "801874130000010010",
  /** GSRN-18 de un badge de enfermera revocado (activo=false). */
  gsrnEnfermeraRevocada: "801874130000010089",
  /** GTIN-14 de Amoxicilina 500mg — coincide con el item de la indicación. */
  gtinAmoxicilina500: "07501000001231",
  /** GTIN-14 de Ibuprofeno 400mg — NO coincide con la indicación (hard-stop). */
  gtinIbuprofeno400: "07501000009992",
  /**
   * GSRN-18 (formato válido, 18 dígitos) que nunca fue sembrado en
   * ece.gs1_gsrn — bedside.router.ts no valida checksum GS1, solo
   * existencia/activo en el catálogo, así que basta con que no exista fila.
   */
  gsrnPacienteNoRegistrado: "801874130000099993",
} as const;
