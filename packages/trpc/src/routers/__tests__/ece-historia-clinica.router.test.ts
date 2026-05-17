/**
 * Tests unitarios del router eceHistoriaClinica.
 *
 * Estrategia:
 *   - withEceContext se mockea para ejecutar el callback directamente con el prisma mock.
 *   - ctx.prisma.$queryRaw y $executeRaw se reemplazan por vi.fn().
 *   - Tenant siempre incluye los roles necesarios para el procedure bajo test.
 *
 * Cobertura:
 *   list (happy + paginación), get (happy + NOT_FOUND), create (happy),
 *   update (happy + CONFLICT estado), enviarRevision (happy + CONFLICT),
 *   firmar (BAD_REQUEST sin firma + CONFLICT estado), validar (BAD_REQUEST),
 *   anular (happy), FORBIDDEN (rol insuficiente).
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import type { TRPCContext } from "../../context";
import { eceHistoriaClinicaRouter } from "../ece/historia-clinica.router";
import { MOCK_USER_ADMIN } from "@his/test-utils";

// ─── Mock withEceContext ──────────────────────────────────────────────────────

vi.mock("../../ece/rls-context", () => ({
  withEceContext: vi.fn(
    async (
      _prisma: unknown,
      _ctx: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => fn(_prisma),
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HC_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PACIENTE_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const EPISODIO_ID = "cccccccc-0000-0000-0000-000000000003";
const FIRMA_ID = "dddddddd-0000-0000-0000-000000000004";
const INSTANCIA_ID = "eeeeeeee-0000-0000-0000-000000000005";

const SAMPLE_HC = {
  id: HC_ID,
  paciente_id: PACIENTE_ID,
  episodio_id: EPISODIO_ID,
  motivo_consulta: "Dolor abdominal severo",
  antecedentes: null,
  plan_inicial: null,
  estado: "borrador",
  instancia_id: INSTANCIA_ID,
  creado_por: MOCK_USER_ADMIN.id,
  creado_en: new Date("2026-05-17T08:00:00Z"),
  actualizado_en: new Date("2026-05-17T08:00:00Z"),
};

const TENANT_MC = {
  userId: MOCK_USER_ADMIN.id,
  organizationId: "00000000-0000-0000-0000-0000000000aa",
  countryId: "00000000-0000-0000-0000-0000000000bb",
  establishmentId: "00000000-0000-0000-0000-0000000000cc",
  roleCodes: ["MC"],
};

const TENANT_DIR = { ...TENANT_MC, roleCodes: ["DIR"] };
const TENANT_NURSE = { ...TENANT_MC, roleCodes: ["NURSE"] };
const TENANT_MT = { ...TENANT_MC, roleCodes: ["MT"] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExecuteRaw(): Mock {
  return vi.fn().mockResolvedValue(1);
}

function makePrisma(queryRawResults: unknown[] = [], executeRaw?: Mock) {
  const $queryRaw = vi.fn();
  queryRawResults.forEach((result, i) => {
    if (i === queryRawResults.length - 1) {
      $queryRaw.mockResolvedValue(result);
    } else {
      $queryRaw.mockResolvedValueOnce(result);
    }
  });
  return {
    $queryRaw,
    $executeRaw: executeRaw ?? makeExecuteRaw(),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw, $executeRaw: executeRaw ?? makeExecuteRaw(), $executeRawUnsafe: vi.fn() }),
    ),
  };
}

function makeCtx(
  roleCodes: string[] = ["MC"],
  queryRawResults: unknown[] = [],
  executeRaw?: Mock,
): TRPCContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = makePrisma(queryRawResults, executeRaw) as any;
  const tenant = { ...TENANT_MC, roleCodes };
  return {
    prisma,
    user: MOCK_USER_ADMIN,
    tenant,
    portalAccount: null,
    ip: "127.0.0.1",
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("retorna items y nextCursor=null cuando hay exactamente limit resultados", async () => {
      const ctx = makeCtx(["MC"], [[SAMPLE_HC]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.list({ pacienteId: PACIENTE_ID, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("retorna nextCursor cuando hay más registros que limit", async () => {
      const rows = Array.from({ length: 21 }, (_, i) => ({
        ...SAMPLE_HC,
        id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
      }));
      const ctx = makeCtx(["PHYSICIAN"], [rows]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.list({ pacienteId: PACIENTE_ID, limit: 20 });

      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).not.toBeNull();
    });
  });

  // ─── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("retorna la historia clínica cuando existe", async () => {
      const ctx = makeCtx(["PHYSICIAN"], [[SAMPLE_HC]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.get({ id: HC_ID });

      expect(result.id).toBe(HC_ID);
      expect(result.estado).toBe("borrador");
    });

    it("lanza NOT_FOUND cuando no existe", async () => {
      const ctx = makeCtx(["PHYSICIAN"], [[/*vacío*/]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.get({ id: HC_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("crea historia clínica en estado borrador", async () => {
      const ctx = makeCtx(["MC"], [[SAMPLE_HC]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.create({
        pacienteId: PACIENTE_ID,
        episodioId: EPISODIO_ID,
        motivoConsulta: "Dolor abdominal severo",
      });

      expect(result.id).toBe(HC_ID);
      expect(result.estado).toBe("borrador");
    });

    it("lanza FORBIDDEN si el rol es NURSE (no puede crear)", async () => {
      const ctx = makeCtx(["NURSE"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(
        caller.create({ pacienteId: PACIENTE_ID, motivoConsulta: "Test" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("actualiza cuando el estado es borrador", async () => {
      const updatedHc = { ...SAMPLE_HC, motivo_consulta: "Actualizado" };
      // 1ra call: estado check; 2da call: UPDATE RETURNING
      const ctx = makeCtx(["MC"], [[{ estado: "borrador" }], [updatedHc]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.update({ id: HC_ID, motivoConsulta: "Actualizado" });

      expect(result.motivo_consulta).toBe("Actualizado");
    });

    it("lanza CONFLICT si el estado es firmado", async () => {
      const ctx = makeCtx(["MC"], [[{ estado: "firmado" }]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(
        caller.update({ id: HC_ID, motivoConsulta: "X" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // ─── enviarRevision ────────────────────────────────────────────────────────

  describe("enviarRevision", () => {
    it("avanza de borrador a en_revision correctamente", async () => {
      const enRevision = { ...SAMPLE_HC, estado: "en_revision" };
      // 1ra: SELECT estado + instancia_id; 2da: UPDATE RETURNING; 3ra: INSERT historial (executeRaw)
      const ctx = makeCtx(
        ["MC"],
        [[{ estado: "borrador", instancia_id: INSTANCIA_ID }], [enRevision]],
        makeExecuteRaw(),
      );
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.enviarRevision({ id: HC_ID });

      expect(result.estado).toBe("en_revision");
    });

    it("lanza CONFLICT si el estado actual no es borrador", async () => {
      const ctx = makeCtx(["MT"], [[{ estado: "firmado", instancia_id: null }]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.enviarRevision({ id: HC_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  // ─── firmar ────────────────────────────────────────────────────────────────

  describe("firmar", () => {
    it("lanza BAD_REQUEST si no se proporciona firmaId", async () => {
      const ctx = makeCtx(["MC"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.firmar({ id: HC_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("avanza de en_revision a firmado con firmaId", async () => {
      const firmado = { ...SAMPLE_HC, estado: "firmado" };
      const ctx = makeCtx(
        ["MC"],
        [[{ estado: "en_revision", instancia_id: INSTANCIA_ID }], [firmado]],
        makeExecuteRaw(),
      );
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.firmar({ id: HC_ID, firmaId: FIRMA_ID });

      expect(result.estado).toBe("firmado");
    });

    it("lanza FORBIDDEN si el rol es MT (solo MC puede firmar)", async () => {
      const ctx = makeCtx(["MT"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.firmar({ id: HC_ID, firmaId: FIRMA_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  // ─── validar ───────────────────────────────────────────────────────────────

  describe("validar", () => {
    it("lanza BAD_REQUEST si no se proporciona firmaId", async () => {
      const ctx = makeCtx(["DIR"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.validar({ id: HC_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("avanza de firmado a validado con firmaId", async () => {
      const validado = { ...SAMPLE_HC, estado: "validado" };
      const ctx = makeCtx(
        ["DIR"],
        [[{ estado: "firmado", instancia_id: INSTANCIA_ID }], [validado]],
        makeExecuteRaw(),
      );
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.validar({ id: HC_ID, firmaId: FIRMA_ID });

      expect(result.estado).toBe("validado");
    });

    it("lanza FORBIDDEN si el rol es MC (solo DIR puede validar)", async () => {
      const ctx = makeCtx(["MC"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.validar({ id: HC_ID, firmaId: FIRMA_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  // ─── anular ────────────────────────────────────────────────────────────────

  describe("anular", () => {
    it("anula correctamente desde estado borrador", async () => {
      const anulado = { ...SAMPLE_HC, estado: "anulado" };
      const ctx = makeCtx(
        ["DIR"],
        [[{ estado: "borrador", instancia_id: null }], [anulado]],
        makeExecuteRaw(),
      );
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.anular({
        id: HC_ID,
        observacion: "Anulación por error administrativo",
        estadoActual: "borrador",
      });

      expect(result.estado).toBe("anulado");
    });
  });
});
