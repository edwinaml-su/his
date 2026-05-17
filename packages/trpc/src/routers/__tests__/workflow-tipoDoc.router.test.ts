/**
 * Tests unitarios del router workflow.tipoDoc.
 *
 * Estrategia de mock:
 *  - withWorkflowContext (Stream 11, forward-dep) se mockea para ejecutar el
 *    callback directamente con el prisma mock, evitando la transacción real.
 *  - ctx.prisma.$queryRaw y $executeRaw se reemplazan por vi.fn().
 *  - El tenant siempre incluye DIR o WORKFLOW_DESIGNER en roleCodes para pasar
 *    requireRole.
 *
 * Cobertura objetivo: happy-paths de list/get/create/deactivate + CONFLICT
 * y NOT_FOUND en create/deactivate.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import type { TRPCContext } from "../../context";
import { workflowTipoDocRouter } from "../workflow-tipoDoc.router";
import { MOCK_USER_ADMIN } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Mock de forward-dependency (Stream 11)
// ---------------------------------------------------------------------------
vi.mock("../../ece/workflow-context", () => ({
  withWorkflowContext: vi.fn(
    async (
      _prisma: unknown,
      _estabId: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => fn(_prisma),
  ),
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

const SAMPLE_ROW = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  codigo: "hoja_emergencia",
  nombre: "Hoja de emergencia",
  tabla_datos: "hoja_emergencia",
  tipo_registro: "transaccional",
  modalidad: "ambulatorio",
  depende_de: null,
  inmutable: false,
  activo: true,
};

function makeQueryRaw(rows: unknown[]) {
  return vi.fn().mockResolvedValue(rows);
}

function makeExecuteRaw() {
  return vi.fn().mockResolvedValue(1);
}

function makePrisma(queryRawRows: unknown[] = [], executeRaw?: Mock) {
  return {
    $queryRaw: makeQueryRaw(queryRawRows),
    $executeRaw: executeRaw ?? makeExecuteRaw(),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(this)),
  };
}

function makeCtx(overrides: { queryRawRows?: unknown[]; executeRaw?: Mock } = {}): TRPCContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = makePrisma(overrides.queryRawRows ?? [], overrides.executeRaw) as any;
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

describe("workflowTipoDocRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("retorna filas de ece.tipo_documento", async () => {
      const ctx = makeCtx({ queryRawRows: [SAMPLE_ROW] });
      const caller = workflowTipoDocRouter.createCaller(ctx);

      const result = await caller.list({});

      expect(result).toHaveLength(1);
      expect(result[0].codigo).toBe("hoja_emergencia");
    });

    it("retorna lista vacía si no hay registros", async () => {
      const ctx = makeCtx({ queryRawRows: [] });
      const caller = workflowTipoDocRouter.createCaller(ctx);

      const result = await caller.list({ soloActivos: false });

      expect(result).toHaveLength(0);
    });
  });

  describe("get", () => {
    it("retorna el registro cuando existe", async () => {
      const ctx = makeCtx({ queryRawRows: [SAMPLE_ROW] });
      const caller = workflowTipoDocRouter.createCaller(ctx);

      const result = await caller.get({ id: SAMPLE_ROW.id });

      expect(result.codigo).toBe(SAMPLE_ROW.codigo);
    });

    it("lanza NOT_FOUND cuando no existe", async () => {
      const ctx = makeCtx({ queryRawRows: [] });
      const caller = workflowTipoDocRouter.createCaller(ctx);

      await expect(
        caller.get({ id: "aaaaaaaa-0000-0000-0000-000000000099" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("create", () => {
    it("crea correctamente cuando el código no existe", async () => {
      // $queryRaw se llama dos veces: primero EXISTS check (vacío), luego RETURNING
      const prisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([])          // código no existe
          .mockResolvedValue([SAMPLE_ROW]),   // INSERT RETURNING
        $executeRaw: makeExecuteRaw(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const ctx: TRPCContext = {
        prisma,
        user: MOCK_USER_ADMIN,
        tenant: TENANT_DIR,
        portalAccount: null,
        ip: "127.0.0.1",
      };

      const caller = workflowTipoDocRouter.createCaller(ctx);
      const result = await caller.create({
        codigo: "hoja_emergencia",
        nombre: "Hoja de emergencia",
        tablaDatos: "hoja_emergencia",
        tipoRegistro: "transaccional",
        modalidad: "ambulatorio",
      });

      expect(result.codigo).toBe("hoja_emergencia");
    });

    it("lanza CONFLICT si el código ya existe", async () => {
      const prisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: SAMPLE_ROW.id }]), // código ya existe
        $executeRaw: makeExecuteRaw(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const ctx: TRPCContext = {
        prisma,
        user: MOCK_USER_ADMIN,
        tenant: TENANT_DIR,
        portalAccount: null,
      };

      const caller = workflowTipoDocRouter.createCaller(ctx);
      await expect(
        caller.create({
          codigo: "hoja_emergencia",
          nombre: "Duplicado",
          tablaDatos: "hoja_emergencia",
          tipoRegistro: "transaccional",
          modalidad: "ambulatorio",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza BAD_REQUEST si una dependencia no existe", async () => {
      const prisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([])   // código no existe (ok)
          .mockResolvedValue([]),      // dependencia no existe
        $executeRaw: makeExecuteRaw(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const ctx: TRPCContext = {
        prisma,
        user: MOCK_USER_ADMIN,
        tenant: TENANT_DIR,
        portalAccount: null,
      };

      const caller = workflowTipoDocRouter.createCaller(ctx);
      await expect(
        caller.create({
          codigo: "nueva_hoja",
          nombre: "Nueva hoja",
          tablaDatos: "nueva_hoja",
          tipoRegistro: "transaccional",
          modalidad: "ambulatorio",
          dependeDe: ["tipo_inexistente"],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("lanza BAD_REQUEST si dependeDe contiene el mismo código", async () => {
      const prisma = {
        $queryRaw: vi.fn().mockResolvedValueOnce([]), // código no existe (ok)
        $executeRaw: makeExecuteRaw(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const ctx: TRPCContext = {
        prisma,
        user: MOCK_USER_ADMIN,
        tenant: TENANT_DIR,
        portalAccount: null,
      };

      const caller = workflowTipoDocRouter.createCaller(ctx);
      await expect(
        caller.create({
          codigo: "self_ref",
          nombre: "Auto-referencia",
          tablaDatos: "self_ref",
          tipoRegistro: "maestro",
          modalidad: "ambos",
          dependeDe: ["self_ref"],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("deactivate", () => {
    it("desactiva el registro correctamente", async () => {
      const deactivatedRow = { ...SAMPLE_ROW, activo: false };
      const prisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([{ activo: true }])  // EXISTS + activo check
          .mockResolvedValue([deactivatedRow]),         // UPDATE RETURNING
        $executeRaw: makeExecuteRaw(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const ctx: TRPCContext = {
        prisma,
        user: MOCK_USER_ADMIN,
        tenant: TENANT_DIR,
        portalAccount: null,
      };

      const caller = workflowTipoDocRouter.createCaller(ctx);
      const result = await caller.deactivate({ id: SAMPLE_ROW.id });

      expect(result.activo).toBe(false);
    });

    it("lanza NOT_FOUND si el tipo de documento no existe", async () => {
      const ctx = makeCtx({ queryRawRows: [] });
      const caller = workflowTipoDocRouter.createCaller(ctx);

      await expect(
        caller.deactivate({ id: "aaaaaaaa-0000-0000-0000-000000000099" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lanza CONFLICT si ya está inactivo", async () => {
      const prisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ activo: false }]),
        $executeRaw: makeExecuteRaw(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const ctx: TRPCContext = {
        prisma,
        user: MOCK_USER_ADMIN,
        tenant: TENANT_DIR,
        portalAccount: null,
      };

      const caller = workflowTipoDocRouter.createCaller(ctx);
      await expect(
        caller.deactivate({ id: SAMPLE_ROW.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("requireRole", () => {
    it("lanza FORBIDDEN si el tenant no tiene DIR ni WORKFLOW_DESIGNER", async () => {
      const ctx = makeCtx();
      // Sobreescribir tenant con roles insuficientes
      ctx.tenant = {
        ...TENANT_DIR,
        roleCodes: ["NURSE"],
      };

      const caller = workflowTipoDocRouter.createCaller(ctx);
      await expect(caller.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
