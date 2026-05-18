/**
 * Tests unitarios — eceAtencionRnRouter (ATN_RN).
 *
 * Estrategia: Vitest + vitest-mock-extended + $transaction inline mock.
 * Cero I/O real. Mismo patrón que hoja-ingreso.router.test.ts.
 *
 * Casos cubiertos (8 tests):
 *   1. Zod create — episodioObsId debe ser UUID válido
 *   2. Zod create — pesoG fuera de rango [200,8000]
 *   3. Zod create — apgar1min fuera de rango [0,10]
 *   4. create — PRECONDITION_FAILED si no hay personal_salud activo
 *   5. create — PRECONDITION_FAILED si tipo documento ATN_RN no configurado
 *   6. get — NOT_FOUND cuando el registro no existe
 *   7. registrarApgar — CONFLICT si estado_documento !== borrador
 *   8. firmar — NOT_FOUND cuando el registro no existe
 *
 * @QA E2E pendiente:
 *   - Flujo completo: create (RN creado automáticamente) → registrarApgar → firmar con PIN MC.
 *   - list filtra por episodioObsId y solo retorna registros del establecimiento (RLS).
 *   - ENF no puede crear (rol MC requerido, debe recibir FORBIDDEN).
 *   - reanimacion_requerida = true emite evento ece.rn.reanimacion_requerida en outbox.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Schemas inline ──────────────────────────────────────────────────────────

const createSchema = z.object({
  episodioObsId:           z.string().uuid(),
  pacienteMadreId:         z.string().uuid(),
  rnPrimerNombre:          z.string().min(1).max(100),
  rnPrimerApellido:        z.string().min(1).max(100),
  rnBiologicalSexId:       z.string().uuid(),
  rnBirthDate:             z.coerce.date(),
  pesoG:                   z.number().int().min(200).max(8000),
  tallaCm:                 z.number().min(20).max(70),
  sexo:                    z.enum(["M", "F", "I"]),
  edadGestacionalSemanas:  z.number().int().min(20).max(45),
  apgar1min:               z.number().int().min(0).max(10),
  apgar5min:               z.number().int().min(0).max(10),
  reanimacionRequerida:    z.boolean().default(false),
  reanimacionProtocoloNrp: z.boolean().default(false),
  alimentacionInicial:     z.enum(["lactancia_inmediata", "formula", "sng"]),
});

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("argon2", () => ({
  default: { verify: vi.fn(async () => true) },
}));

import { eceAtencionRnRouter } from "../atencion-rn.router";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UUID_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const UUID_D = "dddddddd-dddd-4ddd-dddd-dddddddddddd";

const VALID_CREATE = {
  episodioObsId:           UUID_A,
  pacienteMadreId:         UUID_B,
  rnPrimerNombre:          "Bebé",
  rnPrimerApellido:        "García",
  rnBiologicalSexId:       UUID_C,
  rnBirthDate:             new Date("2026-05-17T10:00:00Z"),
  pesoG:                   3200,
  tallaCm:                 50,
  sexo:                    "M" as const,
  edadGestacionalSemanas:  39,
  apgar1min:               8,
  apgar5min:               9,
  reanimacionRequerida:    false,
  reanimacionProtocoloNrp: false,
  alimentacionInicial:     "lactancia_inmediata" as const,
};

function makeMcCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["MC"] } });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("eceAtencionRnRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
    // withWorkflowContext usa $transaction internamente
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
    prisma.$executeRawUnsafe.mockResolvedValue(0);
  });

  // 1. Zod — episodioObsId UUID inválido
  it("Zod create — rechaza episodioObsId no-UUID", () => {
    const result = createSchema.safeParse({ ...VALID_CREATE, episodioObsId: "no-es-uuid" });
    expect(result.success).toBe(false);
  });

  // 2. Zod — pesoG fuera de rango
  it("Zod create — rechaza pesoG < 200", () => {
    const result = createSchema.safeParse({ ...VALID_CREATE, pesoG: 100 });
    expect(result.success).toBe(false);
  });

  // 3. Zod — apgar1min fuera de rango
  it("Zod create — rechaza apgar1min > 10", () => {
    const result = createSchema.safeParse({ ...VALID_CREATE, apgar1min: 11 });
    expect(result.success).toBe(false);
  });

  // 4. create — PRECONDITION si no hay personal_salud activo
  it("create — PRECONDITION_FAILED si no hay personal_salud activo", async () => {
    // findPersonal retorna vacío
    prisma.$queryRaw.mockResolvedValue([]);

    const caller = eceAtencionRnRouter.createCaller(makeMcCtx(prisma));
    await expect(caller.create(VALID_CREATE)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  // 5. create — PRECONDITION si tipo documento ATN_RN no configurado
  it("create — PRECONDITION_FAILED si ATN_RN no está en tipo_documento", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: UUID_C }])  // personal_salud
      .mockResolvedValueOnce([]);               // tipo_documento vacío

    const caller = eceAtencionRnRouter.createCaller(makeMcCtx(prisma));
    await expect(caller.create(VALID_CREATE)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  // 6. get — NOT_FOUND
  it("get — NOT_FOUND cuando el registro no existe", async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const caller = eceAtencionRnRouter.createCaller(makeMcCtx(prisma));
    await expect(caller.get({ id: UUID_A })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 7. registrarApgar — CONFLICT si estado no es borrador
  it("registrarApgar — CONFLICT si estado_documento !== borrador", async () => {
    prisma.$queryRaw.mockResolvedValue([{
      id: UUID_A,
      episodio_obs_id: UUID_B,
      paciente_madre_id: UUID_B,
      paciente_rn_id: UUID_C,
      instancia_id: null,
      hora_nacimiento: new Date(),
      peso_g: 3200,
      talla_cm: "50.0",
      perimetro_cefalico_cm: null,
      sexo: "M",
      edad_gestacional_semanas: 39,
      apgar_1min: 8,
      apgar_5min: 9,
      apgar_10min: null,
      reanimacion_requerida: false,
      reanimacion_protocolo_nrp_aplicado: null,
      malformaciones_visibles: null,
      alimentacion_inicial: "lactancia_inmediata",
      estado_documento: "firmado",   // no borrador
      registrado_por: UUID_D,
      atendido_por: UUID_D,
      firmado_por: null,
      firmado_en: null,
      registrado_en: new Date(),
    }]);

    const caller = eceAtencionRnRouter.createCaller(makeMcCtx(prisma));
    await expect(caller.registrarApgar({
      id: UUID_A, apgar1min: 7, apgar5min: 9,
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // 8. firmar — NOT_FOUND
  it("firmar — NOT_FOUND cuando el registro no existe", async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const caller = eceAtencionRnRouter.createCaller(makeMcCtx(prisma));
    await expect(caller.firmar({ id: UUID_A, pin: "123456" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
