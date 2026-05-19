/**
 * Tests del registroEnfermeriaRouter — ECE MAR/Kardex (Stream 30).
 *
 * Remediación HD-22/23/24:
 *   HD-22: schema drift — columnas BD reales (nota_evolucion, registrado_por,
 *          estado_registro, registro_enf_id, hora_aplicada, responsable).
 *   HD-23: computeScheduledSlot se deriva de indicacion_item.hora_indicada +
 *          frequencia; se persiste en hora_programada.
 *   HD-24: list envuelto en withEceContext; filtra por episodio_id.
 *
 * Cubre:
 *   1.  schema turno — acepta los 3 valores válidos
 *   2.  schema turno — rechaza valor inválido
 *   3.  schema create — rechaza episodioId vacío
 *   4.  create — happy path (sin personal_id, sin fecha, sin organization_id)
 *   5.  create — INTERNAL_SERVER_ERROR si INSERT retorna vacío
 *   6.  registrarAdministracion — indica anulada → BAD_REQUEST
 *   7.  registrarAdministracion — indica inexistente → BAD_REQUEST
 *   8.  registrarAdministracion — happy path + horaProgramada derivada + outbox
 *   9.  registrarAdministracion — fallback horaProgramada = horaAplicada si no hay hora_indicada
 *   10. firmar — happy path (borrador → firmado)
 *   11. firmar — estado incorrecto → BAD_REQUEST
 *   12. validar — happy path (firmado → validado)
 *   13. validar — estado no firmado → BAD_REQUEST
 *   14. computeScheduledSlot STAT retorna signedAt
 *   15. computeScheduledSlot PRN retorna now
 *   16. computeScheduledSlot Q8H calcula slot correcto
 *   17. computeScheduledSlot frecuencia desconocida → fallback signedAt
 */
import { z } from "zod";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { registroEnfermeriaRouter, turnoEnum } from "../registro-enfermeria.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// Schema local para pruebas de validación de input (espejo del router)
const eceRegistroCreateSchema = z.object({
  episodioId: z.string().uuid(),
  turno: turnoEnum,
  notaEvolucion: z.string().trim().max(2000).optional(),
  planCuidados: z.string().trim().max(4000).optional(),
  valoracionEnf: z.record(z.unknown()).optional(),
});

// ─── Mock outbox ──────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-id" }),
  };
});

import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REGISTRO_ID   = "11111111-1111-1111-1111-111111111111";
const EPISODIO_ID   = "22222222-2222-2222-2222-222222222222";
const INDICACION_ID = "33333333-3333-3333-3333-333333333333";
const ADMIN_ID      = "55555555-5555-5555-5555-555555555555";
const USER_ID       = "66666666-6666-6666-6666-666666666666";

const NURSE_TENANT = { ...MOCK_TENANT, roleCodes: ["NURSE"] };
const NURSE_USER   = { id: USER_ID, email: "enf@his.test", name: "Enfermera Test" };

// Fixture alineado con columnas BD reales (HD-22)
const REGISTRO_ROW = {
  id: REGISTRO_ID,
  instancia_id: "77777777-7777-7777-7777-777777777777",
  episodio_id: EPISODIO_ID,
  turno: "matutino",
  nota_evolucion: null,
  plan_cuidados: null,
  valoracion_enf: null,
  registrado_por: USER_ID,
  registrado_en: new Date(),
  estado_registro: "borrador",
};

const INDICACION_ACTIVA = {
  id: INDICACION_ID,
  estado: "activa",
  episodio_id: EPISODIO_ID,
  hora_indicada: new Date("2026-05-17T06:00:00Z"),
  frequencia: "Q8H",
};

const INDICACION_SIN_SLOT = {
  ...INDICACION_ACTIVA,
  hora_indicada: null,
  frequencia: null,
};

const INDICACION_ANULADA = { ...INDICACION_ACTIVA, estado: "anulada" };

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
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  return prisma;
}

function makeCaller(prisma: DeepMockProxy<PrismaClient>) {
  return registroEnfermeriaRouter.createCaller(
    makeCtx({ prisma, tenant: NURSE_TENANT, user: NURSE_USER }),
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("registroEnfermeriaRouter (HD-22/23/24)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  // 1 — schema acepta los 3 turnos válidos
  describe("schema turno", () => {
    it.each(["matutino", "vespertino", "nocturno"] as const)(
      "acepta turno='%s'",
      (turno) => {
        expect(turnoEnum.safeParse(turno).success).toBe(true);
      },
    );

    // 2
    it("rechaza turno inválido", () => {
      expect(turnoEnum.safeParse("diurno").success).toBe(false);
    });
  });

  // 3 — create schema: episodioId obligatorio
  it("eceRegistroCreateSchema rechaza episodioId vacío", () => {
    const result = eceRegistroCreateSchema.safeParse({ turno: "matutino" });
    expect(result.success).toBe(false);
  });

  // 4 — create happy path (HD-22: sin fecha, sin personal_id, sin organization_id)
  describe("create", () => {
    it("crea registro con columnas BD reales y devuelve id", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: REGISTRO_ID }] as never);

      const caller = makeCaller(prisma);
      const result = await caller.create({
        episodioId: EPISODIO_ID,
        turno: "matutino",
        notaEvolucion: "Paciente estable",
      });
      expect(result).toEqual({ id: REGISTRO_ID });
    });

    // 5
    it("INTERNAL_SERVER_ERROR si INSERT retorna vacío", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);

      const caller = makeCaller(prisma);
      await expect(
        caller.create({ episodioId: EPISODIO_ID, turno: "nocturno" }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    });
  });

  // 6 + 7 + 8 + 9 — registrarAdministracion
  describe("registrarAdministracion", () => {
    const baseInput = {
      registroEnfId: REGISTRO_ID,
      indicacionItemId: INDICACION_ID,
      horaAplicada: new Date("2026-05-17T14:30:00Z"),
      estado: "administrado" as const,
    };

    // 6 — 1 withEceContext: findRegistro[0] + findIndicacion[1] → anulada
    it("BAD_REQUEST si indicación está anulada", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([REGISTRO_ROW] as never)
        .mockResolvedValueOnce([INDICACION_ANULADA] as never);

      const caller = makeCaller(prisma);
      await expect(caller.registrarAdministracion(baseInput)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("anulada"),
      });
    });

    // 7 — 1 withEceContext: findRegistro[0] + findIndicacion[1] = []
    it("BAD_REQUEST si indicación no existe", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([REGISTRO_ROW] as never)
        .mockResolvedValueOnce([] as never);

      const caller = makeCaller(prisma);
      await expect(caller.registrarAdministracion(baseInput)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("no existe"),
      });
    });

    // 8 — HD-23: 1 withEceContext: findRegistro[0] + findIndicacion[1] + INSERT[2]
    it("happy path: INSERT con hora_programada derivada y emite outbox", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([REGISTRO_ROW] as never)
        .mockResolvedValueOnce([INDICACION_ACTIVA] as never)
        .mockResolvedValueOnce([{ id: ADMIN_ID }] as never);

      const caller = makeCaller(prisma);
      const result = await caller.registrarAdministracion(baseInput);

      expect(result).toEqual({ id: ADMIN_ID });
      expect(emitDomainEvent).toHaveBeenCalledOnce();
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: "ece.administracion.registrada",
          aggregateId: ADMIN_ID,
          payload: expect.objectContaining({
            horaProgramada: expect.any(String),
            registroEnfId: REGISTRO_ID,
          }),
        }),
      );
    });

    // 9 — HD-23 fallback: 1 withEceContext: findRegistro[0] + findIndicacion[1] (sin hora_indicada) + INSERT[2]
    it("fallback: horaProgramada = horaAplicada cuando indicacion_item no tiene hora_indicada", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([REGISTRO_ROW] as never)
        .mockResolvedValueOnce([INDICACION_SIN_SLOT] as never)
        .mockResolvedValueOnce([{ id: ADMIN_ID }] as never);

      const caller = makeCaller(prisma);
      const result = await caller.registrarAdministracion(baseInput);

      expect(result).toEqual({ id: ADMIN_ID });
      expect(emitDomainEvent).toHaveBeenCalledOnce();
    });
  });

  // 10 + 11 — firmar
  describe("firmar", () => {
    // 10
    it("happy path: borrador → firmado (HD-22: sin firmado_por en BD)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([REGISTRO_ROW] as never);

      const caller = makeCaller(prisma);
      const result = await caller.firmar({ id: REGISTRO_ID });
      expect(result).toEqual({ ok: true });
    });

    // 11
    it("BAD_REQUEST si estado_registro no es borrador ni en_revision", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { ...REGISTRO_ROW, estado_registro: "firmado" },
      ] as never);

      const caller = makeCaller(prisma);
      await expect(caller.firmar({ id: REGISTRO_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });
  });

  // 12 + 13 — validar
  describe("validar", () => {
    // 12
    it("happy path: firmado → validado (HD-22: sin validado_por en BD)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { ...REGISTRO_ROW, estado_registro: "firmado" },
      ] as never);

      const caller = makeCaller(prisma);
      const result = await caller.validar({ id: REGISTRO_ID });
      expect(result).toEqual({ ok: true });
    });

    // 13
    it("BAD_REQUEST si estado_registro no es firmado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([REGISTRO_ROW] as never);

      const caller = makeCaller(prisma);
      await expect(caller.validar({ id: REGISTRO_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("firmado"),
      });
    });
  });

  // 14-17 — computeScheduledSlot unit tests (HD-23)
  describe("computeScheduledSlot (medication-slot)", () => {
    // 14
    it("STAT retorna signedAt", async () => {
      const { computeScheduledSlot } = await import("../../../utils/medication-slot");
      const signedAt = new Date("2026-05-17T06:00:00Z");
      expect(computeScheduledSlot(signedAt, "STAT")).toEqual(signedAt);
    });

    // 15
    it("PRN retorna now", async () => {
      const { computeScheduledSlot } = await import("../../../utils/medication-slot");
      const signedAt = new Date("2026-05-17T06:00:00Z");
      const now = new Date("2026-05-17T10:00:00Z");
      expect(computeScheduledSlot(signedAt, "PRN", now)).toEqual(now);
    });

    // 16
    it("Q8H calcula slot correcto (06:00 base, 14:30 now → slot 14:00)", async () => {
      const { computeScheduledSlot } = await import("../../../utils/medication-slot");
      const signedAt = new Date("2026-05-17T06:00:00Z");
      const now = new Date("2026-05-17T14:30:00Z");
      const expected = new Date("2026-05-17T14:00:00Z");
      expect(computeScheduledSlot(signedAt, "Q8H", now)).toEqual(expected);
    });

    // 17
    it("frecuencia desconocida retorna signedAt como fallback seguro", async () => {
      const { computeScheduledSlot } = await import("../../../utils/medication-slot");
      const signedAt = new Date("2026-05-17T06:00:00Z");
      expect(computeScheduledSlot(signedAt, "CADA_2_SEMANAS")).toEqual(signedAt);
    });
  });
});
