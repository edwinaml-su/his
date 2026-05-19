/**
 * farmacovigilancia.router.test.ts — Tests del módulo de Farmacovigilancia
 *
 * Estrategia: mock de prisma.$queryRawUnsafe / $executeRawUnsafe / $transaction.
 * Verifica el ciclo de vida de incidentes: list → create → acknowledge → escalate.
 * No requiere BD activa.
 *
 * HI-23: create / acknowledge / escalate usan withTenantContext (RLS demote).
 * HI-24: escalate emite farmacovigilancia.escalado al outbox (emitDomainEvent).
 *
 * US.F2.6.56-58
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { farmacovigilanciaRouter } from "../farmacovigilancia.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Mock de emitDomainEvent — interceptado antes de importar el router
// ---------------------------------------------------------------------------

vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

import { emitDomainEvent } from "@his/database";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INC_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_ID = MOCK_TENANT.organizationId;

function makeIncidentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INC_ID,
    tipo: "ALERGIA_DETECTADA",
    severity: "HIGH",
    patient_id: null,
    gtin: "07501000001234",
    gsrn_enfermera: null,
    payload: { allergyId: "allergy-001" },
    detected_at: new Date("2026-05-18T10:00:00Z"),
    acknowledged_at: null,
    acknowledged_by_id: null,
    escalated_at: null,
    escalation_motivo: null,
    status: "PENDIENTE",
    establecimiento_id: ORG_ID,
    domain_event_id: null,
    creado_en: new Date("2026-05-18T10:00:00Z"),
    actualizado_en: new Date("2026-05-18T10:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  vi.mocked(emitDomainEvent).mockClear();

  // withTenantContext llama $transaction internamente; lo mockeamos para
  // ejecutar el callback directamente sobre el mismo mock de prisma.
  prisma.$transaction.mockImplementation(async (fn) => {
    if (typeof fn === "function") return fn(prisma as unknown as PrismaClient);
    return fn;
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("farmacovigilancia.list", () => {
  it("devuelve lista mapeada de incidentes", async () => {
    const rows = [makeIncidentRow(), makeIncidentRow({ id: "bbb-bbb", severity: "CRITICAL" })];
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue(rows);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.list({ limit: 50, offset: 0 });

    expect(result).toHaveLength(2);
    expect(result[0]!.tipo).toBe("ALERGIA_DETECTADA");
    expect(result[1]!.severity).toBe("CRITICAL");
  });

  it("mapea snake_case a camelCase", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([makeIncidentRow()]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    const [inc] = await caller.list({ limit: 50, offset: 0 });

    expect(inc).toHaveProperty("detectedAt");
    expect(inc).toHaveProperty("patientId");
    expect(inc).toHaveProperty("gsrnEnfermera");
    expect(inc).toHaveProperty("domainEventId");
    // No debe tener snake_case
    expect(inc).not.toHaveProperty("detected_at");
  });

  it("filtra por status PENDIENTE", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([makeIncidentRow()]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    await caller.list({ limit: 50, offset: 0, status: "PENDIENTE" });

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("farmacovigilancia.get", () => {
  it("devuelve el incidente por id", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([makeIncidentRow()]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    const inc = await caller.get({ id: INC_ID });

    expect(inc.id).toBe(INC_ID);
    expect(inc.tipo).toBe("ALERGIA_DETECTADA");
  });

  it("lanza NOT_FOUND si no existe", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.get({ id: INC_ID })).rejects.toThrow("Incidente no encontrado");
  });
});

// ---------------------------------------------------------------------------
// create — HI-23: RLS demote activo
// ---------------------------------------------------------------------------

describe("farmacovigilancia.create", () => {
  it("HI-23: ejecuta dentro de withTenantContext ($transaction invocado)", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([{ id: INC_ID }]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.create({
      tipo: "RECALL_DETECTADO",
      severity: "HIGH",
      payload: {},
    });

    // withTenantContext abre una transacción → $transaction debe haberse llamado
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(result.id).toBe(INC_ID);
  });
});

// ---------------------------------------------------------------------------
// acknowledge — HI-23: filtro tenant + RLS
// ---------------------------------------------------------------------------

describe("farmacovigilancia.acknowledge", () => {
  it("cambia status a RECONOCIDO cuando el incidente pertenece al tenant y está PENDIENTE", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([{ status: "PENDIENTE" }]);
    prisma.$executeRawUnsafe = vi.fn().mockResolvedValue(1);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.acknowledge({ incidentId: INC_ID });

    expect(result.ok).toBe(true);
    // withTenantContext abre una transacción → $transaction invocado
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    // withTenantContext llama $executeRawUnsafe para set_tenant_context + SET LOCAL ROLE
    // más el UPDATE de la mutación — mínimo 3 llamadas
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    // El último call debe ser el UPDATE de reconocimiento
    const calls = vi.mocked(prisma.$executeRawUnsafe).mock.calls;
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[0]).toContain("UPDATE ece.farmacovigilancia_incident");
    expect(lastCall[0]).toContain("RECONOCIDO");
  });

  it("HI-23: cross-tenant → NOT_FOUND (el SELECT filtra por establecimiento_id)", async () => {
    // Simula que la fila no existe para ese establecimiento_id → array vacío
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.acknowledge({ incidentId: INC_ID }),
    ).rejects.toThrow("Incidente no encontrado");

    // El UPDATE no debe ejecutarse — solo los calls de withTenantContext (set_tenant_context + ROLE)
    const updateCalls = vi.mocked(prisma.$executeRawUnsafe).mock.calls.filter(
      (c) => String(c[0]).includes("UPDATE"),
    );
    expect(updateCalls).toHaveLength(0);
  });

  it("lanza PRECONDITION_FAILED si el incidente no está PENDIENTE", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([{ status: "RECONOCIDO" }]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.acknowledge({ incidentId: INC_ID }),
    ).rejects.toThrow("Solo PENDIENTE puede ser reconocido");
  });
});

// ---------------------------------------------------------------------------
// escalate — HI-23 + HI-24
// ---------------------------------------------------------------------------

describe("farmacovigilancia.escalate", () => {
  it("HI-24: emite farmacovigilancia.escalado con shape correcto", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([
      { status: "RECONOCIDO", severity: "CRITICAL" },
    ]);
    prisma.$executeRawUnsafe = vi.fn().mockResolvedValue(1);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.escalate({
      incidentId: INC_ID,
      motivo: "Recall de lote crítico confirmado por MINSAL — escalar a jefe farmacia",
    });

    expect(result.ok).toBe(true);

    // Verifica que emitDomainEvent fue llamado con el shape exacto
    expect(emitDomainEvent).toHaveBeenCalledOnce();
    const [, eventArg] = vi.mocked(emitDomainEvent).mock.calls[0]!;
    expect(eventArg.eventType).toBe("farmacovigilancia.escalado");
    expect(eventArg.aggregateType).toBe("FarmacovigilanciaIncident");
    expect(eventArg.aggregateId).toBe(INC_ID);
    expect(eventArg.payload).toMatchObject({
      incidentId: INC_ID,
      severidad: "CRITICAL",
      motivo: "Recall de lote crítico confirmado por MINSAL — escalar a jefe farmacia",
      establecimientoId: ORG_ID,
    });
    expect(typeof (eventArg.payload as Record<string, unknown>).escaladoEn).toBe("string");
  });

  it("HI-23: cross-tenant → NOT_FOUND (el SELECT filtra por establecimiento_id)", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.escalate({
        incidentId: INC_ID,
        motivo: "Motivo de al menos 10 caracteres",
      }),
    ).rejects.toThrow("Incidente no encontrado");

    expect(emitDomainEvent).not.toHaveBeenCalled();
  });

  it("lanza PRECONDITION_FAILED si el incidente ya está ESCALADO", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([
      { status: "ESCALADO", severity: "HIGH" },
    ]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.escalate({
        incidentId: INC_ID,
        motivo: "Motivo de al menos 10 caracteres",
      }),
    ).rejects.toThrow("No se puede escalar");

    expect(emitDomainEvent).not.toHaveBeenCalled();
  });

  it("lanza error de validación Zod si motivo < 10 caracteres", async () => {
    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.escalate({ incidentId: INC_ID, motivo: "corto" }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// recallImpact — trazabilidad inversa (US.F2.6.57)
// ---------------------------------------------------------------------------

describe("farmacovigilancia.recallImpact", () => {
  it("retorna totalAdminstraciones y lista de eventos EPCIS del lote", async () => {
    const epcisRows = [
      {
        id: "event-001",
        event_time: new Date("2026-05-10T08:00:00Z"),
        who: { sourceList: [{ gsrn: "801874130000000002" }] },
        where_data: { readPoint: "urn:epc:id:sgln:7413000000010" },
        subtipo: "BEDSIDE_ADMIN",
      },
      {
        id: "event-002",
        event_time: new Date("2026-05-11T09:00:00Z"),
        who: { sourceList: [] },
        where_data: { readPoint: "urn:epc:id:sgln:7413000000010" },
        subtipo: "BEDSIDE_ADMIN",
      },
    ];
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue(epcisRows);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.recallImpact({
      gtin: "07501000001234",
      lote: "L2024A",
      diasAtras: 30,
    });

    expect(result.gtin).toBe("07501000001234");
    expect(result.lote).toBe("L2024A");
    expect(result.totalAdminstraciones).toBe(2);
    expect(result.eventos).toHaveLength(2);
    expect(result.eventos[0]!.id).toBe("event-001");
  });
});
