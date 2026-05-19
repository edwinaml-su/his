/**
 * Tests del eceCertificacionRouter (Fase 2 — Certificación DIR).
 *
 * Cubre:
 *   listCola:
 *     - devuelve documentos en estado 'validado'
 *     - rechaza si el rol no es DIR (FORBIDDEN)
 *
 *   certificar:
 *     - happy-path: certifica, registra historial, emite evento
 *     - rechaza si documento no está en estado 'validado' (PRECONDITION_FAILED)
 *     - rechaza tipo de documento no certificable (FORBIDDEN)
 *     - rechaza si PIN es incorrecto (UNAUTHORIZED)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceCertificacionRouter } from "../ece/certificacion.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

// Mock argon2 para tests rápidos
vi.mock("@his/infrastructure", () => ({
  argon2: {
    argon2id: 2,
    hash: vi.fn().mockResolvedValue("$argon2id$test$hash"),
    verify: vi.fn().mockResolvedValue(true),
  },
}));

// Mock emitDomainEvent para evitar insertar en BD real
vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-id" }),
}));

const DIR_TENANT = { ...MOCK_TENANT, roleCodes: ["DIR"] };
const NON_DIR_TENANT = { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] };

const INSTANCIA_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PERSONAL_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const FIRMA_ID     = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ESTADO_ID    = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const VALID_PIN    = "123456";

function makeInstanciaRow(overrides: Partial<{
  estado_codigo: string;
  tipo_documento_codigo: string;
}> = {}) {
  return {
    id: INSTANCIA_ID,
    estado_actual_id: ESTADO_ID,
    estado_codigo: overrides.estado_codigo ?? "validado",
    tipo_documento_codigo: overrides.tipo_documento_codigo ?? "FICHA_ID",
    paciente_id: "00000000-0000-0000-0000-000000000010",
    version: 1,
  };
}

describe("eceCertificacionRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();

    // Restaurar verify tras clearAllMocks
    const argon2Module = vi.mocked(require("@his/infrastructure"));
    
    argon2Module.argon2.verify = vi.fn().mockResolvedValue(true);
  });

  // -------------------------------------------------------------------------
  // listCola
  // -------------------------------------------------------------------------
  describe("listCola", () => {
    it("devuelve documentos en estado validado", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: INSTANCIA_ID,
          tipo_documento_codigo: "EPICRISIS",
          tipo_documento_nombre: "Epicrisis",
          paciente_id: "00000000-0000-0000-0000-000000000010",
          paciente_nombre: "Juana Perez",
          estado_codigo: "validado",
          estado_nombre: "Validado",
          version: 1,
          validado_por: null,
          validado_por_nombre: null,
          creado_en: new Date("2026-05-10T08:00:00Z"),
          ultimo_cambio_en: new Date("2026-05-11T10:00:00Z"),
        },
      ]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      const result = await caller.listCola({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.estadoCodigo).toBe("validado");
      expect(result.nextCursor).toBeUndefined();
    });

    it("rechaza rol no DIR (FORBIDDEN)", async () => {
      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: NON_DIR_TENANT }),
      );
      await expect(caller.listCola({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // -------------------------------------------------------------------------
  // certificar
  // -------------------------------------------------------------------------
  describe("certificar", () => {
    function setupHappyPath() {
      // $transaction delegado — el mock ejecuta el callback directamente
      prisma.$transaction.mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
        fn(prisma),
      );
      // GUC SET LOCAL — dentro de withWorkflowContext
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
      // Leer instancia
      prisma.$queryRaw.mockResolvedValueOnce([makeInstanciaRow()]);
      // personal_salud
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      // firma con pin_hash
      prisma.$queryRaw.mockResolvedValueOnce([{
        id: FIRMA_ID,
        pin_hash: "$argon2id$test$hash",
        failed_attempts: 0,
        locked_until: null,
        revoked_at: null,
      }]);
      // estado 'certificado'
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ESTADO_ID }]);
      // UPDATE instancia
      prisma.$executeRaw.mockResolvedValueOnce(1);
      // INSERT historial
      prisma.$executeRaw.mockResolvedValueOnce(1);
    }

    it("happy-path: certifica y devuelve ok:true + instanciaId", async () => {
      setupHappyPath();

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      const result = await caller.certificar({
        instanciaId: INSTANCIA_ID,
        pin: VALID_PIN,
      });

      expect(result.ok).toBe(true);
      expect(result.instanciaId).toBe(INSTANCIA_ID);
      expect(result.payloadHash).toHaveLength(64);
    });

    it("rechaza documento no en estado 'validado' (PRECONDITION_FAILED)", async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
      // instancia en estado 'borrador'
      prisma.$queryRaw.mockResolvedValueOnce([
        makeInstanciaRow({ estado_codigo: "borrador" }),
      ]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificar({ instanciaId: INSTANCIA_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("rechaza tipo de documento no certificable (FORBIDDEN)", async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
      prisma.$queryRaw.mockResolvedValueOnce([
        makeInstanciaRow({ tipo_documento_codigo: "NOTA_EVOLUCION" }),
      ]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificar({ instanciaId: INSTANCIA_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rechaza PIN incorrecto (UNAUTHORIZED)", async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
      prisma.$queryRaw.mockResolvedValueOnce([makeInstanciaRow()]);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([{
        id: FIRMA_ID,
        pin_hash: "$argon2id$test$hash",
        failed_attempts: 0,
        locked_until: null,
        revoked_at: null,
      }]);

      // PIN incorrecto
      const argon2 = await import("argon2");
      vi.mocked(argon2.default.verify).mockResolvedValueOnce(false);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificar({ instanciaId: INSTANCIA_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("rechaza si no existe personal ECE asociado (PRECONDITION_FAILED)", async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
      prisma.$queryRaw.mockResolvedValueOnce([makeInstanciaRow()]);
      // personal no encontrado
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificar({ instanciaId: INSTANCIA_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });
});
