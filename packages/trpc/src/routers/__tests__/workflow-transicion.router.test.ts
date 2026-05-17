/**
 * Tests unitarios del router workflow.transicion.
 *
 * Cubre: list, create (happy path + BAD_REQUEST + CONFLICT + NOT_FOUND),
 *        update (NOT_FOUND + BAD_REQUEST + happy path), delete (NOT_FOUND + happy path).
 * Control de acceso: FORBIDDEN cuando el tenant no tiene DIR/WORKFLOW_DESIGNER.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { workflowTransicionRouter } from "../workflow-transicion.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TIPO_DOC_ID = "00000000-0000-0000-0000-000000000001";
const ESTADO_A_ID = "00000000-0000-0000-0000-000000000002";
const ESTADO_B_ID = "00000000-0000-0000-0000-000000000003";
const TRANSICION_ID = "00000000-0000-0000-0000-000000000004";
const ROL_ID = "00000000-0000-0000-0000-000000000005";

const TRANSICION_ROW = {
  id: TRANSICION_ID,
  tipo_documento_id: TIPO_DOC_ID,
  estado_origen_id: ESTADO_A_ID,
  estado_destino_id: ESTADO_B_ID,
  accion: "firmar",
  rol_autoriza_id: ROL_ID,
  requiere_firma: true,
  rol_codigo: "MC",
  rol_nombre: "Médico Clínico",
};

const WORKFLOW_TENANT = { ...MOCK_TENANT, roleCodes: ["DIR", "WORKFLOW_DESIGNER"] };
const UNPRIVILEGED_TENANT = { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] };

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("workflowTransicionRouter", () => {
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
    const caller = workflowTransicionRouter.createCaller(
      makeCtx({ prisma, tenant: UNPRIVILEGED_TENANT }),
    );
    await expect(
      caller.list({ tipDocumentoId: TIPO_DOC_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("create rechaza usuario sin rol de workflow", async () => {
    const caller = workflowTransicionRouter.createCaller(
      makeCtx({ prisma, tenant: UNPRIVILEGED_TENANT }),
    );
    await expect(
      caller.create({
        tipDocumentoId: TIPO_DOC_ID,
        estadoOrigenId: ESTADO_A_ID,
        estadoDestinoId: ESTADO_B_ID,
        accion: "firmar",
        rolAutorizaId: ROL_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("retorna transiciones enriquecidas con rol_codigo y rol_nombre", async () => {
      prisma.$queryRaw.mockResolvedValue([TRANSICION_ROW] as never);
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.list({ tipDocumentoId: TIPO_DOC_ID });
      expect(result).toHaveLength(1);
      expect(result[0]!.accion).toBe("firmar");
      expect(result[0]!.rol_codigo).toBe("MC");
    });

    it("retorna lista vacía si no hay transiciones", async () => {
      prisma.$queryRaw.mockResolvedValue([] as never);
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.list({ tipDocumentoId: TIPO_DOC_ID });
      expect(result).toHaveLength(0);
    });

    it("lanza BAD_REQUEST si tipDocumentoId no es UUID (Zod)", async () => {
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.list({ tipDocumentoId: "no-uuid" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("BAD_REQUEST si estados no pertenecen al mismo tipo_documento", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ESTADO_A_ID }] as never); // solo 1 de 2
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.create({
          tipDocumentoId: TIPO_DOC_ID,
          estadoOrigenId: ESTADO_A_ID,
          estadoDestinoId: ESTADO_B_ID,
          accion: "firmar",
          rolAutorizaId: ROL_ID,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("CONFLICT si ya existe la acción para el estado origen", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ESTADO_A_ID }, { id: ESTADO_B_ID }] as never);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TRANSICION_ID }] as never); // duplicado
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.create({
          tipDocumentoId: TIPO_DOC_ID,
          estadoOrigenId: ESTADO_A_ID,
          estadoDestinoId: ESTADO_B_ID,
          accion: "firmar",
          rolAutorizaId: ROL_ID,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("NOT_FOUND si el rol autorizador no existe en ece.rol", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ESTADO_A_ID }, { id: ESTADO_B_ID }] as never);
      prisma.$queryRaw.mockResolvedValueOnce([] as never); // sin duplicado
      prisma.$queryRaw.mockResolvedValueOnce([] as never); // rol no existe
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.create({
          tipDocumentoId: TIPO_DOC_ID,
          estadoOrigenId: ESTADO_A_ID,
          estadoDestinoId: ESTADO_B_ID,
          accion: "firmar",
          rolAutorizaId: ROL_ID,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea transición correctamente y retorna {created, prev:null}", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ESTADO_A_ID }, { id: ESTADO_B_ID }] as never);
      prisma.$queryRaw.mockResolvedValueOnce([] as never); // sin duplicado
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ROL_ID }] as never); // rol existe
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never); // INSERT
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.create({
        tipDocumentoId: TIPO_DOC_ID,
        estadoOrigenId: ESTADO_A_ID,
        estadoDestinoId: ESTADO_B_ID,
        accion: "firmar",
        rolAutorizaId: ROL_ID,
      });
      expect(result.created!.accion).toBe("firmar");
      expect(result.prev).toBeNull();
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("NOT_FOUND si la transición no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.update({ id: TRANSICION_ID, requiereFirma: false }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si nuevo estado_destino no pertenece al mismo tipo_documento", async () => {
      const OTRO = "00000000-0000-0000-0000-000000000099";
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never);
      prisma.$queryRaw.mockResolvedValueOnce([] as never); // estado no en mismo tipo_doc
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.update({ id: TRANSICION_ID, estadoDestinoId: OTRO }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("actualiza requiere_firma y devuelve snapshot anterior", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never);
      const actualizada = { ...TRANSICION_ROW, requiere_firma: false };
      prisma.$queryRaw.mockResolvedValueOnce([actualizada] as never);
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.update({ id: TRANSICION_ID, requiereFirma: false });
      expect(result.prev!.requiere_firma).toBe(true);
      expect(result.updated.requiere_firma).toBe(false);
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("NOT_FOUND si la transición no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      await expect(
        caller.delete({ id: TRANSICION_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("elimina la transición y devuelve snapshot en prev", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never);
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: WORKFLOW_TENANT }),
      );
      const result = await caller.delete({ id: TRANSICION_ID });
      expect(result.prev!.accion).toBe("firmar");
    });
  });
});
