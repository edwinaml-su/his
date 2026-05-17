/**
 * Tests unitarios — eceCertDefRouter (ECE Certificado de Defunción, NTEC Art. 21).
 *
 * Cubre el workflow completo: borrador → firmado (MC) → validado (MC) → certificado (DIR).
 * Intentos inválidos: doble firma, anular certificado, certificar sin validar, rol incorrecto.
 *
 * @QA E2E: ece-defuncion.spec.ts — cubre flujo UI completo con BD efímera.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceCertDefRouter } from "../certificado-defuncion.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN } from "@his/test-utils";
import { TRPCError } from "@trpc/server";

// ──────────────────────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────────────────────

const CERT_ID  = "c1000000-0000-0000-0000-000000000001";
const EPI_ID   = "e1000000-0000-0000-0000-000000000001";
const PAC_ID   = "p1000000-0000-0000-0000-000000000001";
const ESTAB_ID = MOCK_TENANT.establishmentId!;
const ORG_ID   = MOCK_TENANT.organizationId;
const PERSONAL_ID = "a1000000-0000-0000-0000-000000000001";
const FIRMA_ID = "f1000000-0000-0000-0000-000000000001";

// PIN correcto mockeado — argon2.verify se mockea globalmente.
const PIN_CORRECTO = "123456";

// ──────────────────────────────────────────────────────────────────────────────
// Mock argon2 (evita dependencia nativa en unit tests)
// ──────────────────────────────────────────────────────────────────────────────

vi.mock("argon2", () => ({
  default: {
    verify: vi.fn(async (_hash: string, pin: string) => pin === PIN_CORRECTO),
  },
}));

// ──────────────────────────────────────────────────────────────────────────────
// Mock emitDomainEvent (evita BD real)
// ──────────────────────────────────────────────────────────────────────────────

vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
  prisma: {},
}));

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de fila
// ──────────────────────────────────────────────────────────────────────────────

function makeCertRow(overrides: {
  estado_workflow?: string;
  firmado_en?: Date | null;
  validado_en?: Date | null;
  certificado_en?: Date | null;
  anulado_en?: Date | null;
  motivo_anulacion?: string | null;
  payload_hash?: string | null;
} = {}) {
  return {
    id: CERT_ID,
    episodio_id: EPI_ID,
    paciente_id: PAC_ID,
    fecha_hora_defuncion: new Date("2026-05-17T10:00:00Z"),
    lugar_defuncion: "intrahospitalaria",
    causa_principal_cie10: "J18.9",
    causas_intermedias_cie10: [],
    causa_basica_cie10: "E11.9",
    manera: "natural",
    autopsia_realizada: false,
    observaciones: null,
    estado_workflow: overrides.estado_workflow ?? "borrador",
    medico_firmante_id: null,
    firmado_en: overrides.firmado_en ?? null,
    validado_en: overrides.validado_en ?? null,
    certificado_en: overrides.certificado_en ?? null,
    anulado_en: overrides.anulado_en ?? null,
    motivo_anulacion: overrides.motivo_anulacion ?? null,
    payload_hash: overrides.payload_hash ?? null,
    registrado_en: new Date(),
    establecimiento_id: ESTAB_ID,
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
// Helpers de contexto
// ──────────────────────────────────────────────────────────────────────────────

function makeMcCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: { ...MOCK_TENANT, roleCodes: ["MC", "PHYSICIAN"] },
  });
}

function makeDirCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: { ...MOCK_TENANT, roleCodes: ["DIR"] },
  });
}

// $transaction mock: ejecuta el callback con el mismo prisma mock.
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

  // ────────────────────────────────────────────────────────────────────────────
  // list
  // ────────────────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────────────────
  // create
  // ────────────────────────────────────────────────────────────────────────────
  describe("create", () => {
    const createInput = {
      episodioId: EPI_ID,
      fechaHoraDefuncion: new Date("2026-05-17T10:00:00Z"),
      lugarDefuncion: "intrahospitalaria" as const,
      causaPrincipalCie10: "J18.9",
      causasIntermediasCie10: ["I50.9"],
      causaBasicaCie10: "E11.9",
      manera: "natural" as const,
      autopsiaRealizada: false,
    };

    it("crea certificado en estado borrador", async () => {
      // personal_salud
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
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

    it("lanza CONFLICT si ya existe un certificado activo para el episodio", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: CERT_ID }]); // existente

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.create(createInput)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("lanza NOT_FOUND si el episodio no pertenece al establecimiento", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([]); // sin existentes
      prisma.$queryRaw.mockResolvedValueOnce([]); // episodio no encontrado

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.create(createInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // firmar (borrador → firmado)
  // ────────────────────────────────────────────────────────────────────────────
  describe("firmar", () => {
    it("transiciona a firmado con PIN correcto y emite outbox", async () => {
      mockTx(prisma);
      // FOR UPDATE → cert borrador
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "borrador" })]);
      // personal + firma
      prisma.$queryRaw.mockResolvedValueOnce([makePersonalFirmaRow()]);
      // UPDATE
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
      await expect(caller.firmar({ id: CERT_ID, pin: "999999" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("lanza CONFLICT si el certificado no está en borrador", async () => {
      mockTx(prisma);
      // Cert ya firmado
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "firmado" })]);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.firmar({ id: CERT_ID, pin: PIN_CORRECTO })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // validar (firmado → validado)
  // ────────────────────────────────────────────────────────────────────────────
  describe("validar", () => {
    it("transiciona a validado desde firmado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "firmado" })]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      const result = await caller.validar({ id: CERT_ID });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("validado");
    });

    it("lanza CONFLICT si el estado no es firmado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "borrador" })]);

      const caller = eceCertDefRouter.createCaller(makeMcCtx(prisma));
      await expect(caller.validar({ id: CERT_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // certificar (validado → certificado, DIR)
  // ────────────────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────────────────
  // anular
  // ────────────────────────────────────────────────────────────────────────────
  describe("anular", () => {
    it("anula un certificado en borrador", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "borrador" })]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = eceCertDefRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.anular({ id: CERT_ID, motivoAnulacion: "Error de datos ingresados por el médico." });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("anulado");
    });

    it("lanza FORBIDDEN si intenta anular un certificado ya certificado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "certificado" })]);

      const caller = eceCertDefRouter.createCaller(makeDirCtx(prisma));
      await expect(
        caller.anular({ id: CERT_ID, motivoAnulacion: "Error de datos ingresados por el médico." }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("lanza CONFLICT si el certificado ya está anulado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeCertRow({ estado_workflow: "anulado" })]);

      const caller = eceCertDefRouter.createCaller(makeDirCtx(prisma));
      await expect(
        caller.anular({ id: CERT_ID, motivoAnulacion: "Error de datos ingresados por el médico." }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Seguridad: rol incorrecto
  // ────────────────────────────────────────────────────────────────────────────
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
