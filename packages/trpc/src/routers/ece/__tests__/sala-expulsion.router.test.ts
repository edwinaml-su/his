/**
 * Tests del eceSalaExpulsionRouter (Doc 14 NTEC — Sala de Expulsión).
 *
 * Cubre:
 *   list:               happy-path; filtro por episodio
 *   get:                happy-path; NOT_FOUND
 *   registrarNacimiento: happy-path; CONFLICT si episodio ya tiene registro;
 *                        PRECONDITION_FAILED si no hay personal ECE
 *   firmar:             happy-path; BAD_REQUEST si no es borrador; NOT_FOUND
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { eceSalaExpulsionRouter } from "../sala-expulsion.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

// withWorkflowContext: ejecuta el callback directamente (sin tx real)
vi.mock("../../../workflow/context", () => ({
  withWorkflowContext: vi.fn(
    async (
      _prisma: unknown,
      _ctx: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => fn(_prisma),
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SALA_ID       = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EPISODIO_ID   = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PERSONAL_ID   = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const RN_PLACEHOLDER = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function makeSalaRow(overrides: Partial<{
  id: string;
  episodio_hospitalario_id: string;
  tipo_parto: string;
  inicio_expulsivo_ts: Date | null;
  nacimiento_ts: Date;
  presentacion_fetal: string;
  mecanismo_parto: string;
  episiotomia: boolean;
  desgarro_perineal_grado: number | null;
  alumbramiento_ts: Date | null;
  placenta_completa: boolean | null;
  sangrado_estimado_ml: number | null;
  atencion_rn_placeholder: string | null;
  registrado_por: string;
  estado_registro: string;
  firmado_por: string | null;
  firmado_en: Date | null;
  registrado_en: Date;
}> = {}) {
  return {
    id: overrides.id ?? SALA_ID,
    episodio_hospitalario_id: overrides.episodio_hospitalario_id ?? EPISODIO_ID,
    tipo_parto: overrides.tipo_parto ?? "eutocico",
    inicio_expulsivo_ts: overrides.inicio_expulsivo_ts ?? null,
    nacimiento_ts: overrides.nacimiento_ts ?? new Date("2026-05-17T14:00:00Z"),
    presentacion_fetal: overrides.presentacion_fetal ?? "cefalica",
    mecanismo_parto: overrides.mecanismo_parto ?? "espontaneo",
    episiotomia: overrides.episiotomia ?? false,
    desgarro_perineal_grado: overrides.desgarro_perineal_grado ?? null,
    alumbramiento_ts: overrides.alumbramiento_ts ?? null,
    placenta_completa: overrides.placenta_completa ?? null,
    sangrado_estimado_ml: overrides.sangrado_estimado_ml ?? null,
    atencion_rn_placeholder: overrides.atencion_rn_placeholder ?? RN_PLACEHOLDER,
    registrado_por: overrides.registrado_por ?? PERSONAL_ID,
    estado_registro: overrides.estado_registro ?? "borrador",
    firmado_por: overrides.firmado_por ?? null,
    firmado_en: overrides.firmado_en ?? null,
    registrado_en: overrides.registrado_en ?? new Date("2026-05-17T14:05:00Z"),
  };
}

const NACIMIENTO_INPUT = {
  episodioHospitalarioId: EPISODIO_ID,
  tipoParto: "eutocico" as const,
  nacimientoTs: new Date("2026-05-17T14:00:00Z"),
  presentacionFetal: "cefalica" as const,
  mecanismoParto: "espontaneo" as const,
  episiotomia: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("eceSalaExpulsionRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("retorna registros sin filtro de episodio", async () => {
      const row = makeSalaRow();
      prisma.$queryRaw.mockResolvedValueOnce([row]);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list({ limit: 20 });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(SALA_ID);
    });

    it("retorna lista vacía cuando no hay registros", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list({ limit: 20 });

      expect(result).toHaveLength(0);
    });

    it("acepta filtro por episodioHospitalarioId", async () => {
      const row = makeSalaRow({ episodio_hospitalario_id: EPISODIO_ID });
      prisma.$queryRaw.mockResolvedValueOnce([row]);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list({
        episodioHospitalarioId: EPISODIO_ID,
        limit: 10,
      });

      expect(result[0].episodio_hospitalario_id).toBe(EPISODIO_ID);
    });
  });

  // ── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("retorna el registro cuando existe", async () => {
      const row = makeSalaRow();
      prisma.$queryRaw.mockResolvedValueOnce([row]);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.get({ id: SALA_ID });

      expect(result.id).toBe(SALA_ID);
      expect(result.tipo_parto).toBe("eutocico");
    });

    it("lanza NOT_FOUND si el registro no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.get({ id: SALA_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // ── registrarNacimiento ───────────────────────────────────────────────────

  describe("registrarNacimiento", () => {
    it("crea el registro y retorna id + rnPlaceholderId", async () => {
      // 1. existingCheck → 0
      prisma.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(0) }]);
      // 2. findPersonalId → PERSONAL_ID
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      // 3. gen_random_uuid para placeholder RN
      prisma.$queryRaw.mockResolvedValueOnce([{ rn_id: RN_PLACEHOLDER }]);
      // 4. INSERT RETURNING
      prisma.$queryRaw.mockResolvedValueOnce([{ id: SALA_ID }]);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.registrarNacimiento(NACIMIENTO_INPUT);

      expect(result.id).toBe(SALA_ID);
      expect(result.rnPlaceholderId).toBe(RN_PLACEHOLDER);
    });

    it("lanza CONFLICT si el episodio ya tiene un registro", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(1) }]);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.registrarNacimiento(NACIMIENTO_INPUT),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza PRECONDITION_FAILED si no hay personal ECE vinculado", async () => {
      // existingCheck → 0
      prisma.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(0) }]);
      // findPersonalId → vacío
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.registrarNacimiento(NACIMIENTO_INPUT),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // ── firmar ────────────────────────────────────────────────────────────────

  describe("firmar", () => {
    it("transiciona estado borrador → firmado", async () => {
      // findSalaExpulsion
      prisma.$queryRaw.mockResolvedValueOnce([makeSalaRow()]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.firmar({ id: SALA_ID });

      expect(result.ok).toBe(true);
    });

    it("lanza NOT_FOUND si el registro no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.firmar({ id: SALA_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("lanza BAD_REQUEST si el registro ya está firmado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        makeSalaRow({ estado_registro: "firmado" }),
      ]);

      const caller = eceSalaExpulsionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.firmar({ id: SALA_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });
  });
});
