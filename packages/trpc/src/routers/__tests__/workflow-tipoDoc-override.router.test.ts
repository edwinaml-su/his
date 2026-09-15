/**
 * Tests unitarios del router workflow.tipoDocOverride.
 *
 * CC-0033 (P0-2): este router no tenía suite — se agrega junto con el fix de
 * `withWorkflowContext` (antes stub `ece/workflow-context.ts` sin SET LOCAL ni
 * demote de rol, ahora `workflow/context.ts`, el mismo que ya corre en
 * ~30 routers ECE en producción).
 *
 * Estrategia de mock: idéntica a `workflow-tipoDoc.router.test.ts` — se
 * mockea `withWorkflowContext` para ejecutar el callback con el prisma mock
 * y se verifica que se invoque con el `EceContext` correcto (personalId +
 * establecimientoId + roles derivados de ctx.tenant).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TRPCContext } from "../../context";
import { workflowTipoDocOverrideRouter } from "../workflow-tipoDoc-override.router";
import { MOCK_USER_ADMIN } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Mock de withWorkflowContext real (packages/trpc/src/workflow/context.ts)
// ---------------------------------------------------------------------------
const withWorkflowContextMock = vi.fn(
  async (
    _prisma: unknown,
    _eceCtx: unknown,
    fn: (tx: unknown) => Promise<unknown>,
  ) => fn(_prisma),
);
vi.mock("../../workflow/context", () => ({
  withWorkflowContext: (...args: unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (withWorkflowContextMock as any)(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_DIR = {
  userId: MOCK_USER_ADMIN.id,
  organizationId: "00000000-0000-0000-0000-0000000000aa",
  countryId: "00000000-0000-0000-0000-0000000000bb",
  establishmentId: "00000000-0000-0000-0000-0000000000cc",
  roleCodes: ["DIR"],
};

const TIPO_DOC_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const OVERRIDE_ROW = {
  tipo_documento_id: TIPO_DOC_ID,
  establecimiento_id: TENANT_DIR.establishmentId,
  tipo_codigo: "hoja_emergencia",
  tipo_nombre: "Hoja de emergencia",
  activo_override: true,
  obligatorio_override: null,
  depende_de_override: null,
  nota_dir: null,
  creado_por: MOCK_USER_ADMIN.id,
  creado_en: new Date("2026-09-15T00:00:00Z"),
  actualizado_por: null,
  actualizado_en: null,
};

function makePrisma(queryRawRows: unknown[] = []) {
  let callCount = 0;
  return {
    $queryRaw: vi.fn().mockImplementation(() => {
      const val = queryRawRows[callCount] ?? [];
      callCount++;
      return Promise.resolve(val);
    }),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
}

function makeCtx(overrides: { queryRawRows?: unknown[] } = {}): TRPCContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = makePrisma(overrides.queryRawRows ?? []) as any;
  return {
    prisma,
    user: MOCK_USER_ADMIN,
    tenant: TENANT_DIR,
    portalAccount: null,
    ip: "127.0.0.1",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("workflowTipoDocOverrideRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("retorna los overrides del establecimiento", async () => {
      const ctx = makeCtx({ queryRawRows: [[OVERRIDE_ROW]] });
      const caller = workflowTipoDocOverrideRouter.createCaller(ctx);

      const result = await caller.list();

      expect(result).toHaveLength(1);
      expect(result[0].tipo_codigo).toBe("hoja_emergencia");
    });

    // CC-0033 (P0-2) — la query debe correr DENTRO del callback de
    // withWorkflowContext (RLS real), no directo sobre ctx.prisma.
    it("ejecuta la query dentro del callback de withWorkflowContext, con el EceContext del tenant", async () => {
      const ctx = makeCtx({ queryRawRows: [[OVERRIDE_ROW]] });
      const caller = workflowTipoDocOverrideRouter.createCaller(ctx);

      await caller.list();

      expect(withWorkflowContextMock).toHaveBeenCalledTimes(1);
      expect(withWorkflowContextMock).toHaveBeenCalledWith(
        ctx.prisma,
        expect.objectContaining({
          personalId: TENANT_DIR.userId,
          establecimientoId: TENANT_DIR.establishmentId,
        }),
        expect.any(Function),
      );
    });
  });

  describe("upsert", () => {
    it("crea/actualiza el override cuando el tipo de documento existe", async () => {
      const ctx = makeCtx({
        queryRawRows: [
          [{ codigo: "hoja_emergencia" }], // validación tipo existe
          [OVERRIDE_ROW], // INSERT ... ON CONFLICT RETURNING
        ],
      });
      const caller = workflowTipoDocOverrideRouter.createCaller(ctx);

      const result = await caller.upsert({
        tipoDocumentoId: TIPO_DOC_ID,
        activoOverride: true,
      });

      expect(result.tipo_documento_id).toBe(TIPO_DOC_ID);
      // CC-0033 (P0-2) — mismo criterio que `list`: verifica el EceContext.
      expect(withWorkflowContextMock).toHaveBeenCalledWith(
        ctx.prisma,
        expect.objectContaining({
          personalId: TENANT_DIR.userId,
          establecimientoId: TENANT_DIR.establishmentId,
        }),
        expect.any(Function),
      );
    });

    it("lanza BAD_REQUEST si el tipo de documento no existe o está inactivo", async () => {
      const ctx = makeCtx({ queryRawRows: [[]] });
      const caller = workflowTipoDocOverrideRouter.createCaller(ctx);

      await expect(
        caller.upsert({ tipoDocumentoId: TIPO_DOC_ID, activoOverride: true }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("remove", () => {
    it("elimina el override", async () => {
      const ctx = makeCtx();
      const caller = workflowTipoDocOverrideRouter.createCaller(ctx);

      const result = await caller.remove({ tipoDocumentoId: TIPO_DOC_ID });

      expect(result).toEqual({ ok: true });
      // CC-0033 (P0-2) — mismo criterio que `list`: verifica el EceContext.
      expect(withWorkflowContextMock).toHaveBeenCalledWith(
        ctx.prisma,
        expect.objectContaining({
          personalId: TENANT_DIR.userId,
          establecimientoId: TENANT_DIR.establishmentId,
        }),
        expect.any(Function),
      );
    });
  });

  describe("requireRole", () => {
    it("lanza FORBIDDEN si el tenant no tiene rol DIR", async () => {
      const ctx = makeCtx();
      ctx.tenant = { ...TENANT_DIR, roleCodes: ["NURSE"] };
      const caller = workflowTipoDocOverrideRouter.createCaller(ctx);

      await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
