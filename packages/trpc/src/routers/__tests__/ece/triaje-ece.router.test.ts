/**
 * Tests del triajeEceRouter (NTEC §3.4 Hoja de Triaje ECE).
 *
 * Estrategia:
 *   - Todas las operaciones usan $queryRaw/$executeRaw (raw SQL).
 *   - withWorkflowContext abre $transaction; se mockea devolviendo el prisma mock.
 *   - emitDomainEvent se mockea para verificar que se llama con el payload correcto.
 *
 * Cubre (≥6 tests):
 *   1. create — Manchester nivel válido (1–5)
 *   2. create — Manchester nivel inválido rechazado por Zod
 *   3. firmar — permitido con rol ENF
 *   4. firmar — rechazado sin rol ENF (FORBIDDEN)
 *   5. validar — permitido con rol MT
 *   6. validar — rechazado sin rol MT (FORBIDDEN)
 *   7. firmar — lanza PRECONDITION_FAILED si estado no es borrador/en_revision
 *   8. validar — lanza PRECONDITION_FAILED si estado no es firmado
 *   9. linkToHisTriage — vincula correctamente
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { triajeEceRouter } from "../../ece/triaje-ece.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "event-abc" }),
  };
});

import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HOJA_ID     = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INSTANCIA_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EPISODIO_ID  = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const TRIAGE_ID    = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const FIRMA_ID     = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ORG_ID       = MOCK_TENANT.organizationId;
const ESTAB_ID     = "00000000-0000-0000-0000-0000000000cc";

const ECE_TENANT_ENF = {
  ...MOCK_TENANT,
  organizationId: ORG_ID,
  establishmentId: ESTAB_ID,
  roleCodes: ["ENF"],
};

const ECE_TENANT_MT = {
  ...MOCK_TENANT,
  organizationId: ORG_ID,
  establishmentId: ESTAB_ID,
  roleCodes: ["MT"],
};

const ECE_TENANT_MC = {
  ...MOCK_TENANT,
  organizationId: ORG_ID,
  establishmentId: ESTAB_ID,
  roleCodes: ["MC"],
};

const HOJA_ROW_BORRADOR = {
  id: HOJA_ID,
  instancia_id: INSTANCIA_ID,
  episodio_id: EPISODIO_ID,
  nivel_prioridad: "2",
  estado_workflow: "borrador",
};

const HOJA_ROW_FIRMADA = {
  id: HOJA_ID,
  instancia_id: INSTANCIA_ID,
  episodio_id: EPISODIO_ID,
  nivel_prioridad: "2",
  estado_workflow: "firmado",
};

// ─── Helper: prisma mock con $transaction que pasa el mismo mock ──────────────

function makeEcePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  // withWorkflowContext usa $transaction; pasamos el mismo proxy como tx.
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("triajeEceRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makeEcePrisma();
    vi.clearAllMocks();
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe("create", () => {
    it("crea hoja de triaje ECE con nivel Manchester válido (nivel 2)", async () => {
      // instancia existe
      prisma.$queryRaw.mockResolvedValueOnce([{ id: INSTANCIA_ID }] as never);
      // RETURNING id del INSERT
      prisma.$queryRaw.mockResolvedValueOnce([{ id: HOJA_ID }] as never);

      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_MC }),
      );
      const result = await caller.create({
        instanciaId: INSTANCIA_ID,
        episodioId: EPISODIO_ID,
        manchesterNivel: 2,
        motivoConsulta: "Dolor torácico",
        tiempoEsperaMin: 10,
      });

      expect(result.id).toBe(HOJA_ID);
    });

    it("rechaza nivel Manchester fuera de rango (nivel 6) — error Zod", async () => {
      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_MC }),
      );
      await expect(
        caller.create({
          instanciaId: INSTANCIA_ID,
          episodioId: EPISODIO_ID,
          manchesterNivel: 6 as never,
          motivoConsulta: "Dolor torácico",
          tiempoEsperaMin: 10,
        }),
      ).rejects.toThrow();
      // Zod lanza antes de llegar a la BD — no debe llamar $queryRaw.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("lanza NOT_FOUND si la instancia ECE no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);

      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_MC }),
      );
      await expect(
        caller.create({
          instanciaId: INSTANCIA_ID,
          episodioId: EPISODIO_ID,
          manchesterNivel: 1,
          motivoConsulta: "Trauma",
          tiempoEsperaMin: 0,
        }),
      ).rejects.toThrow(TRPCError);
    });
  });

  // ─── firmar ───────────────────────────────────────────────────────────────

  describe("firmar", () => {
    it("ENF puede firmar una hoja en estado borrador", async () => {
      // Hoja en borrador
      prisma.$queryRaw.mockResolvedValueOnce([HOJA_ROW_BORRADOR] as never);
      // firma electrónica válida para el usuario
      prisma.$queryRaw.mockResolvedValueOnce([{ id: FIRMA_ID }] as never);
      // emitDomainEvent usa tx.domainEvent.create (Prisma model)
      prisma.domainEvent.create.mockResolvedValue({ id: "event-abc" } as never);
      prisma.auditLog.create.mockResolvedValue({ id: "audit-abc" } as never);

      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_ENF }),
      );
      const result = await caller.firmar({ id: HOJA_ID, firmaId: FIRMA_ID });

      expect(result.estado).toBe("firmado");
      expect(emitDomainEvent).toHaveBeenCalledOnce();
      const call = vi.mocked(emitDomainEvent).mock.calls[0]!;
      expect(call[1].eventType).toBe("ece.triaje.firmado");
      expect((call[1].payload as { manchesterNivel: number }).manchesterNivel).toBe(2);
    });

    it("rechaza firmar si el rol no es ENF (FORBIDDEN)", async () => {
      // MC intenta firmar — requireRole(["ENF"]) lo rechaza antes de llegar a BD.
      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_MC }),
      );
      await expect(
        caller.firmar({ id: HOJA_ID, firmaId: FIRMA_ID }),
      ).rejects.toThrow(TRPCError);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("lanza PRECONDITION_FAILED si la hoja ya está validada", async () => {
      const hojaValidada = { ...HOJA_ROW_BORRADOR, estado_workflow: "validado" };
      prisma.$queryRaw.mockResolvedValueOnce([hojaValidada] as never);

      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_ENF }),
      );
      await expect(
        caller.firmar({ id: HOJA_ID, firmaId: FIRMA_ID }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // ─── validar ──────────────────────────────────────────────────────────────

  describe("validar", () => {
    it("MT puede validar una hoja firmada", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([HOJA_ROW_FIRMADA] as never);

      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_MT }),
      );
      const result = await caller.validar({ id: HOJA_ID });

      expect(result.estado).toBe("validado");
    });

    it("rechaza validar si el rol no es MT (FORBIDDEN)", async () => {
      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_ENF }),
      );
      await expect(
        caller.validar({ id: HOJA_ID }),
      ).rejects.toThrow(TRPCError);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("lanza PRECONDITION_FAILED si la hoja no está firmada", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([HOJA_ROW_BORRADOR] as never);

      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_MT }),
      );
      await expect(
        caller.validar({ id: HOJA_ID }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // ─── linkToHisTriage ──────────────────────────────────────────────────────

  describe("linkToHisTriage", () => {
    it("vincula hoja ECE con TriageEvaluation HIS existente", async () => {
      // TriageEvaluation HIS encontrado (ctx.prisma, fuera de tx)
      prisma.triageEvaluation.findFirst.mockResolvedValue({
        id: TRIAGE_ID,
      } as never);
      // UPDATE RETURNING id
      prisma.$queryRaw.mockResolvedValueOnce([{ id: HOJA_ID }] as never);

      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_MC }),
      );
      const result = await caller.linkToHisTriage({
        id: HOJA_ID,
        triageId: TRIAGE_ID,
      });

      expect(result.linkedTriageId).toBe(TRIAGE_ID);
    });

    it("lanza NOT_FOUND si el TriageEvaluation HIS no existe en la org", async () => {
      prisma.triageEvaluation.findFirst.mockResolvedValue(null);

      const caller = triajeEceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT_MC }),
      );
      await expect(
        caller.linkToHisTriage({ id: HOJA_ID, triageId: TRIAGE_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
