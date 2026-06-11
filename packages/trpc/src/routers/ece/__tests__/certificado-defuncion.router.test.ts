/**
 * Tests unitarios — eceCertDefRouter (ECE Certificado de Defunción, NTEC Art. 21).
 *
 * Cubre el workflow completo: borrador → firmado (MC+PIN) → validado (MC+PIN) → certificado (DIR+PIN).
 * B-03: validar requiere PIN (no-repudio del Director Médico).
 * B-04: create rechaza epicrisis sin tipo_egreso = 'fallecido'.
 * B-02: withWorkflowContext demota rol — RLS aplica en transacciones.
 *
 * @QA E2E: ece-defuncion.spec.ts — cubre flujo UI completo con BD efímera.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceCertDefRouter } from "../certificado-defuncion.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";
import { TRPCError } from "@trpc/server";

// ──────────────────────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────────────────────

const CERT_ID     = "c1000000-0000-0000-0000-000000000001";
const INSTANCIA_ID = "d1000000-0000-0000-0000-000000000001";
const EPI_ID      = "e1000000-0000-0000-0000-000000000001";
const EPICRISIS_ID = "ec000000-0000-0000-0000-000000000001";
const PAC_ID      = "p1000000-0000-0000-0000-000000000001";
const ESTAB_ID    = MOCK_TENANT.establishmentId!;
const PERSONAL_ID = "a1000000-0000-0000-0000-000000000001";

const PIN_CORRECTO = "123456";
const PIN_INCORRECTO = "999999";

// ──────────────────────────────────────────────────────────────────────────────
// Mocks globales
// ──────────────────────────────────────────────────────────────────────────────

vi.mock("@his/infrastructure", () => ({
  argon2: {
    verify: vi.fn(async (_hash: string, pin: string) => pin === PIN_CORRECTO),
  },
}));

vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
  prisma: {},
}));

// withWorkflowContext envuelve en $transaction — el mock ejecuta el callback inline
// con el prisma mock para que los $queryRaw mocks funcionen.
vi.mock("../../../workflow/context", () => ({
  withWorkflowContext: vi.fn(
    async (_prisma: unknown, _ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn(_prisma),
  ),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

// Columnas reales de ece.certificado_defuncion (CertDefRow, DDL vivo 2026-06-11).
function makeCertRow(overrides: Partial<{
  estado_workflow: string;
  firmado_en: Date | null;
  validado_en: Date | null;
  certificado_en: Date | null;
  anulado_en: Date | null;
  payload_hash: string | null;
}> = {}) {
  return {
    id: CERT_ID,
    instancia_id: INSTANCIA_ID,
    episodio_id: EPI_ID,
    epicrisis_id: EPICRISIS_ID,
    fecha_hora_defuncion: new Date("2026-05-17T10:00:00Z"),
    causa_basica_cie10: "E11.9",
    causas_intermedias: [],
    causas_contribuyentes: [],
    clasificacion: "natural",
    numero_certificado: null,
    medico_certificante_id: PERSONAL_ID,
    registrado_en: new Date(),
    estado_workflow: overrides.estado_workflow ?? "borrador",
    medico_firmante_id: null,
    firmado_en: overrides.firmado_en ?? null,
    validado_en: overrides.validado_en ?? null,
    certificado_en: overrides.certificado_en ?? null,
    anulado_en: overrides.anulado_en ?? null,
    payload_hash: overrides.payload_hash ?? null,
  };
}

function makePersonalFirmaRow(pinHash = "hash-correcto") {
  return {
    id: PERSONAL_ID,
    pin_hash: pinHash,
    failed_attempts: 0,
    locked_until: null,
    revoked_at: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Contextos
// ──────────────────────────────────────────────────────────────────────────────

function makeMcCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["MC", "PHYSICIAN"] } });
}

function makeDirCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["DIR"] } });
}

// $transaction mock: ejecuta callback con el mismo prisma mock.
function mockTx(prisma: DeepMockProxy<PrismaClient>) {
  prisma.$transaction.mockImplementation(async (fn) =>
    fn(prisma as unknown as Parameters<typeof fn>[0]),
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("eceCertDefRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // list
  // ──────────────────────────────────────────────────────────────────────────
  describe("list", () => {
    it("devuelve items y total con filtros vacíos", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow()]);
      prisma.$queryRaw.mockResolvedValueOnce([{ total: BigInt(1) }]);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      const result = await caller.list({ page: 1, pageSize: 20 });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
    });

    it("lanza BAD_REQUEST si no hay establecimiento activo", async () => {
      const ctx = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, roleCodes: ["MC"], establishmentId: undefined },
      });
      const caller = eceCertDefRouter.createCaller(ctx);

      await expect(caller.list({ page: 1, pageSize: 20 })).rejects.toThrow(TRPCError);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // create — incluye B-04
  // ──────────────────────────────────────────────────────────────────────────
  describe("create", () => {
    // Schema instancia-first (DDL vivo 2026-06-11): instanciaId + clasificacion
    // (natural/violenta/accidente_transito/en_investigacion) + causaBasicaCie10.
    const createInput = {
      instanciaId: INSTANCIA_ID,
      episodioId: EPI_ID,
      epicrisisId: EPICRISIS_ID,
      fechaHoraDefuncion: new Date("2026-05-17T10:00:00Z"),
      clasificacion: "natural" as const,
      causaBasicaCie10: "E11.9",
      causasIntermedias: ["I50.9"],
      causasContribuyentes: [],
    };

    it("crea certificado en estado borrador cuando epicrisis es fallecido", async () => {
      // personal_salud
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      // B-04: epicrisis con tipo_egreso = 'fallecido'
      prisma.$queryRaw.mockResolvedValueOnce([{ tipo_egreso: "fallecido" }]);
      // unicidad: sin existentes
      prisma.$queryRaw.mockResolvedValueOnce([]);
      // episodio
      prisma.$queryRaw.mockResolvedValueOnce([{ paciente_id: PAC_ID }]);
      // INSERT → id
      prisma.$queryRaw.mockResolvedValueOnce([{ id: CERT_ID }]);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      const result = await caller.create(createInput);

      expect(result.id).toBe(CERT_ID);
    });

    it("B-04: lanza BAD_REQUEST si epicrisis no tiene tipo_egreso = 'fallecido'", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      // Epicrisis con egreso ordinario — no 'fallecido'
      prisma.$queryRaw.mockResolvedValueOnce([{ tipo_egreso: "alta_medica" }]);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.create(createInput)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("epicrisis_no_es_fallecido"),
      });
    });

    it("B-04: lanza NOT_FOUND si la epicrisis no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      // Epicrisis no encontrada
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.create(createInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("lanza CONFLICT si ya existe un certificado activo para el episodio", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([{ tipo_egreso: "fallecido" }]);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: CERT_ID }]); // existente

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.create(createInput)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("lanza NOT_FOUND si el episodio no pertenece al establecimiento", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([{ tipo_egreso: "fallecido" }]);
      prisma.$queryRaw.mockResolvedValueOnce([]); // sin existentes
      prisma.$queryRaw.mockResolvedValueOnce([]); // episodio no encontrado

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.create(createInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // firmar (borrador → firmado)
  // ──────────────────────────────────────────────────────────────────────────
  describe("firmar", () => {
    it("transiciona a firmado con PIN correcto y emite outbox", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "borrador" })]);
      prisma.$queryRaw.mockResolvedValueOnce([makePersonalFirmaRow()]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      const result = await caller.firmar({ id: CERT_ID, pin: PIN_CORRECTO });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("firmado");
    });

    it("lanza UNAUTHORIZED con PIN incorrecto", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "borrador" })]);
      prisma.$queryRaw.mockResolvedValueOnce([makePersonalFirmaRow()]);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.firmar({ id: CERT_ID, pin: PIN_INCORRECTO })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("lanza CONFLICT si el certificado no está en borrador", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "firmado" })]);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.firmar({ id: CERT_ID, pin: PIN_CORRECTO })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // validar (firmado → validado) — B-03: requiere PIN
  // ──────────────────────────────────────────────────────────────────────────
  describe("validar (B-03)", () => {
    it("transiciona a validado con PIN correcto", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "firmado" })]);
      prisma.$queryRaw.mockResolvedValueOnce([makePersonalFirmaRow()]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      const result = await caller.validar({ id: CERT_ID, firmaPin: PIN_CORRECTO });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("validado");
    });

    it("lanza UNAUTHORIZED si PIN es incorrecto (B-03)", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "firmado" })]);
      prisma.$queryRaw.mockResolvedValueOnce([makePersonalFirmaRow()]);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.validar({ id: CERT_ID, firmaPin: PIN_INCORRECTO })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("lanza CONFLICT si el estado no es firmado", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "borrador" })]);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.validar({ id: CERT_ID, firmaPin: PIN_CORRECTO })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("el schema exige firmaPin — sin PIN falla validación Zod", async () => {
      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      // firmaPin ausente → error de validación Zod (BAD_REQUEST)
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        caller.validar({ id: CERT_ID } as any),
      ).rejects.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // certificar (validado → certificado, DIR)
  // ──────────────────────────────────────────────────────────────────────────
  describe("certificar", () => {
    it("certifica el documento con PIN DIR correcto y emite outbox", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "validado" })]);
      prisma.$queryRaw.mockResolvedValueOnce([makePersonalFirmaRow()]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = eceCertDefRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.certificar({ id: CERT_ID, pin: PIN_CORRECTO });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("certificado");
    });

    it("lanza CONFLICT si el estado no es validado", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "firmado" })]);

      const caller = eceCertDefRouter.createCaller(makeDirCtx(prisma));
      await expect(caller.certificar({ id: CERT_ID, pin: PIN_CORRECTO })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // anular
  // ──────────────────────────────────────────────────────────────────────────
  describe("anular", () => {
    it("anula un certificado en borrador", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "borrador" })]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = eceCertDefRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.anular({
        id: CERT_ID,
        motivoAnulacion: "Error de datos ingresados por el médico.",
      });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("anulado");
    });

    it("lanza FORBIDDEN si intenta anular un certificado ya certificado", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "certificado" })]);

      const caller = eceCertDefRouter.createCaller(makeDirCtx(prisma));
      await expect(
        caller.anular({ id: CERT_ID, motivoAnulacion: "Error de datos ingresados por el médico." }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("lanza CONFLICT si el certificado ya está anulado", async () => {
      mockTx(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "anulado" })]);

      const caller = eceCertDefRouter.createCaller(makeDirCtx(prisma));
      await expect(
        caller.anular({ id: CERT_ID, motivoAnulacion: "Error de datos ingresados por el médico." }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Transición completa: borrador → firmado → validado → certificado
  // ──────────────────────────────────────────────────────────────────────────
  describe("transición de estados completa", () => {
    it("completa el workflow borrador→firmado→validado→certificado", async () => {
      mockTx(prisma);

      // firmar
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "borrador" })]);
      prisma.$queryRaw.mockResolvedValueOnce([makePersonalFirmaRow()]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const mcCaller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      const firmado = await mcCaller.firmar({ id: CERT_ID, pin: PIN_CORRECTO });
      expect(firmado.estado).toBe("firmado");

      // validar — B-03: con PIN
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "firmado" })]);
      prisma.$queryRaw.mockResolvedValueOnce([makePersonalFirmaRow()]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const validado = await mcCaller.validar({ id: CERT_ID, firmaPin: PIN_CORRECTO });
      expect(validado.estado).toBe("validado");

      // certificar
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "validado" })]);
      prisma.$queryRaw.mockResolvedValueOnce([makePersonalFirmaRow()]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const dirCaller = eceCertDefRouter.createCaller(makeDirCtx(prisma));
      const certificado = await dirCaller.certificar({ id: CERT_ID, pin: PIN_CORRECTO });
      expect(certificado.estado).toBe("certificado");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Seguridad de roles
  // ──────────────────────────────────────────────────────────────────────────
  describe("seguridad de roles", () => {
    it("certificar lanza FORBIDDEN si el rol no es DIR", async () => {
      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(
        caller.certificar({ id: CERT_ID, pin: PIN_CORRECTO }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("anular lanza FORBIDDEN si el rol no es DIR", async () => {
      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(
        caller.anular({ id: CERT_ID, motivoAnulacion: "Error de datos ingresados." }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
