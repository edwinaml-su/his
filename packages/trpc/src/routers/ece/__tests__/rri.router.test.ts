/**
 * Tests del eceRriRouter (NTEC Doc 10 — RRI).
 *
 * Cubre:
 *   1. schema: tipoRriSchema rechaza tipo inválido
 *   2. schema: eceRriCreateSchema acepta los 3 tipos válidos
 *   3. schema: urgenciaRriSchema valida los 3 valores
 *   4. list — happy path devuelve items y nextCursor nulo
 *   5. get  — NOT_FOUND cuando RRI no existe
 *   6. get  — devuelve RRI existente
 *   7. create — NOT_FOUND cuando episodio no existe
 *   8. firmar — CONFLICT cuando estado no es firmable
 *   9. responder — CONFLICT cuando estado no es firmado
 *  10. anular — CONFLICT cuando estado es validado
 *  11. anular — happy path (rol DIR)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceRriRouter } from "../rri.router";
import { tipoRriSchema, urgenciaRriSchema, eceRriCreateSchema } from "../rri.schemas";
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
const SERVICIO_ID  = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const PERSONAL_ID  = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const ESTADO_ID    = "11111111-1111-1111-1111-111111111111";
const USER_ID      = "22222222-2222-2222-2222-222222222222";

const MC_TENANT = { ...MOCK_TENANT, roleCodes: ["MC"], establishmentId: "estab-id-1" };
const DIR_TENANT = { ...MOCK_TENANT, roleCodes: ["DIR"], establishmentId: "estab-id-1" };
const MC_USER = { id: USER_ID, email: "mc@his.test", name: "Dr. Test" };

const RRI_ROW_BORRADOR = {
  id: RRI_ID,
  instancia_id: INSTANCIA_ID,
  paciente_id: PACIENTE_ID,
  episodio_id: EPISODIO_ID,
  tipo: "referencia",
  destino_servicio_id: SERVICIO_ID,
  motivo: "Evaluación especialista",
  datos_clinicos_relevantes: "HTA controlada",
  urgencia: "rutinaria",
  solicitado_por: PERSONAL_ID,
  respondido_por: null,
  respuesta: null,
  diagnostico_ic: null,
  plan_ic: null,
  fecha_solicitud: new Date("2026-05-17T10:00:00Z"),
  fecha_respuesta: null,
  estado_codigo: "borrador",
  estado_id: ESTADO_ID,
};

const RRI_ROW_FIRMADO = { ...RRI_ROW_BORRADOR, estado_codigo: "firmado" };
const RRI_ROW_VALIDADO = { ...RRI_ROW_BORRADOR, estado_codigo: "validado" };
const RRI_ROW_ANULADO = { ...RRI_ROW_BORRADOR, estado_codigo: "anulado" };

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

  // 1 — Schemas Zod
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

  // 2 — eceRriCreateSchema acepta los 3 tipos
  it("eceRriCreateSchema acepta todos los tipos válidos", () => {
    const base = {
      episodioId: EPISODIO_ID,
      tipo: "referencia" as const,
      destinoServicioId: SERVICIO_ID,
      motivo: "Motivo de prueba",
      datosClinicosRelevantes: "Datos clínicos",
      urgencia: "rutinaria" as const,
    };
    expect(eceRriCreateSchema.safeParse(base).success).toBe(true);
    expect(eceRriCreateSchema.safeParse({ ...base, tipo: "retorno" }).success).toBe(true);
    expect(eceRriCreateSchema.safeParse({ ...base, tipo: "interconsulta" }).success).toBe(true);
  });

  // 3 — urgenciaRriSchema
  it("urgenciaRriSchema rechaza urgencia inválida", () => {
    expect(urgenciaRriSchema.safeParse("alta").success).toBe(false);
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

  // 6 — get existente
  it("get devuelve RRI existente", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([RRI_ROW_BORRADOR] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: MC_USER }),
    );

    const result = await caller.get({ id: RRI_ID });
    expect(result.id).toBe(RRI_ID);
    expect(result.tipo).toBe("referencia");
  });

  // 7 — create NOT_FOUND episodio
  it("create lanza NOT_FOUND cuando episodio no existe", async () => {
    // tipo_documento RRI existe
    prisma.$queryRaw.mockResolvedValueOnce([
      { tipo_doc_id: "tipo-id", estado_inicial_id: ESTADO_ID },
    ] as never);
    // episodio no existe
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: MC_USER }),
    );

    await expect(
      caller.create({
        episodioId: EPISODIO_ID,
        tipo: "referencia",
        destinoServicioId: SERVICIO_ID,
        motivo: "Test",
        datosClinicosRelevantes: "Datos",
        urgencia: "rutinaria",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 8 — firmar CONFLICT estado incorrecto
  it("firmar lanza CONFLICT cuando estado no es firmable", async () => {
    // findRri devuelve estado firmado (ya no se puede refirmar)
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
        respuesta: "Respuesta IC",
        diagnostico: "CIE-10 test",
        plan: "Plan de seguimiento",
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
    // avanzarEstado: flujo_transicion
    prisma.$queryRaw.mockResolvedValueOnce([
      { estado_destino_id: "nuevo-estado-id" },
    ] as never);
    // historial insert (via $queryRaw en el historial)
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = eceRriRouter.createCaller(
      makeCtx({ prisma, tenant: DIR_TENANT, user: MC_USER }),
    );

    const result = await caller.anular({ rriId: RRI_ID, motivo: "Prueba anulación" });
    expect(result.ok).toBe(true);
    expect(result.anuladoEn).toBeDefined();
  });
});
