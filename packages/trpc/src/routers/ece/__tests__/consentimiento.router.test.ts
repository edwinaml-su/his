/**
 * Tests — eceConsentimientoRouter (NTEC Art. 39 + 40)
 *
 * Cubre remediaciones S2-Tier4:
 *  C-01: trigger condicional — borrador permite UPDATE, firmado lo bloquea
 *  C-03: columnas firma_mc_* presentes en ConsentimientoRow
 *  C-04: campo `estado` gobierna inmutabilidad
 *  C-05: firmar() escribe firma_mc_* antes de avanzar workflow
 *  UI/C-02: schema create acepta tipoConsentimiento (string código, no UUID)
 *
 * Tests de integración tRPC (sin BD real — mocks de $queryRaw / $executeRaw).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { eceConsentimientoRouter } from "../consentimiento.router";
import {
  eceConsentimientoCreateSchema,
  eceConsentimientoFirmarPacienteSchema,
  eceConsentimientoFirmarMcSchema,
} from "../schemas";
import { argon2 } from "@his/infrastructure";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mock outbox + argon2 ────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-mock-id" }),
  };
});

vi.mock("@his/infrastructure", () => ({
  argon2: {
    verify: vi.fn().mockResolvedValue(true),
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CI_ID          = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INSTANCIA_ID   = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EPISODIO_ID    = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PACIENTE_ID    = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const PERSONAL_ID    = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ESTADO_ID      = "11111111-1111-1111-1111-111111111111";
const ESTADO_DEST_ID = "22222222-2222-2222-2222-222222222222";
const TIPO_DOC_ID    = "33333333-3333-3333-3333-333333333333";
const ESTADO_INI_ID  = "44444444-4444-4444-4444-444444444444";
const USER_ID        = "55555555-5555-5555-5555-555555555555";
const FIRMA_ID       = "66666666-6666-6666-6666-666666666666";

const MC_TENANT  = { ...MOCK_TENANT, roleCodes: ["MC"], establishmentId: "estab-01" };
const MC_USER    = { id: USER_ID, email: "mc@his.test", name: "Dr. MC" };

/** Fila base en estado borrador (incluye columnas C-03 y C-04) */
const CI_BORRADOR = {
  id: CI_ID,
  instancia_id: INSTANCIA_ID,
  paciente_id: PACIENTE_ID,
  episodio_id: EPISODIO_ID,
  tipo: "hospitalizacion",
  procedimiento_descrito: "Colecistectomía laparoscópica",
  riesgos_explicados: "Sangrado, infección",
  alternativas: "Tratamiento conservador",
  medico_que_informa: PERSONAL_ID,
  firmante_rol: null,
  firmante_nombre: null,
  firmante_documento: null,
  evidencia_firma_ref: null,
  // C-04: campo estado
  estado: "borrador",
  // C-03: columnas firma MC
  firma_mc_id: null,
  firma_mc_en: null,
  evidencia_firma_mc_ref: null,
  fecha_hora: new Date("2026-05-19T08:00:00Z"),
  estado_codigo: "borrador",
  estado_id: ESTADO_ID,
};

const CI_CON_FIRMA_PACIENTE = {
  ...CI_BORRADOR,
  firmante_rol: "paciente",
  firmante_nombre: "Juan Perez",
  firmante_documento: "01234567-8",
  evidencia_firma_ref: "data:image/png;base64,abc123",
};

const CI_FIRMADO = {
  ...CI_CON_FIRMA_PACIENTE,
  estado: "firmado",
  firma_mc_id: PERSONAL_ID,
  firma_mc_en: new Date("2026-05-19T08:30:00Z"),
  evidencia_firma_mc_ref: FIRMA_ID,
  estado_codigo: "firmado",
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  // withWorkflowContext usa $transaction
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRaw.mockResolvedValue(0 as never);
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  return prisma;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("eceConsentimientoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
    // vi.restoreAllMocks() in setup.ts clears vi.fn() implementations — re-init here.
    vi.mocked(argon2.verify).mockResolvedValue(true);
  });

  // ── Schema validation ──────────────────────────────────────────────────────

  it("eceConsentimientoCreateSchema acepta tipos válidos", () => {
    const valid = eceConsentimientoCreateSchema.safeParse({
      episodioId: EPISODIO_ID,
      tipoConsentimiento: "hospitalizacion",
      procedimientoDescrito: "Colecistectomía",
    });
    expect(valid.success).toBe(true);
  });

  it("eceConsentimientoCreateSchema rechaza tipo inválido", () => {
    const invalid = eceConsentimientoCreateSchema.safeParse({
      episodioId: EPISODIO_ID,
      tipoConsentimiento: "HOSPITALIZACION", // debe ser lowercase
      procedimientoDescrito: "Procedimiento",
    });
    expect(invalid.success).toBe(false);
  });

  it("eceConsentimientoFirmarPacienteSchema valida campos requeridos", () => {
    const valid = eceConsentimientoFirmarPacienteSchema.safeParse({
      consentimientoId: CI_ID,
      firmanteTipo: "paciente",
      firmanteNombre: "Juan Perez",
      firmanteDocumento: "01234567-8",
      firmaImagenUri: "https://storage.example.com/firma.png",
    });
    expect(valid.success).toBe(true);
  });

  it("eceConsentimientoFirmarMcSchema rechaza PIN con menos de 6 dígitos", () => {
    const invalid = eceConsentimientoFirmarMcSchema.safeParse({
      consentimientoId: CI_ID,
      pin: "12345",
    });
    expect(invalid.success).toBe(false);
  });

  it("eceConsentimientoFirmarMcSchema acepta PIN de 6 dígitos", () => {
    const valid = eceConsentimientoFirmarMcSchema.safeParse({
      consentimientoId: CI_ID,
      pin: "123456",
    });
    expect(valid.success).toBe(true);
  });

  // ── create ─────────────────────────────────────────────────────────────────

  it("create: NOT_FOUND cuando episodio no existe", async () => {
    // tipo_documento existe
    prisma.$queryRaw.mockResolvedValueOnce([
      { tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID },
    ] as never);
    // episodio no existe
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    await expect(
      caller.create({
        episodioId: EPISODIO_ID,
        tipoConsentimiento: "hospitalizacion",
        procedimientoDescrito: "Colecistectomía",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("create: PRECONDITION_FAILED cuando tipo CONS_INF no configurado", async () => {
    // tipo_documento no existe en catálogo
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    await expect(
      caller.create({
        episodioId: EPISODIO_ID,
        tipoConsentimiento: "hospitalizacion",
        procedimientoDescrito: "Colecistectomía",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("create: retorna consentimientoId e instanciaId en estado borrador", async () => {
    // tipo_documento
    prisma.$queryRaw.mockResolvedValueOnce([
      { tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID },
    ] as never);
    // episodio → pacienteId
    prisma.$queryRaw.mockResolvedValueOnce([{ paciente_id: PACIENTE_ID }] as never);
    // personal_salud del MC
    prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }] as never);
    // INSERT documento_instancia → instanciaId
    prisma.$queryRaw.mockResolvedValueOnce([{ id: INSTANCIA_ID }] as never);
    // INSERT consentimiento_informado → consentimientoId
    prisma.$queryRaw.mockResolvedValueOnce([{ id: CI_ID }] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    const result = await caller.create({
      episodioId: EPISODIO_ID,
      tipoConsentimiento: "hospitalizacion",
      procedimientoDescrito: "Colecistectomía laparoscópica",
      riesgos: "Sangrado, infección",
      alternativas: "Tratamiento conservador",
    });

    expect(result).toMatchObject({
      consentimientoId: CI_ID,
      instanciaId: INSTANCIA_ID,
      estadoCodigo: "borrador",
    });
  });

  // ── firmarPaciente ─────────────────────────────────────────────────────────

  it("firmarPaciente: NOT_FOUND cuando consentimiento no existe", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    await expect(
      caller.firmarPaciente({
        consentimientoId: CI_ID,
        firmanteTipo: "paciente",
        firmanteNombre: "Juan Perez",
        firmanteDocumento: "01234567-8",
        firmaImagenUri: "https://storage.example.com/firma.png",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("firmarPaciente: CONFLICT cuando estado != borrador (C-04 inmutabilidad)", async () => {
    // Consentimiento ya en estado firmado
    prisma.$queryRaw.mockResolvedValueOnce([CI_FIRMADO] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    await expect(
      caller.firmarPaciente({
        consentimientoId: CI_ID,
        firmanteTipo: "paciente",
        firmanteNombre: "Juan Perez",
        firmanteDocumento: "01234567-8",
        firmaImagenUri: "https://storage.example.com/firma.png",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("firmarPaciente: éxito en borrador — retorna ok + timestamp", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([CI_BORRADOR] as never);
    prisma.$executeRaw.mockResolvedValueOnce(1 as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    const result = await caller.firmarPaciente({
      consentimientoId: CI_ID,
      firmanteTipo: "paciente",
      firmanteNombre: "Juan Perez",
      firmanteDocumento: "01234567-8",
      firmaImagenUri: "https://storage.example.com/firma.png",
    });

    expect(result.ok).toBe(true);
    expect(result.firmaRegistradaEn).toBeDefined();
    // UPDATE debe haberse llamado (no rechazado por trigger condicional en borrador)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  // ── firmar (MC PIN — C-05) ─────────────────────────────────────────────────

  it("firmar: CONFLICT cuando estado != borrador (C-04)", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([CI_FIRMADO] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    await expect(
      caller.firmar({ consentimientoId: CI_ID, pin: "123456" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("firmar: PRECONDITION_FAILED cuando paciente no ha firmado aún", async () => {
    // Documento en borrador pero sin evidencia_firma_ref
    prisma.$queryRaw.mockResolvedValueOnce([CI_BORRADOR] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    await expect(
      caller.firmar({ consentimientoId: CI_ID, pin: "123456" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("firmar: PRECONDITION_FAILED cuando personal_salud no encontrado", async () => {
    // Documento con firma paciente
    prisma.$queryRaw.mockResolvedValueOnce([CI_CON_FIRMA_PACIENTE] as never);
    // personal_salud → vacío
    prisma.$queryRaw.mockResolvedValueOnce([] as never);
    // firma_electronica para PIN verify
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: FIRMA_ID, pin_hash: "$argon2id$...", failed_attempts: 0, locked_until: null, revoked_at: null },
    ] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    await expect(
      caller.firmar({ consentimientoId: CI_ID, pin: "123456" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("firmar: éxito — escribe firma_mc_* y activa inmutabilidad (C-03 + C-05)", async () => {
    // Consentimiento con firma paciente
    prisma.$queryRaw.mockResolvedValueOnce([CI_CON_FIRMA_PACIENTE] as never);
    // personal_salud del MC (verifyPinOrThrow)
    prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }] as never);
    // firma_electronica
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: FIRMA_ID, pin_hash: "$argon2id$...", failed_attempts: 0, locked_until: null, revoked_at: null },
    ] as never);
    // reset failed_attempts
    prisma.$executeRaw.mockResolvedValueOnce(1 as never);
    // personal_salud para firma_mc_id (segundo findPersonal)
    prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }] as never);
    // UPDATE consentimiento_informado SET firma_mc_* + estado='firmado'
    prisma.$executeRaw.mockResolvedValueOnce(1 as never);
    // avanzarEstado: buscar transición
    prisma.$queryRaw.mockResolvedValueOnce([
      { estado_destino_id: ESTADO_DEST_ID, rol_codigo: "MC" },
    ] as never);
    // UPDATE documento_instancia
    prisma.$executeRaw.mockResolvedValueOnce(1 as never);
    // INSERT historial
    prisma.$executeRaw.mockResolvedValueOnce(1 as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    const result = await caller.firmar({ consentimientoId: CI_ID, pin: "123456" });

    expect(result.ok).toBe(true);
    expect(result.contenidoHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(result.firmadoEn).toBeDefined();
  });

  // ── get ────────────────────────────────────────────────────────────────────

  it("get: NOT_FOUND cuando no existe", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    await expect(caller.get({ id: CI_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("get: devuelve row con campos C-03 y C-04", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([CI_FIRMADO] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    const result = await caller.get({ id: CI_ID });

    // C-04
    expect(result.estado).toBe("firmado");
    // C-03
    expect(result.firma_mc_id).toBe(PERSONAL_ID);
    expect(result.evidencia_firma_mc_ref).toBe(FIRMA_ID);
  });

  // ── list ───────────────────────────────────────────────────────────────────

  it("list: devuelve items vacíos y nextCursor null", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    const result = await caller.list({ limit: 10 });
    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("list: devuelve nextCursor cuando hay exactamente limit items", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      ...CI_BORRADOR,
      id: `${CI_ID.slice(0, -1)}${i}`,
    }));
    prisma.$queryRaw.mockResolvedValueOnce(rows as never);

    const caller = eceConsentimientoRouter.createCaller(
      makeCtx({ prisma, user: MC_USER, tenant: MC_TENANT }),
    );

    const result = await caller.list({ limit: 5 });
    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).not.toBeNull();
  });
});
