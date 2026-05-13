/**
 * Tests del ehrNotesRouter (§14 — Beta.5 hardening layer 1).
 *
 * Cubre:
 *  - Rule 1: inmutabilidad — solo el autor firma; update bloqueado en nota firmada.
 *  - Rule 2: addendum chain — nota original debe estar firmada.
 *  - Rule 3: CIE-10 binding en diagnosis.create.
 *  - Rule 4: editHistory append-only en note.create y note.update.
 *  - Rule 5: DISCHARGE_SUMMARY requiere encounter con dischargedAt.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { ehrNotesRouter } from "../ehr-notes.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN } from "@his/test-utils";

const u = "00000000-0000-0000-0000-000000000001";

describe("ehrNotesRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("note.list", () => {
    it("filtra por encounterId, noteType y rango de fechas", async () => {
      prisma.clinicalNote.findMany.mockResolvedValue([] as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await caller.note.list({ encounterId: u, noteType: "PROGRESS", fromDate: new Date("2026-01-01"), toDate: new Date("2026-12-31"), limit: 25 });
      const args = prisma.clinicalNote.findMany.mock.calls[0]![0];
      expect(args!.where!.encounterId).toBe(u);
      expect(args!.take).toBe(25);
    });
  });

  describe("note.get", () => {
    it("NOT_FOUND si la nota no es del tenant", async () => {
      prisma.clinicalNote.findFirst.mockResolvedValue(null as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.note.get({ id: u })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("note.create", () => {
    it("NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.note.create({ encounterId: u, noteType: "PROGRESS" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea nota con authorId del usuario actual y editHistory inicial", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, dischargedAt: null } as never);
      prisma.clinicalNote.create.mockResolvedValue({ id: u } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await caller.note.create({ encounterId: u, noteType: "PROGRESS", subjective: "Paciente estable" });
      const args = prisma.clinicalNote.create.mock.calls[0]![0];
      expect(args.data.authorId).toBeTruthy();
      expect(args.data.noteType).toBe("PROGRESS");
      const history = args.data.editHistory as Array<{ action: string; by: string }>;
      expect(Array.isArray(history)).toBe(true);
      expect(history[0]!.action).toBe("create");
      expect(history[0]!.by).toBe(MOCK_USER_ADMIN.id);
    });

    it("BAD_REQUEST si DISCHARGE_SUMMARY y encounter sin dischargedAt", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, dischargedAt: null } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.note.create({ encounterId: u, noteType: "DISCHARGE_SUMMARY" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("permite DISCHARGE_SUMMARY si encounter tiene dischargedAt", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, dischargedAt: new Date() } as never);
      prisma.clinicalNote.create.mockResolvedValue({ id: u } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.note.create({ encounterId: u, noteType: "DISCHARGE_SUMMARY" })).resolves.toBeDefined();
    });
  });

  describe("note.sign", () => {
    it("NOT_FOUND si nota ya firmada o no existe", async () => {
      prisma.clinicalNote.findFirst.mockResolvedValue(null as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.note.sign({ id: u })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("FORBIDDEN si firmante distinto del autor", async () => {
      prisma.clinicalNote.findFirst.mockResolvedValue({ id: u, authorId: "00000000-0000-0000-0000-000000000099" } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.note.sign({ id: u })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("firma la nota cuando el autor es el firmante", async () => {
      prisma.clinicalNote.findFirst.mockResolvedValue({ id: u, authorId: MOCK_USER_ADMIN.id } as never);
      prisma.clinicalNote.update.mockResolvedValue({ id: u } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await caller.note.sign({ id: u });
      const args = prisma.clinicalNote.update.mock.calls[0]![0];
      expect(args.data.signedAt).toBeInstanceOf(Date);
    });
  });

  describe("note.addendum", () => {
    it("NOT_FOUND si nota original no esta firmada", async () => {
      prisma.clinicalNote.findFirst.mockResolvedValue(null as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.note.addendum({ addendumOfId: u, noteType: "PROGRESS" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea nota nueva con addendumOfId y editHistory inicial", async () => {
      prisma.clinicalNote.findFirst.mockResolvedValue({ id: u, encounterId: u } as never);
      prisma.clinicalNote.create.mockResolvedValue({ id: u } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await caller.note.addendum({ addendumOfId: u, noteType: "PROGRESS", plan: "Continuar tratamiento" });
      const args = prisma.clinicalNote.create.mock.calls[0]![0];
      expect(args.data.addendumOfId).toBe(u);
      expect(args.data.encounterId).toBe(u);
      const history = args.data.editHistory as Array<{ action: string }>;
      expect(history[0]!.action).toBe("create");
    });
  });

  describe("note.update", () => {
    it("NOT_FOUND si nota esta firmada o no existe", async () => {
      prisma.clinicalNote.findFirst.mockResolvedValue(null as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.note.update({ id: u, subjective: "nuevo texto" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("FORBIDDEN si el usuario no es el autor", async () => {
      prisma.clinicalNote.findFirst.mockResolvedValue({
        id: u, authorId: "00000000-0000-0000-0000-000000000099",
        editHistory: [], subjective: "viejo", objective: null, assessment: null, plan: null,
      } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.note.update({ id: u, subjective: "nuevo" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("guarda diff en editHistory al actualizar campo", async () => {
      prisma.clinicalNote.findFirst.mockResolvedValue({
        id: u, authorId: MOCK_USER_ADMIN.id,
        editHistory: [{ at: "2026-01-01T00:00:00.000Z", by: u, action: "create" }],
        subjective: "texto original", objective: null, assessment: null, plan: null,
      } as never);
      prisma.clinicalNote.update.mockResolvedValue({ id: u } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await caller.note.update({ id: u, subjective: "texto actualizado" });
      const args = prisma.clinicalNote.update.mock.calls[0]![0];
      const history = args.data.editHistory as Array<{ action: string; diff: Record<string, unknown> }>;
      expect(history).toHaveLength(2);
      expect(history[1]!.action).toBe("update");
      expect(history[1]!.diff!["subjective"]).toBe("texto original");
    });

    it("no registra diff si el valor no cambia", async () => {
      prisma.clinicalNote.findFirst.mockResolvedValue({
        id: u, authorId: MOCK_USER_ADMIN.id,
        editHistory: [{ at: "2026-01-01T00:00:00.000Z", by: u, action: "create" }],
        subjective: "mismo texto", objective: null, assessment: null, plan: null,
      } as never);
      prisma.clinicalNote.update.mockResolvedValue({ id: u } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await caller.note.update({ id: u, subjective: "mismo texto" });
      const args = prisma.clinicalNote.update.mock.calls[0]![0];
      const history = args.data.editHistory as Array<{ action: string; diff?: Record<string, unknown> }>;
      expect(history).toHaveLength(2);
      expect(Object.keys(history[1]!.diff ?? {})).toHaveLength(0);
    });

    it("limita editHistory a 50 entries descartando el mas antiguo", async () => {
      const fifty = Array.from({ length: 50 }, (_, i) => ({ at: new Date(i * 1000).toISOString(), by: u, action: "update" }));
      prisma.clinicalNote.findFirst.mockResolvedValue({
        id: u, authorId: MOCK_USER_ADMIN.id,
        editHistory: fifty, subjective: "anterior", objective: null, assessment: null, plan: null,
      } as never);
      prisma.clinicalNote.update.mockResolvedValue({ id: u } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await caller.note.update({ id: u, subjective: "nuevo" });
      const args = prisma.clinicalNote.update.mock.calls[0]![0];
      const history = args.data.editHistory as unknown[];
      expect(history).toHaveLength(50);
    });
  });

  describe("diagnosis.list", () => {
    it("NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.diagnosis.list({ encounterId: u })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("filtra por type opcional", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.encounterDiagnosis.findMany.mockResolvedValue([] as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await caller.diagnosis.list({ encounterId: u, type: "PRINCIPAL" });
      const args = prisma.encounterDiagnosis.findMany.mock.calls[0]![0];
      expect(args!.where!.type).toBe("PRINCIPAL");
    });
  });

  describe("diagnosis.create", () => {
    it("NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.diagnosis.create({ encounterId: u, conceptId: u, type: "PRINCIPAL" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si conceptId no es ICD10", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.clinicalConcept.findFirst.mockResolvedValue(null as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.diagnosis.create({ encounterId: u, conceptId: u, type: "PRINCIPAL" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("consulta ClinicalConcept filtrando por codeSystem ICD10", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.clinicalConcept.findFirst.mockResolvedValue({ id: u } as never);
      prisma.encounterDiagnosis.create.mockResolvedValue({ id: u } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await caller.diagnosis.create({ encounterId: u, conceptId: u, type: "SECONDARY" });
      const args = prisma.clinicalConcept.findFirst.mock.calls[0]![0];
      expect((args!.where as { codeSystem?: { code?: string } }).codeSystem?.code).toBe("ICD10");
    });

    it("crea diagnostico con diagnosedById del usuario", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.clinicalConcept.findFirst.mockResolvedValue({ id: u } as never);
      prisma.encounterDiagnosis.create.mockResolvedValue({ id: u } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await caller.diagnosis.create({ encounterId: u, conceptId: u, type: "SECONDARY" });
      const args = prisma.encounterDiagnosis.create.mock.calls[0]![0];
      expect(args.data.diagnosedById).toBeTruthy();
    });
  });

  describe("diagnosis.resolve", () => {
    it("NOT_FOUND si diagnosis ya resuelto o no existe", async () => {
      prisma.encounterDiagnosis.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.diagnosis.resolve({ id: u })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("resuelve diagnosis exitosamente", async () => {
      prisma.encounterDiagnosis.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = ehrNotesRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.diagnosis.resolve({ id: u });
      expect(r.ok).toBe(true);
    });
  });
});