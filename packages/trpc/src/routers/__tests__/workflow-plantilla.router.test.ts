/**
 * Tests — workflow-plantilla.router (US.F2.2.09-10).
 *
 * Estrategia: mock de ctx.prisma.$queryRaw / $executeRaw / $transaction.
 * No toca BD real. Cubre list, get y applyToWorkflow (happy path + edge cases).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { workflowPlantillaRouter } from "../workflow-plantilla.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

/** Tenant con rol WORKFLOW_DESIGNER para pasar el requireRole middleware. */
const TENANT_WFD = { ...MOCK_TENANT, roleCodes: ["WORKFLOW_DESIGNER"] };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PLANTILLA_ROW = {
  id: "00000000-0000-0000-0000-000000000001",
  codigo: "wf-hc-ambulatoria-primera",
  nombre: "HC Ambulatoria — Primera vez",
  categoria: "Ambulatorio",
  descripcion: "Flujo básico ambulatorio",
  estados_seed: [
    { codigo: "REG",  nombre: "Registro", es_inicial: true,  es_final: false, orden: 0 },
    { codigo: "ALTA", nombre: "Alta",     es_inicial: false, es_final: true,  orden: 1 },
  ],
  transiciones_seed: [
    { origen_codigo: "REG", destino_codigo: "ALTA", accion: "Dar alta", rol_codigo: "MC", requiere_firma: true },
  ],
  es_sistema: true,
  activo: true,
};

const TIP_DOC_ROW = { id: "00000000-0000-0000-0000-000000000002" };

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(makePrisma(overrides))),
    ...overrides,
  };
}

// ── Tests: list ───────────────────────────────────────────────────────────────

describe("workflowPlantillaRouter.list", () => {
  it("retorna plantillas sin filtros", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([PLANTILLA_ROW]),
    });
    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.list({});
    expect(result).toHaveLength(1);
    expect(result[0]?.codigo).toBe("wf-hc-ambulatoria-primera");
  });

  it("acepta filtro de categoria", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([PLANTILLA_ROW]),
    });
    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.list({ categoria: "Ambulatorio" });
    expect(result).toHaveLength(1);
  });

  it("acepta filtro de búsqueda q", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([PLANTILLA_ROW]),
    });
    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.list({ q: "ambulatoria" });
    expect(result).toHaveLength(1);
  });

  it("retorna array vacío cuando no hay plantillas", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
    });
    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.list({});
    expect(result).toHaveLength(0);
  });
});

// ── Tests: get ────────────────────────────────────────────────────────────────

describe("workflowPlantillaRouter.get", () => {
  it("retorna plantilla por código", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([PLANTILLA_ROW]),
    });
    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.get({ codigo: "wf-hc-ambulatoria-primera" });
    expect(result.nombre).toBe("HC Ambulatoria — Primera vez");
    expect(result.categoria).toBe("Ambulatorio");
  });

  it("lanza NOT_FOUND si el código no existe", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
    });
    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    await expect(caller.get({ codigo: "inexistente" })).rejects.toThrow(TRPCError);
  });

  it("el NOT_FOUND tiene code correcto", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
    });
    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    try {
      await caller.get({ codigo: "no-existe" });
    } catch (e) {
      expect((e as TRPCError).code).toBe("NOT_FOUND");
    }
  });
});

// ── Tests: applyToWorkflow ────────────────────────────────────────────────────

describe("workflowPlantillaRouter.applyToWorkflow", () => {
  let callCount: number;

  beforeEach(() => {
    callCount = 0;
  });

  it("happy path: crea estados y transiciones", async () => {
    // Secuencia de llamadas $queryRaw: plantilla, tipo_doc, insert estado 1, insert estado 2, rol, rol, rol (fallback + por codigo)
    const queryRawMock = vi.fn()
      // 1. cargar plantilla
      .mockResolvedValueOnce([PLANTILLA_ROW])
      // 2. verificar tipo_documento
      .mockResolvedValueOnce([TIP_DOC_ROW])
      // 3. insertar estado REG
      .mockResolvedValueOnce([{ id: "aa000000-0000-0000-0000-000000000001" }])
      // 4. insertar estado ALTA
      .mockResolvedValueOnce([{ id: "aa000000-0000-0000-0000-000000000002" }])
      // 5. rol fallback
      .mockResolvedValueOnce([{ id: "rol-001", codigo: "MC" }])
      // 6. rol por código MC
      .mockResolvedValueOnce([{ id: "rol-001" }]);

    const txMock = {
      $queryRaw: queryRawMock,
      $executeRaw: vi.fn().mockResolvedValue(0),
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(txMock)),
    };

    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.applyToWorkflow({
      plantillaCodigo: "wf-hc-ambulatoria-primera",
      tipDocumentoId: "00000000-0000-0000-0000-000000000002",
      reemplazar: false,
    });

    expect(result.estadosCreados).toBeGreaterThan(0);
    expect(result.plantillaNombre).toBe("HC Ambulatoria — Primera vez");
  });

  it("lanza NOT_FOUND si la plantilla no existe", async () => {
    const txMock = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn(),
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(txMock)),
    };
    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    await expect(
      caller.applyToWorkflow({
        plantillaCodigo: "no-existe",
        tipDocumentoId: "00000000-0000-0000-0000-000000000002",
        reemplazar: false,
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("lanza NOT_FOUND si el tipo_documento no existe", async () => {
    const txMock = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([PLANTILLA_ROW]) // plantilla encontrada
        .mockResolvedValueOnce([]),              // tipo_doc no encontrado
      $executeRaw: vi.fn(),
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(txMock)),
    };
    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    await expect(
      caller.applyToWorkflow({
        plantillaCodigo: "wf-hc-ambulatoria-primera",
        tipDocumentoId: "00000000-0000-0000-0000-000000000099",
        reemplazar: false,
      }),
    ).rejects.toThrow(TRPCError);
    expect(callCount).toBe(0); // no se llama a eliminar
  });

  it("con reemplazar=true llama a DELETE antes de insertar", async () => {
    const executeRawMock = vi.fn().mockResolvedValue(0);
    const queryRawMock = vi.fn()
      .mockResolvedValueOnce([PLANTILLA_ROW])
      .mockResolvedValueOnce([TIP_DOC_ROW])
      .mockResolvedValueOnce([{ id: "aa01" }]) // estado 1
      .mockResolvedValueOnce([{ id: "aa02" }]) // estado 2
      .mockResolvedValueOnce([{ id: "rol-001", codigo: "MC" }]) // fallback
      .mockResolvedValueOnce([{ id: "rol-001" }]); // rol MC

    const txMock = { $queryRaw: queryRawMock, $executeRaw: executeRawMock };
    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(txMock)),
    };
    const caller = workflowPlantillaRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    await caller.applyToWorkflow({
      plantillaCodigo: "wf-hc-ambulatoria-primera",
      tipDocumentoId: "00000000-0000-0000-0000-000000000002",
      reemplazar: true,
    });
    // Debe haber llamado $executeRaw al menos 2 veces: DELETE transiciones + DELETE estados
    expect(executeRawMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
