/**
 * Tests del eceRriRouter (NTEC Doc 10 — RRI).
 *
 * Cubre:
 *   1. schema: tipoRriSchema rechaza tipo inválido
 *   2. schema: eceRriCreateSchema acepta los 3 tipos válidos
 *   3. schema: eceRriCreateSchema requiere establecimientoDestinoId y resumenClinico (HD-25)
 *   4. list — happy path devuelve items y nextCursor nulo
 *   5. get  — NOT_FOUND cuando RRI no existe
 *   6. get  — devuelve RRI existente con columnas correctas (HD-25)
 *   7. create — NOT_FOUND cuando episodio no existe
 *   8. firmar — CONFLICT cuando estado no es firmable
 *   9. responder — CONFLICT cuando estado no es firmado
 *  10. anular — CONFLICT cuando estado es validado
 *  11. anular — happy path (rol DIR)
 *  12. schema: eceRriResponderSchema usa respuestaInterconsultante (HD-25)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceRriRouter } from "../rri.router";
import { tipoRriSchema, eceRriCreateSchema, eceRriResponderSchema } from "../rri.schemas";
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

const RRI_ID       = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INSTANCIA_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EPISODIO_ID  = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PACIENTE_ID  = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ESTAB_ID     = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const PERSONAL_ID  = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const ESTADO_ID    = "11111111-1111-1111-1111-111111111111";
const USER_ID      = "22222222-2222-2222-2222-222222222222";

const MC_TENANT  = { ...MOCK_TENANT, roleCodes: ["MC"],  establishmentId: "estab-id-1" };
const DIR_TENANT = { ...MOCK_TENANT, roleCodes: ["DIR"], establishmentId: "estab-id-1" };
const MC_USER    = { id: USER_ID, email: "mc@his.test", name: "Dr. Test" };

/** Fixture con nombres de columnas reales de ece.rri (HD-25) */
const RRI_ROW_BORRADOR = {
  id: RRI_ID,
  instancia_id: INSTANCIA_ID,
  paciente_id: PACIENTE_ID,
  episodio_id: EPISODIO_ID,
  tipo: "referencia",
  establecimiento_destino_id: ESTAB_ID,
  motivo: "Evaluación especialista",
  resumen_clinico: "HTA controlada",
  especialidad_solicitada: null,
  solicitado_por: PERSONAL_ID,
  respondido_por: null,
  respuesta_interconsultante: null,
  registrado_en: new Date("2026-05-17T10:00:00Z"),
  estado_codigo: "borrador",
  estado_id: ESTADO_ID,
};

const RRI_ROW_FIRMADO  = { ...RRI_ROW_BORRADOR, estado_codigo: "firmado" };
const RRI_ROW_VALIDADO = { ...RRI_ROW_BORRADOR, estado_codigo: "validado" };

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

describe("eceRriRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  // 1 — tipoRriSchema
  describe("tipoRriSchema", () => {
    it("rechaza tipo inválido", () => {
      expect(tipoRriSchema.safeParse("consulta").success).toBe(false);
    });

    it.each(["referencia", "retorno", "interconsulta"] as const)(
      "acepta tipo='%s'",
      (tipo) => {
        expect(tipoRriSchema.safeParse(tipo).success).toBe(true);
      },
    );
  });

  // 2 — eceRriCreateSchema acepta tipos válidos con campos correctos (HD-25)
  it("eceRriCreateSchema acepta todos los tipos válidos con columnas correctas", () => {
    const base = {
      episodioId: EPISODIO_ID,
      tipo: "referencia" as const,
      establecimientoDestinoId: ESTAB_ID,
      motivo: "Motivo de prueba",
      resumenClinico: "Resumen clínico",
    };
    expect(eceRriCreateSchema.safeParse(base).success).toBe(true);
    expect(eceRriCreateSchema.safeParse({ ...base, tipo: "retorno" }).success).toBe(true);
    expect(eceRriCreateSchema.safeParse({ ...base, tipo: "interconsulta" }).success).toBe(true);
  });

  // 3 — eceRriCreateSchema rechaza nombres legacy
  it("eceRriCreateSchema rechaza campos con nombres legacy (destinoServicioId, datosClinicosRelevantes)", () => {
    const legacy = {
      episodioId: EPISODIO_ID,
      tipo: "referencia" as const,
      destinoServicioId: ESTAB_ID,          // nombre antiguo
      motivo: "Test",
      datosClinicosRelevantes: "Datos",     // nombre antiguo
      urgencia: "rutinaria",               // campo eliminado
    };
    // El schema no tiene esos campos; los extras son ignorados pero los requeridos faltan
    const result = eceRriCreateSchema.safeParse(legacy);
    expect(result.success).toBe(false);
  });

  // 4 — list happy path
  it("list devuelve items y nextCursor nulo cuando hay menos items que limit", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([RRI_ROW_BORRADOR] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: MC_USER }),
    );

    const result = await caller.list({ limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  // 5 — get NOT_FOUND
  it("get lanza NOT_FOUND cuando RRI no existe", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: MC_USER }),
    );

    await expect(caller.get({ id: RRI_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 6 — get existente con campos correctos (HD-25)
  it("get devuelve RRI existente con columnas reales de BD", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([RRI_ROW_BORRADOR] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: MC_USER }),
    );

    const result = await caller.get({ id: RRI_ID });
    expect(result.id).toBe(RRI_ID);
    expect(result.tipo).toBe("referencia");
    // Verificar que el tipo de retorno usa nombres de columnas correctos
    expect(result.establecimiento_destino_id).toBe(ESTAB_ID);
    expect(result.resumen_clinico).toBe("HTA controlada");
    expect(result.respuesta_interconsultante).toBeNull();
  });

  // 7 — create NOT_FOUND episodio
  it("create lanza NOT_FOUND cuando episodio no existe", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { tipo_doc_id: "tipo-id", estado_inicial_id: ESTADO_ID },
    ] as never);
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: MC_USER }),
    );

    await expect(
      caller.create({
        episodioId: EPISODIO_ID,
        tipo: "referencia",
        establecimientoDestinoId: ESTAB_ID,
        motivo: "Test",
        resumenClinico: "Resumen",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 8 — firmar CONFLICT estado incorrecto
  it("firmar lanza CONFLICT cuando estado no es firmable", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([RRI_ROW_FIRMADO] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: MC_USER }),
    );

    await expect(
      caller.firmar({ rriId: RRI_ID, pin: "123456" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // 9 — responder CONFLICT estado incorrecto
  it("responder lanza CONFLICT cuando estado no es firmado", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([RRI_ROW_BORRADOR] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: MC_USER }),
    );

    await expect(
      caller.responder({
        rriId: RRI_ID,
        respuestaInterconsultante: "Respuesta IC con diagnóstico K35.2 y plan de seguimiento.",
        pin: "123456",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // 10 — anular CONFLICT estado validado
  it("anular lanza CONFLICT cuando RRI ya está validada", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([RRI_ROW_VALIDADO] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: DIR_TENANT, user: MC_USER }),
    );

    await expect(
      caller.anular({ rriId: RRI_ID, motivo: "Error administrativo" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // 11 — anular happy path
  it("anular happy path avanza estado cuando RRI está en borrador", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([RRI_ROW_BORRADOR] as never);
    prisma.$queryRaw.mockResolvedValueOnce([
      { estado_destino_id: "nuevo-estado-id" },
    ] as never);
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: DIR_TENANT, user: MC_USER }),
    );

    const result = await caller.anular({ rriId: RRI_ID, motivo: "Prueba anulación" });
    expect(result.ok).toBe(true);
    expect(result.anuladoEn).toBeDefined();
  });

  // 12 — eceRriResponderSchema usa respuestaInterconsultante (HD-25)
  it("eceRriResponderSchema acepta respuestaInterconsultante y rechaza respuesta legacy", () => {
    const correcto = {
      rriId: RRI_ID,
      respuestaInterconsultante: "Diagnóstico K35.2, plan: cirugía en 48h.",
      pin: "123456",
    };
    expect(eceRriResponderSchema.safeParse(correcto).success).toBe(true);

    // Nombre antiguo no satisface el schema (falta respuestaInterconsultante)
    const legacy = { rriId: RRI_ID, respuesta: "Respuesta", diagnostico: "K35", plan: "Cirugía", pin: "123456" };
    expect(eceRriResponderSchema.safeParse(legacy).success).toBe(false);
  });
});
