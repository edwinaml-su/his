/**
 * Tests unitarios del router workflow.rol (matriz documento_rol).
 *
 * Cubre: list, assign (happy path + idempotente + NOT_FOUND), revoke (NOT_FOUND + happy path).
 * Control de acceso: FORBIDDEN para tenants sin DIR/WORKFLOW_DESIGNER.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { workflowRolRouter } from "../workflow-rol.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TIPO_DOC_ID = "00000000-0000-0000-0000-000000000001";
const ROL_ID = "00000000-0000-0000-0000-000000000005";
const DOC_ROL_ID = "00000000-0000-0000-0000-000000000008";

const DOC_ROL_ROW = {
  id: DOC_ROL_ID,
  tipo_documento_id: TIPO_DOC_ID,
  rol_id: ROL_ID,
  funcion: "LLENA" as const,
  obligatorio: true,
  rol_codigo: "MC",
  rol_nombre: "Médico Clínico",
};

const WORKFLOW_TENANT = { ...MOCK_TENANT, roleCodes: ["DIR", "WORKFLOW_DESIGNER"] };
const UNPRIVILEGED_TENANT = { ...MOCK_TENANT, roleCodes: ["NURSE"] };

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("workflowRolRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (fn) => {
      if (typeof fn === "function") return fn(prisma as unknown as PrismaClient);
      return fn;
    });
  });

  // ── Control de acceso ──────────────────────────────────────────────────────

  it("list rechaza usuario sin DIR/WORKFLOW_DESIGNER", async () => {
    const caller = workflowRolRouter.createCaller(
      makeCtx({ prisma, tenant: UNPRIVILEGED_TENANT }),
    );
    await expect(
      caller.list({ tipDocumentoId: TIPO_DOC_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("assign rechaza usuario sin rol de workflow", async () => {
    const caller = workflowRolRouter.createCaller(
      makeCtx({ prisma, tenant: UNPRIVILEGED_TENANT }),
    );
    await expect(
      caller.assign({ tipDocumentoId: TIPO_DOC_ID, rolId: ROL_ID, funcion: "LLENA" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("revoke rechaza usuario sin rol de workflow", async () => {
    const caller = workflowRolRouter.createCaller(
      makeCtx({ prisma, tenant: UNPRIVILEGED_TENANT }),
    );
    await expect(
      caller.revoke({ tipDocumentoId: TIPO_DOC_ID, rolId: ROL_ID, funcion: "FIRMA" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── listAvailableRoles ─────────────────────────────────────────────────────

  describe("listAvailableRoles", () => {
    it("retorna roles ECE ordenados por nombre", async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: ROL_ID, codigo: "MC", nombre: "Médico Clínico" },
        { id: "00000000-0000-0000-0000-000000000006", codigo: "ENF", nombre: "Enfermero/a" },
      ] as never);
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.listAvailableRoles();
      expect(result).toHaveLength(2);
      expect(result[0]!.codigo).toBe("MC");
    });

    it("retorna lista vacía si no hay roles configurados", async () => {
      prisma.$queryRaw.mockResolvedValue([] as never);
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.listAvailableRoles();
      expect(result).toEqual([]);
    });

    it("rechaza usuario sin DIR/WORKFLOW_DESIGNER", async () => {
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: UNPRIVILEGED_TENANT }),
      );
      await expect(caller.listAvailableRoles()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("retorna la matriz de roles enriquecida con rol_codigo y rol_nombre", async () => {
      prisma.$queryRaw.mockResolvedValue([DOC_ROL_ROW] as never);
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.list({ tipDocumentoId: TIPO_DOC_ID });
      expect(result).toHaveLength(1);
      expect(result[0]!.funcion).toBe("LLENA");
      expect(result[0]!.rol_codigo).toBe("MC");
    });

    it("retorna lista vacía si no hay asignaciones", async () => {
      prisma.$queryRaw.mockResolvedValue([] as never);
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.list({ tipDocumentoId: TIPO_DOC_ID });
      expect(result).toHaveLength(0);
    });
  });

  // ── assign ─────────────────────────────────────────────────────────────────

  describe("assign", () => {
    it("NOT_FOUND si el tipo_documento no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.assign({ tipDocumentoId: TIPO_DOC_ID, rolId: ROL_ID, funcion: "LLENA" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("NOT_FOUND si el rol ECE no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TIPO_DOC_ID }] as never); // doc existe
      prisma.$queryRaw.mockResolvedValueOnce([] as never); // rol no existe
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.assign({ tipDocumentoId: TIPO_DOC_ID, rolId: ROL_ID, funcion: "FIRMA" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("asigna correctamente y retorna {wasNew:true} en primera asignación", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TIPO_DOC_ID }] as never); // doc
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ROL_ID }] as never); // rol
      prisma.$queryRaw.mockResolvedValueOnce([] as never); // prev no existe
      prisma.$queryRaw.mockResolvedValueOnce([DOC_ROL_ROW] as never); // INSERT
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.assign({
        tipDocumentoId: TIPO_DOC_ID,
        rolId: ROL_ID,
        funcion: "LLENA",
        obligatorio: true,
      });
      expect(result.wasNew).toBe(true);
      expect(result.prev).toBeNull();
      expect(result.assigned!.funcion).toBe("LLENA");
    });

    it("asignación idempotente retorna {wasNew:false} si ya existía", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TIPO_DOC_ID }] as never);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ROL_ID }] as never);
      prisma.$queryRaw.mockResolvedValueOnce([DOC_ROL_ROW] as never); // prev existe
      prisma.$queryRaw.mockResolvedValueOnce([DOC_ROL_ROW] as never); // UPSERT
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.assign({
        tipDocumentoId: TIPO_DOC_ID,
        rolId: ROL_ID,
        funcion: "LLENA",
      });
      expect(result.wasNew).toBe(false);
      expect(result.prev).toBeDefined();
    });

    it("lanza BAD_REQUEST si funcion no es valor válido (Zod)", async () => {
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.assign({
          tipDocumentoId: TIPO_DOC_ID,
          rolId: ROL_ID,
          funcion: "EDITA" as never,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── revoke ─────────────────────────────────────────────────────────────────

  describe("revoke", () => {
    it("NOT_FOUND si la asignación no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.revoke({ tipDocumentoId: TIPO_DOC_ID, rolId: ROL_ID, funcion: "LLENA" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("revoca la función y devuelve snapshot en prev", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([DOC_ROL_ROW] as never);
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.revoke({
        tipDocumentoId: TIPO_DOC_ID,
        rolId: ROL_ID,
        funcion: "LLENA",
      });
      expect(result.prev!.funcion).toBe("LLENA");
    });

    it("lanza BAD_REQUEST si funcion no es valor válido (Zod)", async () => {
      const caller = workflowRolRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.revoke({
          tipDocumentoId: TIPO_DOC_ID,
          rolId: ROL_ID,
          funcion: "OTRO" as never,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
