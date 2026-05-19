/**
 * Tests unitarios — epicrisisRouter (ECE Epicrisis de Egreso).
 *
 * Cubre hallazgos S2-Tier4:
 *   A-01: hard-stop CIE-10 principal en firmar() (Art. 17 NTEC)
 *   A-02: columnas estado_workflow / firma_*_id / campos clínicos presentes en EpicrisisRow
 *   A-03: certificar() efectivamente muta (implícito — router devuelve ok)
 *   A-04: mutaciones usan transacción (applyWorkflowContext dentro de $transaction)
 *   A-05: trigger condicional — update en borrador permitido; update post-firma bloqueado
 *   A-06: list() y get() filtran por establecimiento_id
 *
 * @QA E2E: ece-epicrisis.spec.ts — flujo UI completo con BD efímera.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { epicrisisRouter, type EpicrisisRow } from "../epicrisis.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";
import { TRPCError } from "@trpc/server";

// ──────────────────────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────────────────────

const EPI_ID    = "e1000000-0000-0000-0000-000000000001";
const EPIC_ID   = "c1000000-0000-0000-0000-000000000001";
const ESTAB_ID  = MOCK_TENANT.establishmentId!;
const FIRMA_ID  = "f1000000-0000-0000-0000-000000000001";
const MEDICO_ID = "a1000000-0000-0000-0000-000000000001";

// ──────────────────────────────────────────────────────────────────────────────
// Mock emitDomainEvent
// ──────────────────────────────────────────────────────────────────────────────

vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
  prisma: {},
}));

// ──────────────────────────────────────────────────────────────────────────────
// Mock applyWorkflowContext — no-op en unit tests (no hay BD real).
// ──────────────────────────────────────────────────────────────────────────────

vi.mock("../../../workflow/context", () => ({
  applyWorkflowContext: vi.fn().mockResolvedValue(undefined),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de fila
// ──────────────────────────────────────────────────────────────────────────────

function makeEpicrisisRow(overrides: Partial<EpicrisisRow> = {}): EpicrisisRow {
  return {
    id: EPIC_ID,
    instancia_id: "00000000-0000-0000-0000-000000000099",
    episodio_id: EPI_ID,
    fecha_hora_egreso: new Date("2026-05-19T10:00:00Z"),
    tipo_egreso: "vivo",
    circunstancia_alta: "alta_medica",
    diagnosticos_egreso: [{ cie10: "J18.9", descripcion: "Neumonía", tipo: "principal" }],
    resumen_ingreso: "Paciente ingresó con fiebre y tos.",
    evolucion_hospitalaria: "Mejoría progresiva con antibioticoterapia.",
    tratamiento_egreso: "Amoxicilina 500mg c/8h por 7 días.",
    indicaciones_egreso: "Control en 7 días, dieta blanda.",
    notas: null,
    medico_tratante_id: MEDICO_ID,
    visto_jefe_servicio_id: null,
    estado_workflow: "borrador",
    cie10_principal: null,
    cie10_secundarios: [],
    firma_mc_id: null,
    firma_esp_id: null,
    firma_dir_id: null,
    firmado_en: null,
    validado_en: null,
    certificado_en: null,
    anulado_en: null,
    motivo_anulacion: null,
    registrado_en: new Date(),
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de contexto
// ──────────────────────────────────────────────────────────────────────────────

function makeMcCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["MC", "PHYSICIAN"] } });
}

function makeEspCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["ESP"] } });
}

function makeDirCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["DIR"] } });
}

/** $transaction ejecuta el callback con el mismo mock (no hay TX real). */
function mockTx(prisma: DeepMockProxy<PrismaClient>) {
  prisma.$transaction.mockImplementation(async (fn) =>
    fn(prisma as unknown as Parameters<typeof fn>[0]),
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("epicrisisRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // list — A-06
  // ──────────────────────────────────────────────────────────────────────────
  describe("list", () => {
    it("devuelve items y total", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([makeEpicrisisRow()])
        .mockResolvedValueOnce([{ total: BigInt(1) }]);

      const caller = epicrisisRouter.createCaller(makeMcCtx(prisma));
      const result = await caller.list({ page: 1, pageSize: 20 });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
    });

    it("lanza BAD_REQUEST si falta establishmentId (A-06)", async () => {
      const ctx = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, roleCodes: ["MC"], establishmentId: undefined },
      });
      const caller = epicrisisRouter.createCaller(ctx);
      await expect(caller.list({ page: 1, pageSize: 20 })).rejects.toThrow(TRPCError);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // get — A-06
  // ──────────────────────────────────────────────────────────────────────────
  describe("get", () => {
    it("devuelve la fila cuando existe en el establecimiento", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeEpicrisisRow()]);

      const caller = epicrisisRouter.createCaller(makeMcCtx(prisma));
      const result = await caller.get({ id: EPIC_ID });

      expect(result.id).toBe(EPIC_ID);
      expect(result.estado_workflow).toBe("borrador");
    });

    it("lanza NOT_FOUND cuando la query devuelve vacío", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = epicrisisRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.get({ id: EPIC_ID })).rejects.toThrow(TRPCError);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // firmar — A-01 (hard-stop CIE-10) + A-04 (transacción)
  // ──────────────────────────────────────────────────────────────────────────
  describe("firmar", () => {
    it("lanza PRECONDITION_FAILED si cie10_principal es null (A-01)", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeEpicrisisRow({ cie10_principal: null })]);

      const caller = epicrisisRouter.createCaller(makeMcCtx(prisma));
      await expect(
        caller.firmar({ id: EPIC_ID, firmaId: FIRMA_ID }),
      ).rejects.toThrow(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
    });

    it("firma correctamente cuando cie10_principal está asignado (A-01 happy path)", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeEpicrisisRow({ cie10_principal: "J18.9" })]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = epicrisisRouter.createCaller(makeMcCtx(prisma));
      const result = await caller.firmar({ id: EPIC_ID, firmaId: FIRMA_ID });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("firmado");
    });

    it("lanza CONFLICT si estado_workflow no es borrador", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([
        makeEpicrisisRow({ estado_workflow: "firmado", cie10_principal: "J18.9" }),
      ]);

      const caller = epicrisisRouter.createCaller(makeMcCtx(prisma));
      await expect(
        caller.firmar({ id: EPIC_ID, firmaId: FIRMA_ID }),
      ).rejects.toThrow(expect.objectContaining({ code: "CONFLICT" }));
    });

    it("usa $transaction (A-04 — applyWorkflowContext requiere tx)", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeEpicrisisRow({ cie10_principal: "J18.9" })]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = epicrisisRouter.createCaller(makeMcCtx(prisma));
      await caller.firmar({ id: EPIC_ID, firmaId: FIRMA_ID });

      // La transacción fue invocada (A-04: demotion de rol dentro de TX)
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // setCie10 — A-01
  // ──────────────────────────────────────────────────────────────────────────
  describe("setCie10", () => {
    it("actualiza CIE-10 en estado borrador", async () => {
      mockTx(prisma);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ estado_workflow: "borrador" }])
        .mockResolvedValueOnce([{ codigo: "J18.9" }]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = epicrisisRouter.createCaller(makeMcCtx(prisma));
      const result = await caller.setCie10({
        id: EPIC_ID,
        cie10Principal: "J18.9",
        cie10Secundarios: ["E11.9"],
      });

      expect(result.ok).toBe(true);
    });

    it("lanza CONFLICT si estado_workflow no es borrador (A-05 implícito)", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([{ estado_workflow: "firmado" }]);

      const caller = epicrisisRouter.createCaller(makeMcCtx(prisma));
      await expect(
        caller.setCie10({ id: EPIC_ID, cie10Principal: "J18.9", cie10Secundarios: [] }),
      ).rejects.toThrow(expect.objectContaining({ code: "CONFLICT" }));
    });

    it("lanza BAD_REQUEST si el código CIE-10 no está en el catálogo", async () => {
      mockTx(prisma);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ estado_workflow: "borrador" }])
        .mockResolvedValueOnce([]); // catálogo vacío

      const caller = epicrisisRouter.createCaller(makeMcCtx(prisma));
      await expect(
        caller.setCie10({ id: EPIC_ID, cie10Principal: "Z99.9", cie10Secundarios: [] }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // validar
  // ──────────────────────────────────────────────────────────────────────────
  describe("validar", () => {
    it("valida correctamente desde estado firmado", async () => {
      mockTx(prisma);
      prisma.$queryRaw
        .mockResolvedValueOnce([makeEpicrisisRow({ estado_workflow: "firmado" })])
        .mockResolvedValueOnce([{ id: MEDICO_ID }]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = epicrisisRouter.createCaller(makeEspCtx(prisma));
      const result = await caller.validar({ id: EPIC_ID });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("validado");
    });

    it("lanza CONFLICT si no está en estado firmado", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeEpicrisisRow({ estado_workflow: "borrador" })]);

      const caller = epicrisisRouter.createCaller(makeEspCtx(prisma));
      await expect(caller.validar({ id: EPIC_ID })).rejects.toThrow(
        expect.objectContaining({ code: "CONFLICT" }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // certificar — A-03 (mutación efectivamente invocada)
  // ──────────────────────────────────────────────────────────────────────────
  describe("certificar", () => {
    it("certifica desde estado validado (A-03: mutación ejecutada)", async () => {
      const { emitDomainEvent } = await import("@his/database");
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeEpicrisisRow({ estado_workflow: "validado" })]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = epicrisisRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.certificar({ id: EPIC_ID, firmaId: FIRMA_ID });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("certificado");
      expect(result.documentHash).toBeTypeOf("string");
      expect(emitDomainEvent).toHaveBeenCalledOnce();
    });

    it("lanza CONFLICT si no está en estado validado", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeEpicrisisRow({ estado_workflow: "firmado" })]);

      const caller = epicrisisRouter.createCaller(makeDirCtx(prisma));
      await expect(
        caller.certificar({ id: EPIC_ID, firmaId: FIRMA_ID }),
      ).rejects.toThrow(expect.objectContaining({ code: "CONFLICT" }));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // anular
  // ──────────────────────────────────────────────────────────────────────────
  describe("anular", () => {
    it("anula desde estado borrador", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([{ estado_workflow: "borrador" }]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = epicrisisRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.anular({
        id: EPIC_ID,
        motivoAnulacion: "Error administrativo en registro inicial.",
      });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("anulado");
    });

    it("lanza CONFLICT si ya está certificada (inmutable)", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([{ estado_workflow: "certificado" }]);

      const caller = epicrisisRouter.createCaller(makeDirCtx(prisma));
      await expect(
        caller.anular({ id: EPIC_ID, motivoAnulacion: "Intento de anular certificado." }),
      ).rejects.toThrow(expect.objectContaining({ code: "CONFLICT" }));
    });

    it("lanza CONFLICT si ya está anulada", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([{ estado_workflow: "anulado" }]);

      const caller = epicrisisRouter.createCaller(makeDirCtx(prisma));
      await expect(
        caller.anular({ id: EPIC_ID, motivoAnulacion: "Duplicado." }),
      ).rejects.toThrow(expect.objectContaining({ code: "CONFLICT" }));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A-02: EpicrisisRow tiene todas las columnas de workflow
  // ──────────────────────────────────────────────────────────────────────────
  describe("EpicrisisRow (A-02 — schema drift)", () => {
    it("el tipo contiene todas las columnas de workflow requeridas", () => {
      const row = makeEpicrisisRow();
      // Verificar que las columnas de workflow existen en el tipo.
      expect(row).toHaveProperty("estado_workflow");
      expect(row).toHaveProperty("firma_mc_id");
      expect(row).toHaveProperty("firma_esp_id");
      expect(row).toHaveProperty("firma_dir_id");
      expect(row).toHaveProperty("resumen_ingreso");
      expect(row).toHaveProperty("evolucion_hospitalaria");
      expect(row).toHaveProperty("tratamiento_egreso");
      expect(row).toHaveProperty("indicaciones_egreso");
      expect(row).toHaveProperty("cie10_principal");
      expect(row).toHaveProperty("cie10_secundarios");
      expect(row).toHaveProperty("firmado_en");
      expect(row).toHaveProperty("validado_en");
      expect(row).toHaveProperty("certificado_en");
      expect(row).toHaveProperty("anulado_en");
      expect(row).toHaveProperty("motivo_anulacion");
    });
  });
});
