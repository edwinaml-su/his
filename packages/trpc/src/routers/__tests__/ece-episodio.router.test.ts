/**
 * Tests unitarios del router ece.episodio (Fase 2 — ECE, Stream episodio).
 *
 * Estrategia:
 *   - withWorkflowContext se mockea para ejecutar el callback con el prisma mock.
 *   - emitDomainEvent se mockea para verificar payload sin tocar Prisma real.
 *   - ctx.prisma.$queryRaw y $executeRaw son vi.fn() controlados por test.
 *
 * Cobertura (10 casos):
 *   1. listAmbulatorios — retorna items paginados
 *   2. get — happy path
 *   3. get — NOT_FOUND
 *   4. crearAmbulatorio — happy path + emite outbox
 *   5. crearHospitalario — happy path + emite outbox
 *   6. transicionar — abierto → en_curso (sin emit)
 *   7. transicionar — en_curso → cerrado (emite ece.episodio.cerrado)
 *   8. transicionar — cancelado → en_curso bloqueado (CONFLICT)
 *   9. transicionar — transición inválida (abierto → cerrado)
 *  10. asignarCama — bloquea doble asignación activa (CONFLICT)
 *  11. liberarCama — NOT_FOUND cuando asignación no existe o ya libre
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { eceEpisodioRouter } from "../ece/episodio.router";
import { MOCK_USER_ADMIN } from "@his/test-utils";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../ece/workflow-context", () => ({
  withWorkflowContext: vi.fn(
    async (
      _prisma: unknown,
      _estabId: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => fn(_prisma),
  ),
}));

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "event-id" }),
  };
});

import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EPISODIO_ID   = "aaaaaaaa-0000-0000-0000-000000000001";
const EPISODIO_HOSP = "aaaaaaaa-0000-0000-0000-000000000002";
const PACIENTE_ID   = "bbbbbbbb-0000-0000-0000-000000000001";
const ASIGNACION_ID = "cccccccc-0000-0000-0000-000000000001";
const CAMA_ID       = "dddddddd-0000-0000-0000-000000000001";
const SALA_ID       = "eeeeeeee-0000-0000-0000-000000000001";
const ORDEN_ID      = "ffffffff-0000-0000-0000-000000000001";

const TENANT = {
  userId: MOCK_USER_ADMIN.id,
  organizationId: "00000000-0000-0000-0000-000000000099",
  countryId: "00000000-0000-0000-0000-0000000000bb",
  establishmentId: "00000000-0000-0000-0000-0000000000cc",
  roleCodes: ["PHYSICIAN", "NURSE", "ADM"],
};

const EPISODIO_ROW = {
  id: EPISODIO_ID,
  paciente_id: PACIENTE_ID,
  tipo: "ambulatorio",
  estado: "abierto",
  motivo: "cefalea",
  encounter_id: null,
  establecimiento_id: TENANT.establishmentId,
  creado_por: MOCK_USER_ADMIN.id,
  creado_en: new Date("2026-05-17T08:00:00Z"),
  actualizado_en: new Date("2026-05-17T08:00:00Z"),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma(queryRawValues: unknown[] = []) {
  let callCount = 0;
  const $queryRaw = vi.fn().mockImplementation(() => {
    const val = queryRawValues[callCount] ?? [];
    callCount++;
    return Promise.resolve(val);
  });
  const $executeRaw = vi.fn().mockResolvedValue(1);
  const $executeRawUnsafe = vi.fn().mockResolvedValue(0);
  const prisma = {
    $queryRaw,
    $executeRaw,
    $executeRawUnsafe,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
  return prisma;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(prisma: any) {
  return {
    prisma,
    user: MOCK_USER_ADMIN,
    tenant: TENANT,
    portalAccount: null,
    ip: "127.0.0.1",
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("eceEpisodioRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. listAmbulatorios ────────────────────────────────────────────────────

  it("listAmbulatorios retorna items paginados", async () => {
    const prisma = makePrisma([[EPISODIO_ROW]]);
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    const result = await caller.listAmbulatorios({ limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(EPISODIO_ID);
    expect(result.nextCursor).toBeNull();
  });

  // ─── 2. get — happy path ────────────────────────────────────────────────────

  it("get retorna el episodio cuando existe", async () => {
    const prisma = makePrisma([[EPISODIO_ROW]]);
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    const result = await caller.get({ id: EPISODIO_ID });

    expect(result.id).toBe(EPISODIO_ID);
    expect(result.estado).toBe("abierto");
  });

  // ─── 3. get — NOT_FOUND ─────────────────────────────────────────────────────

  it("get lanza NOT_FOUND cuando no existe el episodio", async () => {
    const prisma = makePrisma([[]]); // sin filas
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    await expect(caller.get({ id: EPISODIO_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // ─── 4. crearAmbulatorio ────────────────────────────────────────────────────

  it("crearAmbulatorio crea el episodio y emite outbox abierto", async () => {
    const prisma = makePrisma([[{ id: EPISODIO_ID }]]);
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    const result = await caller.crearAmbulatorio({
      pacienteId: PACIENTE_ID,
      motivoConsulta: "cefalea intensa",
    });

    expect(result.id).toBe(EPISODIO_ID);
    expect(emitDomainEvent).toHaveBeenCalledOnce();
    const [, payload] = (emitDomainEvent as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, { eventType: string }];
    expect(payload.eventType).toBe("ece.episodio.abierto");
  });

  // ─── 5. crearHospitalario ───────────────────────────────────────────────────

  it("crearHospitalario crea episodio+hospitalario+cama y emite outbox abierto", async () => {
    // queries en orden: INSERT atencion → INSERT hospitalario → (executeRaw asig cama)
    const prisma = makePrisma([[{ id: EPISODIO_ID }], [{ id: EPISODIO_HOSP }]]);
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    const result = await caller.crearHospitalario({
      pacienteId: PACIENTE_ID,
      ordenIngresoId: ORDEN_ID,
      camaId: CAMA_ID,
      salaId: SALA_ID,
      motivoIngreso: "fractura de cadera",
    });

    expect(result.episodioId).toBe(EPISODIO_ID);
    expect(result.episodioHospId).toBe(EPISODIO_HOSP);
    expect(emitDomainEvent).toHaveBeenCalledOnce();
    const [, payload] = (emitDomainEvent as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, { eventType: string; payload: { tipo: string } }];
    expect(payload.eventType).toBe("ece.episodio.abierto");
    expect(payload.payload.tipo).toBe("hospitalario");
  });

  // ─── 6. transicionar abierto → en_curso (sin emit) ─────────────────────────

  it("transicionar abierto→en_curso retorna ok y NO emite ece.episodio.cerrado", async () => {
    const prisma = makePrisma([[{ id: EPISODIO_ID, estado: "abierto" }]]);
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    const result = await caller.transicionar({
      episodioId: EPISODIO_ID,
      nuevoEstado: "en_curso",
    });

    expect(result.ok).toBe(true);
    expect(result.nuevoEstado).toBe("en_curso");
    expect(emitDomainEvent).not.toHaveBeenCalled();
  });

  // ─── 7. transicionar en_curso → cerrado (con emit) ─────────────────────────

  it("transicionar en_curso→cerrado emite ece.episodio.cerrado", async () => {
    const prisma = makePrisma([[{ id: EPISODIO_ID, estado: "en_curso" }]]);
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    await caller.transicionar({ episodioId: EPISODIO_ID, nuevoEstado: "cerrado" });

    expect(emitDomainEvent).toHaveBeenCalledOnce();
    const [, payload] = (emitDomainEvent as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, { eventType: string }];
    expect(payload.eventType).toBe("ece.episodio.cerrado");
  });

  // ─── 8. transicionar cancelado → en_curso bloqueado ────────────────────────

  it("transicionar desde cancelado lanza CONFLICT", async () => {
    const prisma = makePrisma([[{ id: EPISODIO_ID, estado: "cancelado" }]]);
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    await expect(
      caller.transicionar({ episodioId: EPISODIO_ID, nuevoEstado: "en_curso" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // ─── 9. transición inválida (abierto → cerrado) ─────────────────────────────

  it("transicionar abierto→cerrado directamente lanza CONFLICT", async () => {
    const prisma = makePrisma([[{ id: EPISODIO_ID, estado: "abierto" }]]);
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    await expect(
      caller.transicionar({ episodioId: EPISODIO_ID, nuevoEstado: "cerrado" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // ─── 10. asignarCama — doble asignación bloqueada ───────────────────────────

  it("asignarCama lanza CONFLICT si ya hay una cama activa", async () => {
    // Primera query retorna una asignación activa → debe bloquear
    const prisma = makePrisma([[{ id: ASIGNACION_ID }]]);
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    await expect(
      caller.asignarCama({
        episodioHospitalarioId: EPISODIO_HOSP,
        camaId: CAMA_ID,
        fechaAsignacion: new Date("2026-05-17T10:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // ─── 11. liberarCama — NOT_FOUND ────────────────────────────────────────────

  it("liberarCama lanza NOT_FOUND si la asignación no existe o ya fue liberada", async () => {
    // UPDATE RETURNING retorna vacío → asignación no encontrada
    const prisma = makePrisma([
      [], // primera query (actualización) retorna vacío
    ]);
    // Sobreescribimos para que $queryRaw devuelva []
    prisma.$queryRaw = vi.fn().mockResolvedValue([]);
    const caller = eceEpisodioRouter.createCaller(makeCtx(prisma));

    await expect(
      caller.liberarCama({
        asignacionId: ASIGNACION_ID,
        fechaLiberacion: new Date("2026-05-17T16:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
