/**
 * Tests de humo — eceRegistroAnestesicoRouter (R1.2, 2026-09).
 *
 * Router sin suite previa. Cubre los procedures migrados a
 * `withEceContext`/`withWorkflowContext` en R1.2 (list/get — antes corrían
 * en `ctx.prisma` directo, rol BYPASSRLS) más un happy-path de creación.
 *
 * No pretende cobertura exhaustiva de reglas de negocio — eso es
 * responsabilidad de una suite dedicada; aquí solo se verifica que el wiring
 * de contexto ECE (`withWorkflowContext`) no rompió el contrato del router.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceRegistroAnestesicoRouter } from "../registro-anestesico.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// withWorkflowContext envuelve en $transaction + SET LOCAL — el mock ejecuta
// el callback directamente contra el mismo prisma mock (mismo patrón que
// periodo-expulsivo.router.test.ts / bridge-admision.router.test.ts).
vi.mock("../../../workflow/context", () => ({
  withWorkflowContext: vi.fn(
    async (_prisma: unknown, _ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn(_prisma),
  ),
}));

vi.mock("../../../lib/identity-resolver", () => ({
  resolvePersonalSalud: vi.fn(),
}));

vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-anest-0001" }),
}));

const ACTO_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const REGISTRO_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PERSONAL_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ESTAB_ID = MOCK_TENANT.establishmentId!;

const REGISTRO_ROW = {
  id: REGISTRO_ID,
  acto_quirurgico_id: ACTO_ID,
  instancia_id: null,
  asa: 2,
  tipo_anestesia: "general",
  via_aerea: "lma",
  medicamentos_administrados: [],
  signos_vitales_intraop: [],
  complicaciones: null,
  fluidoterapia_ml: null,
  perdidas_sanguineas_ml: null,
  registrado_por: PERSONAL_ID,
  estado_registro: "borrador",
  firmado_por: null,
  firmado_en: null,
  registrado_en: new Date("2026-05-17T09:00:00Z"),
};

function makeCtxWithTenant(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN", "ESP"], establishmentId: ESTAB_ID },
  });
}

describe("eceRegistroAnestesicoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("retorna registros filtrando dentro del contexto ECE", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([REGISTRO_ROW]);

      const caller = eceRegistroAnestesicoRouter.createCaller(makeCtxWithTenant(prisma));
      const result = await caller.list({ actoQuirurgicoId: ACTO_ID, limit: 20 });

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(REGISTRO_ID);
    });

    it("retorna lista vacía cuando no hay registros", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceRegistroAnestesicoRouter.createCaller(makeCtxWithTenant(prisma));
      const result = await caller.list({ limit: 20 });

      expect(result).toHaveLength(0);
    });
  });

  describe("get", () => {
    it("retorna el registro cuando existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([REGISTRO_ROW]);

      const caller = eceRegistroAnestesicoRouter.createCaller(makeCtxWithTenant(prisma));
      const result = await caller.get({ id: REGISTRO_ID });

      expect(result.id).toBe(REGISTRO_ID);
      expect(result.tipo_anestesia).toBe("general");
    });

    it("lanza NOT_FOUND si el registro no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceRegistroAnestesicoRouter.createCaller(makeCtxWithTenant(prisma));
      await expect(caller.get({ id: REGISTRO_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("create", () => {
    it("crea el registro cuando hay personal ECE vinculado y no hay uno activo", async () => {
      const { resolvePersonalSalud } = await import("../../../lib/identity-resolver");
      vi.mocked(resolvePersonalSalud).mockResolvedValueOnce({
        id: PERSONAL_ID,
        nombreCompleto: "Dra. Ana Anestesióloga",
      });
      // countActivos → 0
      prisma.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(0) }]);
      // INSERT RETURNING id
      prisma.$queryRaw.mockResolvedValueOnce([{ id: REGISTRO_ID }]);

      const caller = eceRegistroAnestesicoRouter.createCaller(makeCtxWithTenant(prisma));
      const result = await caller.create({
        actoQuirurgicoId: ACTO_ID,
        asa: 2,
        tipoAnestesia: "general",
        viaAerea: "lma",
      });

      expect(result.id).toBe(REGISTRO_ID);
    });

    it("lanza PRECONDITION_FAILED si el usuario no tiene personal_salud activo", async () => {
      const { resolvePersonalSalud } = await import("../../../lib/identity-resolver");
      vi.mocked(resolvePersonalSalud).mockResolvedValueOnce(null);

      const caller = eceRegistroAnestesicoRouter.createCaller(makeCtxWithTenant(prisma));
      await expect(
        caller.create({
          actoQuirurgicoId: ACTO_ID,
          asa: 2,
          tipoAnestesia: "general",
          viaAerea: "lma",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });
});
