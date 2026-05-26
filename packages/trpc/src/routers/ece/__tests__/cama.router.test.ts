/**
 * Tests del eceCamaRouter — ECE Mapa de Camas.
 *
 * Cubre:
 *  1. listEstadoCamas — devuelve camas con estado correcto
 *  2. listEstadoCamas — BAD_REQUEST sin establecimientoId
 *  3. estadoServicio  — devuelve métricas numéricas (convierte bigint)
 *  4. estadoServicio  — servicio vacío devuelve ceros
 *  5. cambiarEstado   — happy-path libre → limpieza
 *  6. cambiarEstado   — CONFLICT si cama ocupada
 *  7. cambiarEstado   — NOT_FOUND si camaId inexistente
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceCamaRouter } from "../cama.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_TENANT_NO_ESTABLISHMENT } from "@his/test-utils";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CAMA_ID    = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const SERVICIO_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const NURSE_TENANT = { ...MOCK_TENANT, roleCodes: ["NURSE"], establishmentId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" };
const ADM_TENANT   = { ...MOCK_TENANT, roleCodes: ["ADM"],   establishmentId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" };

const CAMA_RAW_LIBRE = {
  cama_id: CAMA_ID,
  codigo: "H-101",
  servicio: "Medicina Interna",
  estado_manual: null,
  status_bd: null,
  asignacion_id: null,
  paciente_nombre: null,
  episodio_id: null,
  asignada_desde: null,
};

const CAMA_RAW_OCUPADA = {
  ...CAMA_RAW_LIBRE,
  asignacion_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  paciente_nombre: "Ana García",
  episodio_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  asignada_desde: new Date("2026-05-17T08:00:00Z"),
};

// ─── Helper Prisma mock ───────────────────────────────────────────────────────

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

describe("eceCamaRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  // 1 — listEstadoCamas happy-path
  it("listEstadoCamas: devuelve camas con estado derivado correctamente", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([CAMA_RAW_LIBRE, CAMA_RAW_OCUPADA]);

    const caller = eceCamaRouter.createCaller(makeCtx({ prisma, tenant: NURSE_TENANT }));
    const result = await caller.listEstadoCamas({ servicioId: SERVICIO_ID });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ camaId: CAMA_ID, estado: "libre", pacienteNombre: null });
    expect(result[1]).toMatchObject({
      estado: "ocupada",
      pacienteNombre: "Ana García",
    });
  });

  // 2 — BAD_REQUEST sin establishmentId
  it("listEstadoCamas: lanza BAD_REQUEST si no hay establecimiento activo", async () => {
    const caller = eceCamaRouter.createCaller(
      makeCtx({ prisma, tenant: { ...MOCK_TENANT_NO_ESTABLISHMENT, roleCodes: ["NURSE", "ADM", "PHYSICIAN"] } }),
    );

    await expect(
      caller.listEstadoCamas({ servicioId: SERVICIO_ID }),
    ).rejects.toThrow("establecimiento activo");
  });

  // 3 — estadoServicio happy-path
  it("estadoServicio: devuelve métricas numéricas (convierte bigint)", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { total: BigInt(10), libres: BigInt(4), ocupadas: BigInt(5), limpieza: BigInt(1), mantenimiento: BigInt(0) },
    ]);

    const caller = eceCamaRouter.createCaller(makeCtx({ prisma, tenant: NURSE_TENANT }));
    const result = await caller.estadoServicio({ servicioId: SERVICIO_ID });

    expect(result).toEqual({ totalCamas: 10, libres: 4, ocupadas: 5, limpieza: 1, mantenimiento: 0 });
  });

  // 4 — estadoServicio servicio vacío
  it("estadoServicio: servicio sin camas devuelve ceros", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const caller = eceCamaRouter.createCaller(makeCtx({ prisma, tenant: NURSE_TENANT }));
    const result = await caller.estadoServicio({ servicioId: SERVICIO_ID });

    expect(result.totalCamas).toBe(0);
    expect(result.libres).toBe(0);
  });

  // 5 — cambiarEstado happy-path
  it("cambiarEstado: marca cama como limpieza correctamente", async () => {
    // No hay asignación activa
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // asignaciones activas → vacío
      .mockResolvedValueOnce([{ id: CAMA_ID }]); // UPDATE RETURNING

    const caller = eceCamaRouter.createCaller(makeCtx({ prisma, tenant: ADM_TENANT }));
    const result = await caller.cambiarEstado({ camaId: CAMA_ID, nuevoEstado: "limpieza" });

    expect(result.nuevoEstado).toBe("limpieza");
    expect(result.camaId).toBe(CAMA_ID);
  });

  // 6 — cambiarEstado CONFLICT si ocupada
  it("cambiarEstado: CONFLICT si la cama tiene asignación activa", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "asig-001" }]); // asignación activa existe

    const caller = eceCamaRouter.createCaller(makeCtx({ prisma, tenant: NURSE_TENANT }));
    await expect(
      caller.cambiarEstado({ camaId: CAMA_ID, nuevoEstado: "mantenimiento" }),
    ).rejects.toThrow("actualmente ocupada");
  });

  // 7 — cambiarEstado NOT_FOUND
  it("cambiarEstado: NOT_FOUND si camaId no existe en BD", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // sin asignación activa
      .mockResolvedValueOnce([]); // UPDATE no afectó filas

    const caller = eceCamaRouter.createCaller(makeCtx({ prisma, tenant: NURSE_TENANT }));
    await expect(
      caller.cambiarEstado({ camaId: CAMA_ID, nuevoEstado: "libre" }),
    ).rejects.toThrow("no encontrada");
  });

  // 8 — mapCompleto happy-path
  it("mapCompleto: agrupa camas por servicio con estado derivado", async () => {
    // Primera query: servicios
    prisma.$queryRaw.mockResolvedValueOnce([
      { servicio_id: SERVICIO_ID, servicio_nombre: "Medicina Interna" },
    ]);
    // Segunda query: todas las camas
    prisma.$queryRaw.mockResolvedValueOnce([
      { ...CAMA_RAW_LIBRE,   service_unit_id: SERVICIO_ID },
      { ...CAMA_RAW_OCUPADA, service_unit_id: SERVICIO_ID },
    ]);

    const caller = eceCamaRouter.createCaller(makeCtx({ prisma, tenant: NURSE_TENANT }));
    const result = await caller.mapCompleto();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      servicioId: SERVICIO_ID,
      servicioNombre: "Medicina Interna",
    });
    expect(result[0]!.camas).toHaveLength(2);
    expect(result[0]!.camas[0]).toMatchObject({ estado: "libre" });
    expect(result[0]!.camas[1]).toMatchObject({ estado: "ocupada", pacienteNombre: "Ana García" });
  });

  // 9 — mapCompleto sin camas
  it("mapCompleto: retorna array vacío si no hay wards con camas activas", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]); // sin servicios

    const caller = eceCamaRouter.createCaller(makeCtx({ prisma, tenant: NURSE_TENANT }));
    const result = await caller.mapCompleto();

    expect(result).toEqual([]);
  });
});
