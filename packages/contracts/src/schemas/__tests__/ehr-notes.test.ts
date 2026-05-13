/**
 * Tests del schema §14 EHR Clinical Notes (Beta.5 hardening layer 1).
 */
import { describe, it, expect } from "vitest";
import {
  noteTypeEnum,
  diagnosisTypeEnum,
  editHistoryEntrySchema,
  clinicalNoteCreateInput,
  clinicalNoteSignInput,
  clinicalNoteAddendumInput,
  clinicalNoteListInput,
  encounterDiagnosisCreateInput,
  encounterDiagnosisListInput,
  encounterDiagnosisResolveInput,
} from "../ehr-notes";

const u = "00000000-0000-0000-0000-000000000001";

describe("enums EHR notes", () => {
  it.each(["PROGRESS", "ADMISSION", "DISCHARGE_SUMMARY", "CONSULTATION", "NURSING", "EMERGENCY"])(
    "noteType acepta %s",
    (s) => expect(noteTypeEnum.safeParse(s).success).toBe(true),
  );
  it("noteType rechaza SOAP", () => expect(noteTypeEnum.safeParse("SOAP").success).toBe(false));
  it.each(["PRINCIPAL", "SECONDARY", "RULE_OUT", "CHRONIC"])("diagnosisType acepta %s", (s) =>
    expect(diagnosisTypeEnum.safeParse(s).success).toBe(true),
  );
});

describe("editHistoryEntrySchema", () => {
  it("acepta entry create sin diff", () =>
    expect(editHistoryEntrySchema.safeParse({ at: new Date().toISOString(), by: u, action: "create" }).success).toBe(true));

  it("acepta entry update con diff", () =>
    expect(editHistoryEntrySchema.safeParse({ at: new Date().toISOString(), by: u, action: "update", diff: { subjective: "texto anterior" } }).success).toBe(true));

  it("rechaza action desconocida", () =>
    expect(editHistoryEntrySchema.safeParse({ at: new Date().toISOString(), by: u, action: "delete" }).success).toBe(false));

  it("rechaza by no-UUID", () =>
    expect(editHistoryEntrySchema.safeParse({ at: new Date().toISOString(), by: "not-a-uuid", action: "create" }).success).toBe(false));

  it("rechaza at no-datetime", () =>
    expect(editHistoryEntrySchema.safeParse({ at: "2026-05-13", by: u, action: "create" }).success).toBe(false));
});

describe("clinicalNoteCreateInput", () => {
  it("acepta nota PROGRESS con SOAP parcial", () =>
    expect(clinicalNoteCreateInput.safeParse({ encounterId: u, noteType: "PROGRESS", subjective: "Paciente refiere disnea leve." }).success).toBe(true));

  it("acepta nota sin SOAP fields", () =>
    expect(clinicalNoteCreateInput.safeParse({ encounterId: u, noteType: "NURSING" }).success).toBe(true));

  it("acepta DISCHARGE_SUMMARY (validacion encounter en router)", () =>
    expect(clinicalNoteCreateInput.safeParse({ encounterId: u, noteType: "DISCHARGE_SUMMARY" }).success).toBe(true));

  it("rechaza encounterId no-UUID", () =>
    expect(clinicalNoteCreateInput.safeParse({ encounterId: "x", noteType: "PROGRESS" }).success).toBe(false));

  it("rechaza subjective > 8000 chars", () =>
    expect(clinicalNoteCreateInput.safeParse({ encounterId: u, noteType: "PROGRESS", subjective: "x".repeat(8001) }).success).toBe(false));
});

describe("clinicalNoteSignInput", () => {
  it("acepta UUID", () => expect(clinicalNoteSignInput.safeParse({ id: u }).success).toBe(true));
});

describe("clinicalNoteAddendumInput", () => {
  it("aplica default noteType=PROGRESS", () => {
    const r = clinicalNoteAddendumInput.safeParse({ addendumOfId: u, assessment: "Correccion al diagnostico previo." });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.noteType).toBe("PROGRESS");
  });
  it("acepta override de noteType", () =>
    expect(clinicalNoteAddendumInput.safeParse({ addendumOfId: u, noteType: "DISCHARGE_SUMMARY" }).success).toBe(true));
  it("rechaza addendumOfId no-UUID", () =>
    expect(clinicalNoteAddendumInput.safeParse({ addendumOfId: "not-uuid" }).success).toBe(false));
});

describe("clinicalNoteListInput", () => {
  it("default limit=50", () => {
    const r = clinicalNoteListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });
  it("rechaza limit > 100", () => expect(clinicalNoteListInput.safeParse({ limit: 101 }).success).toBe(false));
  it("acepta filtro por noteType", () => expect(clinicalNoteListInput.safeParse({ noteType: "ADMISSION" }).success).toBe(true));
});

describe("encounterDiagnosisCreateInput", () => {
  it("acepta diagnostico PRINCIPAL", () =>
    expect(encounterDiagnosisCreateInput.safeParse({ encounterId: u, conceptId: u, type: "PRINCIPAL" }).success).toBe(true));
  it("rechaza type invalido", () =>
    expect(encounterDiagnosisCreateInput.safeParse({ encounterId: u, conceptId: u, type: "DIFFERENTIAL" }).success).toBe(false));
  it("rechaza notes > 2000 chars", () =>
    expect(encounterDiagnosisCreateInput.safeParse({ encounterId: u, conceptId: u, type: "SECONDARY", notes: "x".repeat(2001) }).success).toBe(false));
});

describe("encounterDiagnosisListInput", () => {
  it("acepta solo encounterId", () => expect(encounterDiagnosisListInput.safeParse({ encounterId: u }).success).toBe(true));
  it("rechaza sin encounterId", () => expect(encounterDiagnosisListInput.safeParse({}).success).toBe(false));
});

describe("encounterDiagnosisResolveInput", () => {
  it("acepta UUID", () => expect(encounterDiagnosisResolveInput.safeParse({ id: u }).success).toBe(true));
  it("rechaza no-UUID", () => expect(encounterDiagnosisResolveInput.safeParse({ id: "x" }).success).toBe(false));
});