/**
 * Tests del epcisQueryRouter — EPCIS Query Layer (schema legacy).
 *
 * Schema ece.epcis_event legacy: equipment_id, gln_destino, gln_origen,
 * registrado_por, registrado_en, notas. Sin GTIN/lote/GSRN de paciente.
 *
 * Cubre (≥6 tests):
 *   1. queryByGln — devuelve eventos cuando GLN coincide en destino u origen
 *   2. queryByGln — con rango de fechas pasa parámetros adicionales
 *   3. queryByGln — sin resultados devuelve array vacío
 *   4. queryByEquipment — devuelve historia del equipo
 *   5. queryByEquipment — UUID inválido lanza ZodError (bad input)
 *   6. queryByOrigin — filtra por glnOrigen solamente
 *   7. queryByOrigin — falla si no se provee ni glnOrigen ni glnDestino
 *   8. queryRecent — devuelve últimos N eventos
 *   9. queryByGln — sin rol autorizado lanza FORBIDDEN
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { epcisQueryRouter } from "../epcis-query.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GLN_A = "7891234567890";
const GLN_B = "7890987654321";
const EQUIP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeEvent(overrides: Partial<{
  id: string;
  equipment_id: string;
  gln_destino: string;
  gln_origen: string | null;
  registrado_por: string | null;
  registrado_en: Date;
  notas: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "00000000-0000-0000-0000-000000000001",
    equipment_id: overrides.equipment_id ?? EQUIP_ID,
    gln_destino: overrides.gln_destino ?? GLN_A,
    gln_origen: overrides.gln_origen ?? GLN_B,
    registrado_por: overrides.registrado_por ?? null,
    registrado_en: overrides.registrado_en ?? new Date("2026-03-01T10:00:00Z"),
    notas: overrides.notas ?? null,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("epcisQueryRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ── 1. queryByGln — happy path ───────────────────────────────────────────────

  it("queryByGln devuelve eventos cuando GLN coincide", async () => {
    const events = [makeEvent({ gln_destino: GLN_A })];
    // $queryRawUnsafe no existe en el tipo Prisma generado — se castea
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue(events);

    const caller = epcisQueryRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.queryByGln({ gln: GLN_A });

    expect(result).toHaveLength(1);
    expect(result[0]!.gln_destino).toBe(GLN_A);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma as any).$queryRawUnsafe).toHaveBeenCalledOnce();
  });

  // ── 2. queryByGln — con rango de fechas ─────────────────────────────────────

  it("queryByGln pasa fechas como parámetros adicionales", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([]);

    const caller = epcisQueryRouter.createCaller(makeCtx({ prisma }));
    await caller.queryByGln({
      gln: GLN_A,
      fechaDesde: new Date("2026-01-01"),
      fechaHasta: new Date("2026-12-31"),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sql, ...params] = (prisma as any).$queryRawUnsafe.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("registrado_en");
    // GLN + fechaDesde + fechaHasta = 3 parámetros
    expect(params).toHaveLength(3);
  });

  // ── 3. queryByGln — sin resultados ──────────────────────────────────────────

  it("queryByGln devuelve array vacío si no hay eventos", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([]);

    const caller = epcisQueryRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.queryByGln({ gln: "9999999999999" });

    expect(result).toEqual([]);
  });

  // ── 4. queryByEquipment — happy path ────────────────────────────────────────

  it("queryByEquipment devuelve historia completa del equipo", async () => {
    const events = [
      makeEvent({ equipment_id: EQUIP_ID, gln_destino: GLN_A }),
      makeEvent({ id: "00000000-0000-0000-0000-000000000002", equipment_id: EQUIP_ID, gln_destino: GLN_B }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue(events);

    const caller = epcisQueryRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.queryByEquipment({ equipmentId: EQUIP_ID });

    expect(result).toHaveLength(2);
    result.forEach((r) => expect(r.equipment_id).toBe(EQUIP_ID));
  });

  // ── 5. queryByEquipment — UUID inválido ─────────────────────────────────────

  it("queryByEquipment rechaza UUID inválido", async () => {
    const caller = epcisQueryRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.queryByEquipment({ equipmentId: "no-es-uuid" }),
    ).rejects.toThrow(TRPCError);
  });

  // ── 6. queryByOrigin — filtra por glnOrigen ─────────────────────────────────

  it("queryByOrigin devuelve eventos con glnOrigen especificado", async () => {
    const events = [makeEvent({ gln_origen: GLN_B })];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue(events);

    const caller = epcisQueryRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.queryByOrigin({ glnOrigen: GLN_B });

    expect(result).toHaveLength(1);
    expect(result[0]!.gln_origen).toBe(GLN_B);
  });

  // ── 7. queryByOrigin — sin GLN lanza error de validación ────────────────────

  it("queryByOrigin falla si no se provee ni glnOrigen ni glnDestino", async () => {
    const caller = epcisQueryRouter.createCaller(makeCtx({ prisma }));
    await expect(
      // @ts-expect-error — se pasa objeto vacío intencionalmente
      caller.queryByOrigin({}),
    ).rejects.toThrow(TRPCError);
  });

  // ── 8. queryRecent — respeta limit ──────────────────────────────────────────

  it("queryRecent devuelve eventos según limit", async () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ id: `00000000-0000-0000-0000-00000000000${i + 1}` }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue(events);

    const caller = epcisQueryRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.queryRecent({ limit: 5 });

    expect(result).toHaveLength(5);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sql, ...params] = (prisma as any).$queryRawUnsafe.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("LIMIT");
    // El limit es el primer (y único en este caso) parámetro
    expect(params).toContain(5);
  });

  // ── 9. queryByGln — sin rol autorizado lanza FORBIDDEN ──────────────────────

  it("queryByGln lanza FORBIDDEN si el usuario no tiene rol DIR/ARCH/ADMIN", async () => {
    const tenantSinRol = { ...MOCK_TENANT, roleCodes: ["NURSE"] };
    const caller = epcisQueryRouter.createCaller(
      makeCtx({ prisma, tenant: tenantSinRol }),
    );
    await expect(
      caller.queryByGln({ gln: GLN_A }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
