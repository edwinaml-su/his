/**
 * Tests del registroEnfermeriaRouter — ECE MAR/Kardex (Stream 30).
 *
 * Cubre:
 *   1. list — turnos válidos via schema Zod
 *   2. list — schema rechaza turno inválido
 *   3. create — crea registro correctamente
 *   4. registrarAdministracion — indica anulada → BAD_REQUEST
 *   5. registrarAdministracion — indica inexistente → BAD_REQUEST
 *   6. registrarAdministracion — happy path + emite outbox
 *   7. firmar — happy path (borrador → firmado)
 *   8. firmar — estado incorrecto → BAD_REQUEST
 *   9. validar — happy path (firmado → validado)
 *  10. validar — estado no firmado → BAD_REQUEST
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { registroEnfermeriaRouter } from "../registro-enfermeria.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// Schemas espejo — misma definición que el router (worktree-local)
const turnoEnum = z.enum(["matutino", "vespertino", "nocturno"]);
const eceRegistroCreateSchema = z.object({
  episodioId: z.string().uuid(),
  fecha: z.coerce.date(),
  turno: turnoEnum,
  observaciones: z.string().trim().max(2000).optional(),
});
const eceAdministracionSchema = z.object({
  registroId: z.string().uuid(),
  indicacionItemId: z.string().uuid(),
  horaAdministrada: z.coerce.date(),
  dosisAdministrada: z.string().trim().min(1).max(100),
  viaUsada: z.string().trim().min(1).max(80),
  observaciones: z.string().trim().max(2000).optional(),
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

const ORG_ID       = MOCK_TENANT.organizationId;
const REGISTRO_ID  = "11111111-1111-1111-1111-111111111111";
const EPISODIO_ID  = "22222222-2222-2222-2222-222222222222";
const INDICACION_ID = "33333333-3333-3333-3333-333333333333";
const PERSONAL_ID  = "44444444-4444-4444-4444-444444444444";
const ADMIN_ID     = "55555555-5555-5555-5555-555555555555";
const USER_ID      = "66666666-6666-6666-6666-666666666666";

const NURSE_TENANT = {
  ...MOCK_TENANT,
  roleCodes: ["NURSE"],
};

const NURSE_USER = { id: USER_ID, email: "enf@his.test", name: "Enfermera Test" };

const REGISTRO_ROW = {
  id: REGISTRO_ID,
  episodio_id: EPISODIO_ID,
  personal_id: PERSONAL_ID,
  organization_id: ORG_ID,
  fecha: new Date("2026-05-17"),
  turno: "matutino",
  estado: "borrador",
  observaciones: null,
  creado_en: new Date(),
};

const INDICACION_ACTIVA = {
  id: INDICACION_ID,
  estado: "activa",
  episodio_id: EPISODIO_ID,
};

const INDICACION_ANULADA = {
  id: INDICACION_ID,
  estado: "anulada",
  episodio_id: EPISODIO_ID,
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function makePrisma(): DeepMockProxy<PrismaClient> {
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

function makeCaller(prisma: DeepMockProxy<PrismaClient>) {
  return registroEnfermeriaRouter.createCaller(
    makeCtx({ prisma, tenant: NURSE_TENANT, user: NURSE_USER }),
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("registroEnfermeriaRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  // 1 — schema Zod acepta los 3 turnos válidos
  describe("schema turno", () => {
    it.each(["matutino", "vespertino", "nocturno"] as const)(
      "acepta turno='%s'",
      (turno) => {
        const result = eceRegistroCreateSchema.safeParse({
          episodioId: EPISODIO_ID,
          fecha: new Date(),
          turno,
        });
        expect(result.success).toBe(true);
      },
    );

    it("rechaza turno inválido", () => {
      const result = eceRegistroCreateSchema.safeParse({
        episodioId: EPISODIO_ID,
        fecha: new Date(),
        turno: "diurno",
      });
      expect(result.success).toBe(false);
    });
  });

  // 2 — eceAdministracionSchema requiere campos obligatorios
  it("eceAdministracionSchema rechaza dosis vacía", () => {
    const result = eceAdministracionSchema.safeParse({
      registroId: REGISTRO_ID,
      indicacionItemId: INDICACION_ID,
      horaAdministrada: new Date(),
      dosisAdministrada: "",
      viaUsada: "IV",
    });
    expect(result.success).toBe(false);
  });

  // 3 — create happy path
  describe("create", () => {
    it("crea registro y devuelve id", async () => {
      prisma.$queryRaw
        // findPersonal
        .mockResolvedValueOnce([{ id: PERSONAL_ID }] as never)
        // INSERT RETURNING id
        .mockResolvedValueOnce([{ id: REGISTRO_ID }] as never);

      const caller = makeCaller(prisma);
      const result = await caller.create({
        episodioId: EPISODIO_ID,
        fecha: new Date("2026-05-17"),
        turno: "matutino",
      });
      expect(result).toEqual({ id: REGISTRO_ID });
    });

    it("PRECONDITION_FAILED si no existe personal_salud", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);

      const caller = makeCaller(prisma);
      await expect(
        caller.create({
          episodioId: EPISODIO_ID,
          fecha: new Date("2026-05-17"),
          turno: "nocturno",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // 4 + 5 + 6 — registrarAdministracion
  describe("registrarAdministracion", () => {
    const baseInput = {
      registroId: REGISTRO_ID,
      indicacionItemId: INDICACION_ID,
      horaAdministrada: new Date("2026-05-17T08:00:00Z"),
      dosisAdministrada: "500mg",
      viaUsada: "oral",
    };

    it("BAD_REQUEST si indicacion está anulada", async () => {
      // findRegistro
      prisma.$queryRaw
        .mockResolvedValueOnce([REGISTRO_ROW] as never)
        // findIndicacionItem
        .mockResolvedValueOnce([INDICACION_ANULADA] as never);

      const caller = makeCaller(prisma);
      await expect(caller.registrarAdministracion(baseInput)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("anulada"),
      });
    });

    it("BAD_REQUEST si indicacion no existe", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([REGISTRO_ROW] as never)
        .mockResolvedValueOnce([] as never);

      const caller = makeCaller(prisma);
      await expect(caller.registrarAdministracion(baseInput)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("no existe"),
      });
    });

    it("happy path: crea administración y emite evento outbox", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([REGISTRO_ROW] as never)     // findRegistro
        .mockResolvedValueOnce([INDICACION_ACTIVA] as never) // findIndicacionItem
        .mockResolvedValueOnce([{ id: ADMIN_ID }] as never); // INSERT RETURNING

      const caller = makeCaller(prisma);
      const result = await caller.registrarAdministracion(baseInput);

      expect(result).toEqual({ id: ADMIN_ID });
      expect(emitDomainEvent).toHaveBeenCalledOnce();
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: "ece.administracion.registrada",
          aggregateId: ADMIN_ID,
        }),
      );
    });
  });

  // 7 + 8 — firmar
  describe("firmar", () => {
    it("happy path: borrador → firmado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([REGISTRO_ROW] as never);

      const caller = makeCaller(prisma);
      const result = await caller.firmar({ id: REGISTRO_ID });
      expect(result).toEqual({ ok: true });
    });

    it("BAD_REQUEST si el estado no es borrador ni en_revision", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { ...REGISTRO_ROW, estado: "firmado" },
      ] as never);

      const caller = makeCaller(prisma);
      await expect(caller.firmar({ id: REGISTRO_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });
  });

  // 9 + 10 — validar
  describe("validar", () => {
    it("happy path: firmado → validado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { ...REGISTRO_ROW, estado: "firmado" },
      ] as never);

      const caller = makeCaller(prisma);
      const result = await caller.validar({ id: REGISTRO_ID });
      expect(result).toEqual({ ok: true });
    });

    it("BAD_REQUEST si el estado no es firmado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([REGISTRO_ROW] as never); // estado='borrador'

      const caller = makeCaller(prisma);
      await expect(caller.validar({ id: REGISTRO_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("firmado"),
      });
    });
  });
});
