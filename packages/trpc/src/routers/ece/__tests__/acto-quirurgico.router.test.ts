/**
 * Tests del eceActoQuirurgicoRouter (NTEC §3.13 / Doc 13 — Acto Quirúrgico).
 *
 * Cubre:
 *  1.  schema: estadoActoQxSchema rechaza estado inválido
 *  2.  schema: actoQxCreateSchema requiere campos obligatorios
 *  3.  schema: actoQxFirmarSchema valida formato PIN
 *  4.  schema: ayudanteSchema rechaza rol inválido
 *  5.  list — devuelve items y nextCursor nulo
 *  6.  get  — NOT_FOUND cuando acto no existe
 *  7.  get  — devuelve acto existente
 *  8.  create — NOT_FOUND cuando episodio no existe
 *  9.  create — PRECONDITION_FAILED cuando tipo documento ACT_QX no configurado
 * 10.  update — CONFLICT cuando estado != borrador (inmutabilidad)
 * 10b. update — permite mutación cuando estado == borrador (HE-06: trigger condicional)
 * 11.  firmar — CONFLICT cuando estado no es borrador
 * 12.  firmar — PRECONDITION_FAILED cuando procedimiento_realizado está vacío
 * 13.  validar — CONFLICT cuando estado no es firmado
 * 14.  anular — CONFLICT cuando estado es firmado
 * 15.  anular — CONFLICT cuando estado es validado
 *
 * @QA E2E pendiente (HE-06 — validación trigger BD real):
 *   - UPDATE en estado borrador → debe pasar sin error 2F003 (trigger condicional).
 *   - UPDATE en estado firmado  → debe lanzar ERRCODE 2F003 del trigger Postgres.
 *   - DELETE en estado validado → debe lanzar ERRCODE 2F003 del trigger Postgres.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceActoQuirurgicoRouter } from "../acto-quirurgico.router";
import {
  estadoActoQxSchema,
  actoQxCreateSchema,
  actoQxFirmarSchema,
  ayudanteSchema,
} from "../acto-quirurgico.schemas";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mock outbox ──────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-mock-id" }),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const AQ_ID         = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INSTANCIA_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EPISODIO_ID   = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PACIENTE_ID   = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const CIRUJANO_ID   = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const PERSONAL_ID   = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const ESTADO_ID     = "11111111-1111-1111-1111-111111111111";
const USER_ID       = "22222222-2222-2222-2222-222222222222";
const TIPO_DOC_ID   = "33333333-3333-3333-3333-333333333333";
const ESTADO_INI_ID = "44444444-4444-4444-4444-444444444444";

const ESP_TENANT  = { ...MOCK_TENANT, roleCodes: ["ESP"], establishmentId: "estab-01" };
const DIR_TENANT  = { ...MOCK_TENANT, roleCodes: ["DIR"], establishmentId: "estab-01" };
const ESP_USER    = { id: USER_ID, email: "esp@his.test", name: "Dr. Cirujano" };

const AQ_ROW_BORRADOR = {
  id: AQ_ID,
  instancia_id: INSTANCIA_ID,
  episodio_id: EPISODIO_ID,
  diagnostico_pre: "Hernia inguinal derecha",
  diagnostico_post: null,
  procedimiento_realizado: "Herniorrafia inguinal",
  hallazgos: null,
  hora_inicio: new Date("2026-05-17T08:00:00Z"),
  hora_fin: new Date("2026-05-17T10:00:00Z"),
  cirujano_id: CIRUJANO_ID,
  anestesiologo_id: null,
  valoracion_preop: null,
  checklist_cirugia_segura: null,
  ayudantes: [],
  registro_anestesico: null,
  recuperacion_urpa: null,
  registrado_en: new Date("2026-05-17T07:00:00Z"),
  estado_registro: "vigente",
  estado_codigo: "borrador",
  estado_id: ESTADO_ID,
};

const AQ_ROW_FIRMADO   = { ...AQ_ROW_BORRADOR, estado_codigo: "firmado" };
const AQ_ROW_VALIDADO  = { ...AQ_ROW_BORRADOR, estado_codigo: "validado" };
const AQ_ROW_SIN_PROCED = { ...AQ_ROW_BORRADOR, procedimiento_realizado: null };

// ─── Helper ───────────────────────────────────────────────────────────────────

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRaw.mockResolvedValue(0 as never);
  return prisma;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("eceActoQuirurgicoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  // 1 — estadoActoQxSchema
  it("estadoActoQxSchema rechaza estado inválido", () => {
    expect(estadoActoQxSchema.safeParse("en_proceso").success).toBe(false);
    expect(estadoActoQxSchema.safeParse("borrador").success).toBe(true);
    expect(estadoActoQxSchema.safeParse("validado").success).toBe(true);
  });

  // 2 — actoQxCreateSchema requiere campos obligatorios
  it("actoQxCreateSchema falla sin campos requeridos", () => {
    const result = actoQxCreateSchema.safeParse({
      episodioId: EPISODIO_ID,
      // sin cirujanoId ni procedimientoRealizado ni diagnosticoPre
    });
    expect(result.success).toBe(false);
  });

  it("actoQxCreateSchema acepta input mínimo válido", () => {
    const result = actoQxCreateSchema.safeParse({
      episodioId: EPISODIO_ID,
      cirujanoId: CIRUJANO_ID,
      diagnosticoPre: "Hernia inguinal",
      procedimientoRealizado: "Herniorrafia",
    });
    expect(result.success).toBe(true);
  });

  // 3 — actoQxFirmarSchema
  it("actoQxFirmarSchema rechaza PIN con menos de 6 dígitos", () => {
    expect(actoQxFirmarSchema.safeParse({ id: AQ_ID, pin: "123" }).success).toBe(false);
    expect(actoQxFirmarSchema.safeParse({ id: AQ_ID, pin: "1234abc" }).success).toBe(false);
  });

  it("actoQxFirmarSchema acepta PIN de 6-8 dígitos", () => {
    expect(actoQxFirmarSchema.safeParse({ id: AQ_ID, pin: "123456" }).success).toBe(true);
    expect(actoQxFirmarSchema.safeParse({ id: AQ_ID, pin: "12345678" }).success).toBe(true);
  });

  // 4 — ayudanteSchema
  it("ayudanteSchema rechaza rol inválido", () => {
    expect(ayudanteSchema.safeParse({ personalId: PERSONAL_ID, rol: "operador" }).success).toBe(false);
  });

  it("ayudanteSchema acepta rol válido", () => {
    expect(ayudanteSchema.safeParse({ personalId: PERSONAL_ID, rol: "instrumentista" }).success).toBe(true);
  });

  // 5 — list
  it("list devuelve items y nextCursor nulo cuando hay menos items que limit", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([AQ_ROW_BORRADOR] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: ESP_TENANT, user: ESP_USER }),
    );

    const result = await caller.list({ limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  // 6 — get NOT_FOUND
  it("get lanza NOT_FOUND cuando acto no existe", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: ESP_TENANT, user: ESP_USER }),
    );

    await expect(caller.get({ id: AQ_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 7 — get existente
  it("get devuelve el acto quirúrgico existente", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([AQ_ROW_BORRADOR] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: ESP_TENANT, user: ESP_USER }),
    );

    const result = await caller.get({ id: AQ_ID });
    expect(result.id).toBe(AQ_ID);
    expect(result.estado_codigo).toBe("borrador");
  });

  // 8 — create NOT_FOUND episodio
  it("create lanza NOT_FOUND cuando el tipo documento ACT_QX está configurado pero el episodio no existe", async () => {
    // Primera query: tipo doc encontrado; segunda: episodio no encontrado
    prisma.$queryRaw
      .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID }] as never)
      .mockResolvedValueOnce([] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: ESP_TENANT, user: ESP_USER }),
    );

    await expect(
      caller.create({
        episodioId: EPISODIO_ID,
        cirujanoId: CIRUJANO_ID,
        diagnosticoPre: "Hernia",
        procedimientoRealizado: "Herniorrafia",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 9 — create PRECONDITION_FAILED tipo doc no configurado
  it("create lanza PRECONDITION_FAILED cuando ACT_QX no está en catálogo", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: ESP_TENANT, user: ESP_USER }),
    );

    await expect(
      caller.create({
        episodioId: EPISODIO_ID,
        cirujanoId: CIRUJANO_ID,
        diagnosticoPre: "Hernia",
        procedimientoRealizado: "Herniorrafia",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  // 10 — update CONFLICT post-firma
  it("update lanza CONFLICT cuando el acto no está en borrador", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([AQ_ROW_FIRMADO] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: ESP_TENANT, user: ESP_USER }),
    );

    await expect(
      caller.update({ id: AQ_ID, diagnosticoPre: "Nuevo diagnóstico" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // 10b — update en borrador permite mutación (HE-06: trigger condicional post-firma)
  it("update permite mutación cuando el acto está en borrador", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([AQ_ROW_BORRADOR] as never);
    prisma.$executeRaw.mockResolvedValueOnce(1 as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: ESP_TENANT, user: ESP_USER }),
    );

    const result = await caller.update({ id: AQ_ID, diagnosticoPre: "Hernia bilateral" });
    expect(result.ok).toBe(true);
    // $executeRaw fue invocado: el UPDATE llegó a la BD (trigger condicional lo permite)
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
  });

  // 11 — firmar CONFLICT estado no borrador
  it("firmar lanza CONFLICT cuando el acto no está en borrador", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([AQ_ROW_FIRMADO] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: ESP_TENANT, user: ESP_USER }),
    );

    await expect(
      caller.firmar({ id: AQ_ID, pin: "123456" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // 12 — firmar PRECONDITION_FAILED sin procedimiento
  it("firmar lanza PRECONDITION_FAILED cuando procedimiento_realizado está vacío", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([AQ_ROW_SIN_PROCED] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: ESP_TENANT, user: ESP_USER }),
    );

    await expect(
      caller.firmar({ id: AQ_ID, pin: "123456" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  // 13 — validar CONFLICT estado no firmado
  it("validar lanza CONFLICT cuando el acto no está firmado", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([AQ_ROW_BORRADOR] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: DIR_TENANT, user: ESP_USER }),
    );

    await expect(
      caller.validar({ id: AQ_ID }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // 14 — anular CONFLICT estado firmado
  it("anular lanza CONFLICT cuando el acto está firmado", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([AQ_ROW_FIRMADO] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: DIR_TENANT, user: ESP_USER }),
    );

    await expect(
      caller.anular({ id: AQ_ID, motivo: "Error de registro" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // 15 — anular CONFLICT estado validado
  it("anular lanza CONFLICT cuando el acto está validado", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([AQ_ROW_VALIDADO] as never);

    const caller = eceActoQuirurgicoRouter.createCaller(
      makeCtx({ prisma, tenant: DIR_TENANT, user: ESP_USER }),
    );

    await expect(
      caller.anular({ id: AQ_ID, motivo: "No válido" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
