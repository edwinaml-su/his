/**
 * Encuentros de prueba — alimentan tests de admisión, traslado y alta.
 */
export interface TestEncounterFixture {
  patientMrn: string;
  admissionType: "EMERGENCY" | "SCHEDULED" | "TRANSFER_IN" | "BIRTH" | "NEWBORN";
  serviceUnitCode: string;
  bedCode?: string;
  expectedEncounterPrefix: string;
}

export const TEST_ENCOUNTERS: ReadonlyArray<TestEncounterFixture> = [
  {
    patientMrn: "MRN-0001",
    admissionType: "EMERGENCY",
    serviceUnitCode: "URG-A",
    bedCode: "URG-A-01",
    expectedEncounterPrefix: "ENC-",
  },
  {
    patientMrn: "MRN-0002",
    admissionType: "SCHEDULED",
    serviceUnitCode: "MED-INT",
    bedCode: "MED-INT-12",
    expectedEncounterPrefix: "ENC-",
  },
];

export const TRIAGE_CASES = [
  {
    patientMrn: "MRN-0001",
    flowchartCode: "DOLOR_TORAX",
    discriminator: "DOLOR_PRECORDIAL",
    expectedColor: "RED" as const,
    expectedMaxWaitMinutes: 0,
  },
  {
    patientMrn: "MRN-0002",
    flowchartCode: "ENFERMEDAD_GENERAL",
    discriminator: "DOLOR_LEVE",
    expectedColor: "GREEN" as const,
    expectedMaxWaitMinutes: 120,
  },
];
