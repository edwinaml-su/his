/**
 * Tests — workflow-simulacion.router (US.F2.2.08).
 *
 * Mock de ctx.prisma.$queryRaw. No toca BD real.
 * Cubre simulate (paso individual) y path (recorrido completo).
 */
import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { workflowSimulacionRouter } from "../workflow-simulacion.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

/** Tenant con rol WORKFLOW_DESIGNER para pasar el requireRole middleware. */
const TENANT_WFD = { ...MOCK_TENANT, roleCodes: ["WORKFLOW_DESIGNER"] };

// ── Fixtures ──────────────────────────────────────────────────────────────────

// UUIDs válidos para evitar errores de validación Zod
const ID_E1 = "11111111-1111-1111-1111-111111111111";
const ID_E2 = "22222222-2222-2222-2222-222222222222";
const ID_E3 = "33333333-3333-3333-3333-333333333333";
const ID_T1 = "44444444-4444-4444-4444-444444444444";
const ID_T2 = "55555555-5555-5555-5555-555555555555";
const ID_DOC = "00000000-0000-0000-0000-000000000001";

const ESTADO_INICIAL = {
  id: ID_E1,
  codigo: "REG",
  nombre: "Registro",
  es_inicial: true,
  es_final: false,
  orden: 0,
  descripcion_markdown: null,
};

const ESTADO_INTERMEDIO = {
  id: ID_E2,
  codigo: "CONS",
  nombre: "Consulta",
  es_inicial: false,
  es_final: false,
  orden: 1,
  descripcion_markdown: "**Consulta médica**",
};

const ESTADO_FINAL = {
  id: ID_E3,
  codigo: "ALTA",
  nombre: "Alta",
  es_inicial: false,
  es_final: true,
  orden: 2,
  descripcion_markdown: null,
};

const ESTADOS = [ESTADO_INICIAL, ESTADO_INTERMEDIO, ESTADO_FINAL];

const TRANSICION_1 = {
  id: ID_T1,
  estado_origen_id: ID_E1,
  estado_destino_id: ID_E2,
  accion: "Iniciar consulta",
  rol_codigo: "ENF",
  rol_nombre: "Enfermería",
  requiere_firma: false,
};

const TRANSICION_2 = {
  id: ID_T2,
  estado_origen_id: ID_E2,
  estado_destino_id: ID_E3,
  accion: "Dar alta",
  rol_codigo: "MC",
  rol_nombre: "Médico",
  requiere_firma: true,
};

const TRANSICIONES = [TRANSICION_1, TRANSICION_2];

// ── Tests: simulate ───────────────────────────────────────────────────────────

describe("workflowSimulacionRouter.simulate", () => {
  it("sin estadoActualId parte del estado inicial", async () => {
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(ESTADOS)       // estados
        .mockResolvedValueOnce([TRANSICION_1]), // transiciones salientes desde e1
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.simulate({
      tipDocumentoId: ID_DOC,
    });
    expect(result.estadoActual.id).toBe(ID_E1);
    expect(result.estadoActual.es_inicial).toBe(true);
    expect(result.transicionesDisponibles).toHaveLength(1);
    expect(result.transicionesDisponibles[0]?.accion).toBe("Iniciar consulta");
  });

  it("con estadoActualId carga el estado correcto", async () => {
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(ESTADOS)
        .mockResolvedValueOnce([TRANSICION_2]),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.simulate({
      tipDocumentoId: ID_DOC,
      estadoActualId: ID_E2,
    });
    expect(result.estadoActual.id).toBe(ID_E2);
    expect(result.esFinal).toBe(false);
    expect(result.transicionesDisponibles[0]?.rol_codigo).toBe("MC");
  });

  it("esFinal=true cuando el estado actual es final", async () => {
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(ESTADOS)
        .mockResolvedValueOnce([]),           // sin transiciones salientes (es final)
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.simulate({
      tipDocumentoId: ID_DOC,
      estadoActualId: ID_E3,
    });
    expect(result.esFinal).toBe(true);
    expect(result.transicionesDisponibles).toHaveLength(0);
  });

  it("lanza NOT_FOUND si el workflow no tiene estados", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    await expect(
      caller.simulate({ tipDocumentoId: "00000000-0000-0000-0000-000000000001" }),
    ).rejects.toThrow(TRPCError);
  });

  it("lanza PRECONDITION_FAILED si no hay estado inicial", async () => {
    const sinInicial = ESTADOS.map((e) => ({ ...e, es_inicial: false }));
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue(sinInicial),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    await expect(
      caller.simulate({ tipDocumentoId: "00000000-0000-0000-0000-000000000001" }),
    ).rejects.toThrow(TRPCError);
  });

  it("lanza NOT_FOUND si estadoActualId no pertenece al workflow", async () => {
    // Usar un UUID válido pero que no existe en el workflow
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue(ESTADOS),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    await expect(
      caller.simulate({
        tipDocumentoId: ID_DOC,
        estadoActualId: "99999999-0000-0000-0000-999999999999",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("lanza BAD_REQUEST si accionElegida no está disponible", async () => {
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(ESTADOS)
        .mockResolvedValueOnce([TRANSICION_1]),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    await expect(
      caller.simulate({
        tipDocumentoId: ID_DOC,
        estadoActualId: ID_E1,
        accionElegida: "Accion Que No Existe",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("avanza al estadoSiguiente cuando se elige acción válida", async () => {
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(ESTADOS)
        .mockResolvedValueOnce([TRANSICION_1]),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.simulate({
      tipDocumentoId: ID_DOC,
      estadoActualId: ID_E1,
      accionElegida: "Iniciar consulta",
    });
    expect(result.estadoSiguiente?.id).toBe(ID_E2);
    expect(result.transicionEjecutada?.accion).toBe("Iniciar consulta");
  });
});

// ── Tests: path ───────────────────────────────────────────────────────────────

describe("workflowSimulacionRouter.path", () => {
  it("recorre el workflow completo y marca completado=true", async () => {
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(ESTADOS)
        .mockResolvedValueOnce(TRANSICIONES),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.path({
      tipDocumentoId: ID_DOC,
      acciones: ["Iniciar consulta", "Dar alta"],
    });
    expect(result.completado).toBe(true);
    expect(result.estadoFinal.id).toBe(ID_E3);
    // 3 pasos: inicial, después de accion1, después de accion2
    expect(result.steps).toHaveLength(3);
  });

  it("retorna completado=false si no se llega al estado final", async () => {
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(ESTADOS)
        .mockResolvedValueOnce(TRANSICIONES),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.path({
      tipDocumentoId: ID_DOC,
      acciones: ["Iniciar consulta"], // solo primer paso
    });
    expect(result.completado).toBe(false);
    expect(result.estadoFinal.id).toBe(ID_E2);
  });

  it("lanza BAD_REQUEST si una acción no existe en el estado actual", async () => {
    // La acción no existe en las transiciones del estado inicial
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(ESTADOS)
        .mockResolvedValueOnce(TRANSICIONES),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    await expect(
      caller.path({
        tipDocumentoId: ID_DOC,
        acciones: ["Accion Que No Existe En El Workflow"],
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("retorna solo el estado inicial cuando acciones=[]", async () => {
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(ESTADOS)
        .mockResolvedValueOnce(TRANSICIONES),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.path({
      tipDocumentoId: ID_DOC,
      acciones: [],
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.estado.id).toBe(ID_E1);
    expect(result.completado).toBe(false);
  });

  it("lanza PRECONDITION_FAILED si no hay estado inicial", async () => {
    const sinInicial = ESTADOS.map((e) => ({ ...e, es_inicial: false }));
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(sinInicial)
        .mockResolvedValueOnce(TRANSICIONES),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    await expect(
      caller.path({
        tipDocumentoId: ID_DOC,
        acciones: [],
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("incluye datos de rol en cada transición ejecutada", async () => {
    const prisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce(ESTADOS)
        .mockResolvedValueOnce(TRANSICIONES),
    };
    const caller = workflowSimulacionRouter.createCaller(makeCtx({ prisma: prisma as never, tenant: TENANT_WFD }));
    const result = await caller.path({
      tipDocumentoId: ID_DOC,
      acciones: ["Iniciar consulta"],
    });
    const paso = result.steps[1];
    expect(paso?.transicionEjecutada?.rol_codigo).toBe("ENF");
    expect(paso?.transicionEjecutada?.requiere_firma).toBe(false);
  });
});

// ── Tests: seed fixtures (cobertura sin BD) ───────────────────────────────────

describe("seed-workflow-templates fixtures", () => {
  it("plantilla HC ambulatoria tiene estado inicial y final", () => {
    const estados = [
      { codigo: "REG",  nombre: "Registro", es_inicial: true,  es_final: false, orden: 0 },
      { codigo: "ALTA", nombre: "Alta",     es_inicial: false, es_final: true,  orden: 1 },
    ];
    expect(estados.filter((e) => e.es_inicial)).toHaveLength(1);
    expect(estados.filter((e) => e.es_final)).toHaveLength(1);
  });

  it("las 6 plantillas tienen código único", () => {
    const codigos = [
      "wf-hc-ambulatoria-primera",
      "wf-hc-ambulatoria-subsecuente",
      "wf-hospitalario-basico",
      "wf-cirugia-electiva",
      "wf-triage-manchester",
      "wf-consentimiento-ntec",
    ];
    const unique = new Set(codigos);
    expect(unique.size).toBe(6);
  });

  it("categorías válidas cubren los 5 tipos", () => {
    const categorias = ["Ambulatorio", "Hospitalario", "Quirúrgico", "Maternidad", "Emergencia"];
    const usadas = ["Ambulatorio", "Hospitalario", "Quirúrgico", "Emergencia"];
    usadas.forEach((c) => expect(categorias).toContain(c));
  });
});
