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
} as const;
