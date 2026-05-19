/**
 * Tests del eceConsentimientoRouter (Stream — Consentimiento Informado ECE).
 *
 * Cubre:
 *   - create: happy-path, episodio no encontrado, tipo CONS_INF no configurado.
 *   - get: happy-path, NOT_FOUND.
 *   - list: retorna items con nextCursor.
 *   - firmarPaciente: happy-path, CONFLICT si estado != borrador.
 *   - firmar (MC + PIN): happy-path, PRECONDITION_FAILED sin firma paciente,
 *     CONFLICT si estado != borrador, PIN incorrecto UNAUTHORIZED.
 *   - validar (DIR): happy-path, CONFLICT si estado != firmado.
 *   - Inmutabilidad: firmarPaciente y firmar rechazan con CONFLICT si post-firma.
 *
 * Patrón: prisma mock con $queryRaw / $executeRaw / $transaction stubbados.
 * argon2 mocked para evitar bcrypt real en unit tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { eceConsentimientoRouter } from "../ece/consentimiento.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("argon2", () => ({
  default: {
    argon2id: 2,
    hash: vi.fn().mockResolvedValue("$argon2id$test$hash"),
    verify: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "event-id" }),
  };
});

import { emitDomainEvent } from "@his/database";
// Importación estática necesaria para que vi.mocked funcione correctamente
import argon2 from "@his/infrastructure/firma/argon2";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CI_ID         = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INSTANCIA_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EPISODIO_ID   = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PACIENTE_ID   = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const PERSONAL_ID   = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const FIRMA_ID      = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const TIPO_DOC_ID   = "11111111-1111-1111-1111-111111111111";
const ESTADO_INI_ID = "22222222-2222-2222-2222-222222222222";
const ESTADO_FIR_ID = "33333333-3333-3333-3333-333333333333";

const ECE_TENANT = {
  ...MOCK_TENANT,
  establishmentId: "00000000-0000-0000-0000-000000000099",
  roleCodes: ["MC", "DIR"],
};

const CI_ROW_BORRADOR = {
  id: CI_ID,
  instancia_id: INSTANCIA_ID,
  paciente_id: PACIENTE_ID,
  episodio_id: EPISODIO_ID,
  tipo: "hospitalizacion",
  procedimiento_descrito: "Apendicectomía",
  riesgos_explicados: "Sangrado, infección",
  alternativas: "Tratamiento conservador",
  medico_que_informa: PERSONAL_ID,
  firmante_rol: null,
  firmante_nombre: null,
  firmante_documento: null,
  evidencia_firma_ref: null,
  fecha_hora: new Date("2026-05-17T10:00:00Z"),
  estado_codigo: "borrador",
  estado_id: ESTADO_INI_ID,
};

const CI_ROW_CON_FIRMA_PACIENTE = {
  ...CI_ROW_BORRADOR,
  firmante_rol: "paciente",
  firmante_nombre: "Juan Pérez",
  firmante_documento: "01234567-8",
  evidencia_firma_ref: "https://storage.example.com/firma-1.png",
};

const CI_ROW_FIRMADO = {
  ...CI_ROW_CON_FIRMA_PACIENTE,
  estado_codigo: "firmado",
  estado_id: ESTADO_FIR_ID,
};

const FIRMA_ROW = {
  id: FIRMA_ID,
  pin_hash: "$argon2id$test$hash",
  failed_attempts: 0,
  locked_until: null,
  revoked_at: null,
};

// ─── Helper: crear prisma mock con $transaction pasante ───────────────────────

function makeEcePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  prisma.$executeRaw.mockResolvedValue(0 as never);
  return prisma;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("eceConsentimientoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makeEcePrisma();
    vi.clearAllMocks();
    // Restaurar implementaciones por defecto después de clearAllMocks
    vi.mocked(argon2.verify).mockResolvedValue(true);
    vi.mocked(argon2.hash).mockResolvedValue("$argon2id$test$hash");
    vi.mocked(emitDomainEvent).mockResolvedValue({ id: "event-id" });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe("create", () => {
    it("happy-path: crea borrador y devuelve ids", async () => {
      // tipo doc CONS_INF + estado inicial
      prisma.$queryRaw
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID }] as never)
        // paciente del episodio
        .mockResolvedValueOnce([{ paciente_id: PACIENTE_ID }] as never)
        // personal_salud del MC
        .mockResolvedValueOnce([{ id: PERSONAL_ID }] as never)
        // RETURNING instanciaId
        .mockResolvedValueOnce([{ id: INSTANCIA_ID }] as never)
        // RETURNING consentimientoId
        .mockResolvedValueOnce([{ id: CI_ID }] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.create({
        episodioId: EPISODIO_ID,
        tipoConsentimiento: "hospitalizacion",
        procedimientoDescrito: "Apendicectomía",
        riesgos: "Sangrado, infección",
        alternativas: "Tratamiento conservador",
      });

      expect(result.consentimientoId).toBe(CI_ID);
      expect(result.estadoCodigo).toBe("borrador");
    });

    it("lanza NOT_FOUND si el episodio no existe", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID }] as never)
        .mockResolvedValueOnce([] as never); // episodio vacío

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(
        caller.create({
          episodioId: EPISODIO_ID,
          tipoConsentimiento: "quirurgico",
          procedimientoDescrito: "Colecistectomía",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lanza PRECONDITION_FAILED si CONS_INF no está en catálogo", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(
        caller.create({
          episodioId: EPISODIO_ID,
          tipoConsentimiento: "hospitalizacion",
          procedimientoDescrito: "Test",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // ─── get ──────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("retorna el consentimiento cuando existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([CI_ROW_BORRADOR] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.get({ id: CI_ID });
      expect(result.id).toBe(CI_ID);
      expect(result.estado_codigo).toBe("borrador");
    });

    it("lanza NOT_FOUND cuando no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(caller.get({ id: CI_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── list ─────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("retorna items y nextCursor cuando hay más resultados que el límite", async () => {
      const rows = Array.from({ length: 20 }, (_, i) => ({
        ...CI_ROW_BORRADOR,
        id: `id-${String(i).padStart(8, "0")}`,
      }));
      prisma.$queryRaw.mockResolvedValueOnce(rows as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.list({ episodioId: EPISODIO_ID, limit: 20 });

      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).toBe("id-00000019");
    });
  });

  // ─── firmarPaciente ───────────────────────────────────────────────────────

  describe("firmarPaciente", () => {
    it("happy-path: registra firma del paciente en borrador", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([CI_ROW_BORRADOR] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.firmarPaciente({
        consentimientoId: CI_ID,
        firmanteTipo: "paciente",
        firmanteNombre: "Juan Pérez",
        firmanteDocumento: "01234567-8",
        firmaImagenUri: "https://storage.example.com/firma.png",
      });

      expect(result.ok).toBe(true);
      expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    });

    it("CONFLICT: rechaza si el estado no es borrador (inmutabilidad)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([CI_ROW_FIRMADO] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(
        caller.firmarPaciente({
          consentimientoId: CI_ID,
          firmanteTipo: "paciente",
          firmanteNombre: "Juan Pérez",
          firmanteDocumento: "01234567-8",
          firmaImagenUri: "https://storage.example.com/firma.png",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // ─── firmar (MC + PIN) ────────────────────────────────────────────────────

  describe("firmar", () => {
    it("happy-path: MC firma con PIN válido, emite evento de dominio", async () => {
      prisma.$queryRaw
        // findConsentimiento
        .mockResolvedValueOnce([CI_ROW_CON_FIRMA_PACIENTE] as never)
        // findPersonal (para verifyPinOrThrow)
        .mockResolvedValueOnce([{ id: PERSONAL_ID }] as never)
        // findFirmaByPersonal
        .mockResolvedValueOnce([FIRMA_ROW] as never)
        // avanzarEstado: buscar transición
        .mockResolvedValueOnce([{ estado_destino_id: ESTADO_FIR_ID, rol_codigo: "MC" }] as never);
      // executeRaw: reset counter + UPDATE instancia + INSERT historial
      prisma.$executeRaw.mockResolvedValue(1 as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.firmar({
        consentimientoId: CI_ID,
        pin: "123456",
      });

      expect(result.ok).toBe(true);
      expect(result.contenidoHash).toMatch(/^[0-9a-f]{64}$/);
      expect(emitDomainEvent).toHaveBeenCalledOnce();
    });

    it("PRECONDITION_FAILED: el paciente no ha firmado aún", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([CI_ROW_BORRADOR] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(
        caller.firmar({ consentimientoId: CI_ID, pin: "123456" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("CONFLICT: inmutabilidad — rechaza si estado != borrador", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([CI_ROW_FIRMADO] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(
        caller.firmar({ consentimientoId: CI_ID, pin: "123456" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("UNAUTHORIZED: PIN incorrecto incrementa contador y lanza UNAUTHORIZED", async () => {
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      prisma.$queryRaw
        .mockResolvedValueOnce([CI_ROW_CON_FIRMA_PACIENTE] as never)
        .mockResolvedValueOnce([{ id: PERSONAL_ID }] as never)
        .mockResolvedValueOnce([FIRMA_ROW] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(
        caller.firmar({ consentimientoId: CI_ID, pin: "999999" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      // Debe haber incrementado el contador
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });
  });

  // ─── crearQuirurgico ──────────────────────────────────────────────────────

  describe("crearQuirurgico", () => {
    const QX_INPUT = {
      episodioId: EPISODIO_ID,
      tipoConsentimiento: "quirurgico" as const,
      procedimientoDescrito: "Colecistectomía laparoscópica",
      riesgos: "Sangrado, lesión vías biliares",
      alternativas: "Tratamiento conservador",
      tipoAnestesia: "general" as const,
      transfusionAutorizada: true,
      ampliacionQuirurgicaAutorizada: true,
      fotografiaGrabacionAutorizada: false,
    };

    it("happy-path: crea CONS_QX y devuelve ids con tipo CONS_QX", async () => {
      prisma.$queryRaw
        // tipo doc CONS_QX
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID }] as never)
        // paciente del episodio
        .mockResolvedValueOnce([{ paciente_id: PACIENTE_ID }] as never)
        // personal_salud del MC
        .mockResolvedValueOnce([{ id: PERSONAL_ID }] as never)
        // RETURNING instanciaId
        .mockResolvedValueOnce([{ id: INSTANCIA_ID }] as never)
        // RETURNING consentimientoId
        .mockResolvedValueOnce([{ id: CI_ID }] as never);
      // INSERT consentimiento_quirurgico → executeRaw
      prisma.$executeRaw.mockResolvedValueOnce(1 as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.crearQuirurgico(QX_INPUT);

      expect(result.consentimientoId).toBe(CI_ID);
      expect(result.estadoCodigo).toBe("borrador");
      expect(result.tipo).toBe("CONS_QX");
      // Debe haber llamado executeRaw para insertar la tabla satélite
      expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    });

    it("PRECONDITION_FAILED si CONS_QX no está en el catálogo ECE", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never); // catálogo vacío

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(caller.crearQuirurgico(QX_INPUT)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("NOT_FOUND si el episodio no existe", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID }] as never)
        .mockResolvedValueOnce([] as never); // episodio vacío

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(caller.crearQuirurgico(QX_INPUT)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("PRECONDITION_FAILED si no hay personal_salud para el MC", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID }] as never)
        .mockResolvedValueOnce([{ paciente_id: PACIENTE_ID }] as never)
        .mockResolvedValueOnce([] as never); // personal vacío

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(caller.crearQuirurgico(QX_INPUT)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("acepta fotografia_grabacion_autorizada:false y transfusion:false sin error", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID }] as never)
        .mockResolvedValueOnce([{ paciente_id: PACIENTE_ID }] as never)
        .mockResolvedValueOnce([{ id: PERSONAL_ID }] as never)
        .mockResolvedValueOnce([{ id: INSTANCIA_ID }] as never)
        .mockResolvedValueOnce([{ id: CI_ID }] as never);
      prisma.$executeRaw.mockResolvedValueOnce(1 as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.crearQuirurgico({
        ...QX_INPUT,
        transfusionAutorizada: false,
        fotografiaGrabacionAutorizada: false,
        ampliacionQuirurgicaAutorizada: false,
      });

      expect(result.consentimientoId).toBe(CI_ID);
    });

    it("rechaza input con tipoAnestesia inválido (schema Zod)", async () => {
      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(
        caller.crearQuirurgico({
          ...QX_INPUT,
          // @ts-expect-error a propósito: valor fuera del enum
          tipoAnestesia: "epidural_desconocida",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ─── validar (DIR) ────────────────────────────────────────────────────────

  describe("validar", () => {
    it("happy-path: DIR valida un consentimiento firmado", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([CI_ROW_FIRMADO] as never)
        // avanzarEstado: transición firmado → validado
        .mockResolvedValueOnce([{ estado_destino_id: "validado-id", rol_codigo: "DIR" }] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: { ...ECE_TENANT, roleCodes: ["DIR"] } }),
      );
      const result = await caller.validar({ consentimientoId: CI_ID });
      expect(result.ok).toBe(true);
    });

    it("CONFLICT: no puede validar si el consentimiento no está firmado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([CI_ROW_BORRADOR] as never);

      const caller = eceConsentimientoRouter.createCaller(
        makeCtx({ prisma, tenant: { ...ECE_TENANT, roleCodes: ["DIR"] } }),
      );
      await expect(
        caller.validar({ consentimientoId: CI_ID }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });
});
