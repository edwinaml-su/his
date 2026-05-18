/**
 * Tests RBAC — US.F2.2.14 Control de acceso por rol Workflow Designer / DIR
 *
 * Verifica que los routers de workflow:
 *  - Rechazan con FORBIDDEN a usuarios sin DIR/WORKFLOW_DESIGNER.
 *  - Permiten el acceso a usuarios con WORKFLOW_DESIGNER.
 *  - Permiten el acceso a usuarios con DIR.
 *  - Rechazan acceso sin tenant (FORBIDDEN tenantProcedure).
 *  - Rechazan acceso sin usuario autenticado (UNAUTHORIZED).
 *
 * Nota: las mutations de DB están mockeadas para que los tests solo verifiquen
 * la capa de autenticación/autorización, no la lógica de negocio.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { workflowEstadoRouter } from "../workflow-estado.router";
import { workflowTransicionRouter } from "../workflow-transicion.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TIPO_DOC_ID = "00000000-0000-0000-0000-000000000001";

const TENANT_WORKFLOW_DESIGNER = { ...MOCK_TENANT, roleCodes: ["WORKFLOW_DESIGNER"] };
const TENANT_DIR = { ...MOCK_TENANT, roleCodes: ["DIR"] };
const TENANT_BOTH = { ...MOCK_TENANT, roleCodes: ["DIR", "WORKFLOW_DESIGNER"] };
const TENANT_READONLY = { ...MOCK_TENANT, roleCodes: ["MC", "ENF", "PHYSICIAN"] };
const TENANT_EMPTY_ROLES = { ...MOCK_TENANT, roleCodes: [] };

// ─── Suite principal ──────────────────────────────────────────────────────────

describe("US.F2.2.14 — RBAC Workflow Designer", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // Mock mínimo para que las queries de lista no fallen en la capa DB
    prisma.$queryRaw.mockResolvedValue([]);
  });

  // ── workflowEstado.estado.list ─────────────────────────────────────────────

  describe("workflowEstado.estado.list", () => {
    it("permite acceso con WORKFLOW_DESIGNER", async () => {
      const caller = workflowEstadoRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_WORKFLOW_DESIGNER }),
      );
      await expect(
        caller.estado.list({ tipDocumentoId: TIPO_DOC_ID }),
      ).resolves.toEqual([]);
    });

    it("permite acceso con DIR", async () => {
      const caller = workflowEstadoRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.estado.list({ tipDocumentoId: TIPO_DOC_ID }),
      ).resolves.toEqual([]);
    });

    it("permite acceso con DIR + WORKFLOW_DESIGNER combinados", async () => {
      const caller = workflowEstadoRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_BOTH }),
      );
      await expect(
        caller.estado.list({ tipDocumentoId: TIPO_DOC_ID }),
      ).resolves.toEqual([]);
    });

    it("rechaza con FORBIDDEN a usuario con roles MC/ENF", async () => {
      const caller = workflowEstadoRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_READONLY }),
      );
      await expect(
        caller.estado.list({ tipDocumentoId: TIPO_DOC_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rechaza con FORBIDDEN a usuario sin roles", async () => {
      const caller = workflowEstadoRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_EMPTY_ROLES }),
      );
      await expect(
        caller.estado.list({ tipDocumentoId: TIPO_DOC_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rechaza con FORBIDDEN cuando no hay tenant (sin organización)", async () => {
      const caller = workflowEstadoRouter.createCaller(
        makeCtx({ prisma, tenant: null }),
      );
      await expect(
        caller.estado.list({ tipDocumentoId: TIPO_DOC_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rechaza con UNAUTHORIZED cuando no hay usuario autenticado", async () => {
      const caller = workflowEstadoRouter.createCaller(
        makeCtx({ prisma, user: null, tenant: null }),
      );
      await expect(
        caller.estado.list({ tipDocumentoId: TIPO_DOC_ID }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ── workflowTransicion.list ────────────────────────────────────────────────

  describe("workflowTransicionRouter.list", () => {
    it("permite acceso con WORKFLOW_DESIGNER", async () => {
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_WORKFLOW_DESIGNER }),
      );
      await expect(
        caller.list({ tipDocumentoId: TIPO_DOC_ID }),
      ).resolves.toEqual([]);
    });

    it("rechaza con FORBIDDEN a usuario con roles de solo lectura", async () => {
      const caller = workflowTransicionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_READONLY }),
      );
      await expect(
        caller.list({ tipDocumentoId: TIPO_DOC_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── Mutations requieren el mismo guard ────────────────────────────────────

  describe("workflowEstado.estado.create — FORBIDDEN para roles no editores", () => {
    it("ENF no puede crear estados", async () => {
      const caller = workflowEstadoRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["ENF"] } }),
      );
      await expect(
        caller.estado.create({
          tipDocumentoId: TIPO_DOC_ID,
          codigo: "EST_TEST",
          nombre: "Estado test",
          esInicial: false,
          esFinal: false,
          orden: 1,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("WORKFLOW_DESIGNER puede invocar create (llega a validación DB)", async () => {
      // La query de validación tipo_documento devuelve vacío → NOT_FOUND, no FORBIDDEN
      prisma.$queryRaw.mockResolvedValueOnce([]); // tipo_doc no encontrado
      const caller = workflowEstadoRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_WORKFLOW_DESIGNER }),
      );
      await expect(
        caller.estado.create({
          tipDocumentoId: TIPO_DOC_ID,
          codigo: "EST_TEST",
          nombre: "Estado test",
          esInicial: false,
          esFinal: false,
          orden: 1,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" }); // pasa el RBAC, falla en DB
    });
  });
});
