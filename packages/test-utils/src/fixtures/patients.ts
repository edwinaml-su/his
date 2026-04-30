/**
 * Pacientes de prueba — usados por router tests, E2E y seeds locales.
 * NO contiene PII real. Los DUIs/NITs son generados con verificador válido
 * por `dui-fixtures.ts`.
 */
import { VALID_DUIS, VALID_NITS } from "./dui-fixtures";

export interface TestPatientFixture {
  mrn: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  secondLastName?: string | null;
  birthDate: string; // ISO yyyy-mm-dd
  identifierKind: "DUI" | "NIT";
  identifierValue: string;
  hasAlertAllergy?: boolean;
}

export const TEST_PATIENTS: ReadonlyArray<TestPatientFixture> = [
  {
    mrn: "MRN-0001",
    firstName: "María",
    lastName: "Pérez",
    secondLastName: "García",
    birthDate: "1985-03-12",
    identifierKind: "DUI",
    identifierValue: VALID_DUIS[9]!,        // 12345678-X
    hasAlertAllergy: true,                   // Penicilina (severa)
  },
  {
    mrn: "MRN-0002",
    firstName: "José",
    middleName: "Antonio",
    lastName: "López",
    secondLastName: "Martínez",
    birthDate: "1990-07-22",
    identifierKind: "DUI",
    identifierValue: VALID_DUIS[10]!,
  },
  {
    mrn: "MRN-0003",
    firstName: "Ana",
    lastName: "Hernández",
    birthDate: "2002-01-05",
    identifierKind: "DUI",
    identifierValue: VALID_DUIS[11]!,
  },
  {
    mrn: "MRN-0004",
    firstName: "Servicios Médicos",
    lastName: "Avante S.A. de C.V.",
    birthDate: "2010-01-01",
    identifierKind: "NIT",
    identifierValue: VALID_NITS[2]!,
  },
];

/** Búsquedas esperadas — alimentan los E2E del MPI. */
export const PATIENT_SEARCH_CASES = [
  { query: "María", expectedMrn: "MRN-0001" },
  { query: "Pérez", expectedMrn: "MRN-0001" },
  { query: VALID_DUIS[9]!.slice(0, 8), expectedMrn: "MRN-0001" }, // por DUI parcial
];
