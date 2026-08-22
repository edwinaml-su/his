/**
 * Tests del bridgeEncounterRouter — aislamiento multi-tenant (R02).
 *
 * Contexto del hallazgo
 * ---------------------
 * Este router mezcla Prisma sobre public."Encounter" (que sí lleva
 * organizationId en el `where`) con SQL crudo sobre ece.episodio_atencion y
 * ece.paciente. Las consultas crudas NO tenían ningún filtro de ámbito:
 *
 *   - findEpisodio()  → `WHERE id = $1`, sin más.
 *   - unlinkEncounter → `UPDATE ece.episodio_atencion ... WHERE id = $1`.
 *   - linkEncounter   → idem, sobre el episodio recibido del cliente.
 *   - createEpisodioFromEncounter → insertaba con el `establecimientoEceId`
 *     que mandaba el cliente, sin validarlo.
 *   - listEncountersWithoutEpisodio → leía los public_encounter_id de TODAS
 *     las organizaciones.
 *
 * Como ece.* corre con el rol Supabase (BYPASSRLS) y estas consultas no pasan
 * por `withTenantContext`, no había ningún control: bastaba conocer un uuid de
 * episodio ajeno para leerlo y, en link/unlink, para ESCRIBIRLO.
 *
 * El ámbito se resuelve por ece.paciente.establecimiento_id, que es FK a
 * public."Establishment"(id) — el mismo espacio de ids que
 * `ctx.tenant.establishmentId`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { bridgeEncounterRouter } from "../bridge-encounter.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_TENANT_NO_ESTABLISHMENT } from "@his/test-utils";

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-mock-id" }),
  };
});

const USER = { id: "22222222-2222-2222-2222-222222222222", email: "mc@his.test", name: "Dr. Bridge" };
const TENANT = { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] };
const ESTAB = MOCK_TENANT.establishmentId!;

const ENCOUNTER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EPISODIO_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PATIENT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ESTAB_ECE_AJENO = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    return cb;
  });
  prisma.$executeRaw.mockResolvedValue(0 as never);
  prisma.$queryRaw.mockResolvedValue([] as never);
  return prisma;
}

/** Devuelve [sqlAplanado, ...valores] de cada llamada cruda. */
function llamadas(
  mockFn: { mock: { calls: unknown[][] } },
): Array<{ sql: string; valores: unknown[] }> {
  return mockFn.mock.calls.map((c) => ({
    sql: Array.isArray(c[0]) ? (c[0] as string[]).join(" ? ") : String(c[0]),
    valores: c.slice(1),
  }));
}

describe("bridgeEncounterRouter — aislamiento de tenant (R02)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  it("unlinkEncounter no alcanza un episodio de otro establecimiento", async () => {
    // findEpisodio ahora filtra por establecimiento → 0 filas para uno ajeno.
    prisma.$queryRaw.mockResolvedValue([] as never);

    const caller = bridgeEncounterRouter.createCaller(
      makeCtx({ prisma, tenant: TENANT, user: USER }),
    );

    await expect(caller.unlinkEncounter({ episodioId: EPISODIO_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // Y sobre todo: no debe haberse emitido ningún UPDATE.
    expect(
      llamadas(prisma.$executeRaw).some((l) => /UPDATE\s+ece\.episodio_atencion/i.test(l.sql)),
    ).toBe(false);
  });

  it("unlinkEncounter acota la lectura del episodio al establecimiento activo", async () => {
    prisma.$queryRaw.mockResolvedValue([] as never);

    const caller = bridgeEncounterRouter.createCaller(
      makeCtx({ prisma, tenant: TENANT, user: USER }),
    );
    await expect(caller.unlinkEncounter({ episodioId: EPISODIO_ID })).rejects.toThrow();

    const lectura = llamadas(prisma.$queryRaw).find((l) =>
      /FROM\s+ece\.episodio_atencion/i.test(l.sql),
    );
    expect(lectura).toBeDefined();
    expect(lectura!.sql).toMatch(/ece\.paciente/);
    expect(lectura!.sql).toMatch(/establecimiento_id/);
    expect(lectura!.valores).toContain(ESTAB);
  });

  it("unlinkEncounter acota también el UPDATE, no sólo la lectura previa", async () => {
    // El episodio existe y está vinculado → se llega al UPDATE.
    prisma.$queryRaw.mockResolvedValue([
      {
        id: EPISODIO_ID,
        public_encounter_id: ENCOUNTER_ID,
        paciente_id: PATIENT_ID,
        establecimiento_id: ESTAB,
        estado: "abierto",
      },
    ] as never);

    const caller = bridgeEncounterRouter.createCaller(
      makeCtx({ prisma, tenant: TENANT, user: USER }),
    );
    await caller.unlinkEncounter({ episodioId: EPISODIO_ID });

    const update = llamadas(prisma.$executeRaw).find((l) =>
      /UPDATE\s+ece\.episodio_atencion/i.test(l.sql),
    );
    expect(update).toBeDefined();
    // Un TOCTOU entre el SELECT y el UPDATE no debe bastar: el propio UPDATE
    // lleva el predicado de establecimiento.
    expect(update!.sql).toMatch(/ece\.paciente/);
    expect(update!.valores).toContain(ESTAB);
  });

  it("linkEncounter acota el UPDATE al establecimiento activo", async () => {
    prisma.encounter.findFirst.mockResolvedValue({
      id: ENCOUNTER_ID,
      patientId: PATIENT_ID,
      admittedAt: new Date("2026-08-01T10:00:00Z"),
      organizationId: TENANT.organizationId,
    } as never);
    prisma.$queryRaw.mockResolvedValue([
      {
        id: EPISODIO_ID,
        public_encounter_id: null,
        paciente_id: PATIENT_ID,
        establecimiento_id: ESTAB,
        estado: "abierto",
      },
    ] as never);

    const caller = bridgeEncounterRouter.createCaller(
      makeCtx({ prisma, tenant: TENANT, user: USER }),
    );
    await caller.linkEncounter({ encounterId: ENCOUNTER_ID, episodioId: EPISODIO_ID });

    const update = llamadas(prisma.$executeRaw).find((l) =>
      /UPDATE\s+ece\.episodio_atencion/i.test(l.sql),
    );
    expect(update).toBeDefined();
    expect(update!.sql).toMatch(/ece\.paciente/);
    expect(update!.valores).toContain(ESTAB);
  });

  it("createEpisodioFromEncounter rechaza un establecimiento ECE que no es de la sede activa", async () => {
    prisma.encounter.findFirst.mockResolvedValue({
      id: ENCOUNTER_ID,
      patientId: PATIENT_ID,
      admittedAt: new Date("2026-08-01T10:00:00Z"),
      organizationId: TENANT.organizationId,
    } as never);
    // La validación del establecimiento no encuentra la fila puente → FORBIDDEN.
    prisma.$queryRaw.mockResolvedValue([] as never);

    const caller = bridgeEncounterRouter.createCaller(
      makeCtx({ prisma, tenant: TENANT, user: USER }),
    );

    await expect(
      caller.createEpisodioFromEncounter({
        encounterId: ENCOUNTER_ID,
        modalidad: "ambulatorio",
        servicio_categoria: "consulta_externa",
        establecimientoEceId: ESTAB_ECE_AJENO,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // No debe haberse insertado nada.
    expect(
      llamadas(prisma.$queryRaw).some((l) => /INSERT\s+INTO\s+ece\.episodio_atencion/i.test(l.sql)),
    ).toBe(false);
  });

  it("createEpisodioFromEncounter valida el establecimiento contra la columna puente", async () => {
    prisma.encounter.findFirst.mockResolvedValue({
      id: ENCOUNTER_ID,
      patientId: PATIENT_ID,
      admittedAt: new Date("2026-08-01T10:00:00Z"),
      organizationId: TENANT.organizationId,
    } as never);
    prisma.$queryRaw.mockResolvedValue([] as never);

    const caller = bridgeEncounterRouter.createCaller(
      makeCtx({ prisma, tenant: TENANT, user: USER }),
    );
    await expect(
      caller.createEpisodioFromEncounter({
        encounterId: ENCOUNTER_ID,
        modalidad: "ambulatorio",
        servicio_categoria: "consulta_externa",
        establecimientoEceId: ESTAB_ECE_AJENO,
      }),
    ).rejects.toThrow();

    const check = llamadas(prisma.$queryRaw).find((l) => /FROM\s+ece\.establecimiento/i.test(l.sql));
    expect(check).toBeDefined();
    expect(check!.sql).toMatch(/establishment_id/);
    expect(check!.valores).toContain(ESTAB_ECE_AJENO);
    expect(check!.valores).toContain(ESTAB);
  });

  it("listEncountersWithoutEpisodio no lee episodios de otras organizaciones", async () => {
    prisma.$queryRaw.mockResolvedValue([] as never);
    prisma.encounter.findMany.mockResolvedValue([] as never);
    prisma.encounter.count.mockResolvedValue(0 as never);

    const caller = bridgeEncounterRouter.createCaller(
      makeCtx({ prisma, tenant: TENANT, user: USER }),
    );
    await caller.listEncountersWithoutEpisodio({ page: 1, pageSize: 20 });

    const sub = llamadas(prisma.$queryRaw).find((l) =>
      /FROM\s+ece\.episodio_atencion/i.test(l.sql),
    );
    expect(sub).toBeDefined();
    expect(sub!.sql).toMatch(/ece\.paciente/);
    expect(sub!.valores).toContain(ESTAB);
  });

  it("sin establecimiento activo el bridge falla en vez de operar sin ámbito", async () => {
    const caller = bridgeEncounterRouter.createCaller(
      makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT_NO_ESTABLISHMENT, roleCodes: ["PHYSICIAN"] },
        user: USER,
      }),
    );

    await expect(caller.unlinkEncounter({ episodioId: EPISODIO_ID })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(
      llamadas(prisma.$executeRaw).some((l) => /UPDATE\s+ece\.episodio_atencion/i.test(l.sql)),
    ).toBe(false);
  });
});
