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
 *
 *   certificarBulk (HG-05):
 *     - 3 documentos válidos → todos exitosos, fallidos vacío
 *     - 1 de 3 falla (documento no 'validado') → exitosos=2, fallidos=1
 *     - PIN incorrecto → UNAUTHORIZED, ningún documento procesado
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceCertificacionRouter } from "../ece/certificacion.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";
import { argon2 } from "@his/infrastructure";

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

    // Restaurar verify tras clearAllMocks — usa import estático (no require)
    // para evitar SyntaxError al cargar el módulo ESM de @his/infrastructure.
    vi.mocked(argon2.verify).mockResolvedValue(true);
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
  //
  // Orden de llamadas $queryRaw (post-refactor — verificación PIN antes de certificarOneInTx):
  //   1. personal_salud  (findPersonal)
  //   2. firma_electronica  (incluye pin_hash)
  //   3. documento_instancia  (dentro de certificarOneInTx)
  //   4. flujo_estado 'certificado'  (dentro de certificarOneInTx)
  // -------------------------------------------------------------------------
  describe("certificar", () => {
    const FIRMA_ROW = {
      id: FIRMA_ID,
      pin_hash: "$argon2id$test$hash",
      failed_attempts: 0,
      locked_until: null,
      revoked_at: null,
    };

    function setupTransaccion() {
      prisma.$transaction.mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
    }

    function setupFirmaOk() {
      // 1. personal
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      // 2. firma
      prisma.$queryRaw.mockResolvedValueOnce([FIRMA_ROW]);
    }

    function setupHappyPath() {
      setupTransaccion();
      setupFirmaOk();
      // 3. instancia
      prisma.$queryRaw.mockResolvedValueOnce([makeInstanciaRow()]);
      // 4. estado 'certificado'
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
      setupTransaccion();
      setupFirmaOk();
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
      setupTransaccion();
      setupFirmaOk();
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
      setupTransaccion();
      // personal + firma (con pin_hash)
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([FIRMA_ROW]);

      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificar({ instanciaId: INSTANCIA_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("rechaza si no existe personal ECE asociado (PRECONDITION_FAILED)", async () => {
      setupTransaccion();
      // personal no encontrado (primera llamada $queryRaw en el nuevo orden)
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificar({ instanciaId: INSTANCIA_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // -------------------------------------------------------------------------
  // certificarBulk (HG-05)
  // -------------------------------------------------------------------------
  describe("certificarBulk", () => {
    const ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const ID_B = "bbbbbbbb-0000-0000-0000-000000000001";
    const ID_C = "cccccccc-0000-0000-0000-000000000002";

    /** Configura el prisma mock para un ciclo de verificación de firma. */
    function setupFirmaVerification() {
      prisma.$transaction.mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
      // personal_salud (verificación PIN)
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      // firma con pin_hash (verificación PIN)
      prisma.$queryRaw.mockResolvedValueOnce([{
        id: FIRMA_ID,
        pin_hash: "$argon2id$test$hash",
        failed_attempts: 0,
        locked_until: null,
        revoked_at: null,
      }]);
    }

    /** Configura el prisma mock para una certificación individual exitosa. */
    function setupDocExitoso(id: string) {
      // instancia
      prisma.$queryRaw.mockResolvedValueOnce([{
        ...makeInstanciaRow(),
        id,
      }]);
      // estado 'certificado'
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ESTADO_ID }]);
      // UPDATE instancia
      prisma.$executeRaw.mockResolvedValueOnce(1);
      // INSERT historial
      prisma.$executeRaw.mockResolvedValueOnce(1);
    }

    it("3 documentos válidos → todos exitosos, fallidos vacío", async () => {
      setupFirmaVerification();
      setupDocExitoso(ID_A);
      setupDocExitoso(ID_B);
      setupDocExitoso(ID_C);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      const result = await caller.certificarBulk({
        instanciaIds: [ID_A, ID_B, ID_C],
        pin: VALID_PIN,
      });

      expect(result.exitosos).toHaveLength(3);
      expect(result.fallidos).toHaveLength(0);
      expect(result.exitosos.map((e) => e.instanciaId)).toEqual(
        expect.arrayContaining([ID_A, ID_B, ID_C]),
      );
    });

    it("1 de 3 falla (documento no validado) → exitosos=2, fallidos=1", async () => {
      setupFirmaVerification();

      // Doc A — exitoso
      setupDocExitoso(ID_A);

      // Doc B — falla: estado 'borrador'
      prisma.$queryRaw.mockResolvedValueOnce([{
        ...makeInstanciaRow({ estado_codigo: "borrador" }),
        id: ID_B,
      }]);

      // Doc C — exitoso
      setupDocExitoso(ID_C);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      const result = await caller.certificarBulk({
        instanciaIds: [ID_A, ID_B, ID_C],
        pin: VALID_PIN,
      });

      expect(result.exitosos).toHaveLength(2);
      expect(result.fallidos).toHaveLength(1);
      expect(result.fallidos[0]?.instanciaId).toBe(ID_B);
    });

    it("PIN incorrecto → UNAUTHORIZED, ningún documento procesado", async () => {
      setupFirmaVerification();

      // PIN incorrecto
      const { argon2: argon2Mod } = await import("@his/infrastructure");
      vi.mocked(argon2Mod.verify).mockResolvedValueOnce(false);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificarBulk({
          instanciaIds: [ID_A, ID_B, ID_C],
          pin: VALID_PIN,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });
});
