/**
 * farmacovigilancia.router.test.ts — Tests del módulo de Farmacovigilancia
 *
 * Estrategia: mock de prisma.$queryRawUnsafe / $executeRawUnsafe.
 * Verifica el ciclo de vida de incidentes: list → acknowledge → escalate.
 * No requiere BD activa.
 *
 * US.F2.6.56-57
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { farmacovigilanciaRouter } from "../farmacovigilancia.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INC_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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
    establecimiento_id: "estab-001",
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

    // Verifica que se llamó con la query
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
// acknowledge
// ---------------------------------------------------------------------------

describe("farmacovigilancia.acknowledge", () => {
  it("cambia status a RECONOCIDO cuando el incidente está PENDIENTE", async () => {
    // Primer call: SELECT status
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([{ status: "PENDIENTE" }]);
    prisma.$executeRawUnsafe = vi.fn().mockResolvedValue(1);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.acknowledge({ incidentId: INC_ID });

    expect(result.ok).toBe(true);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledOnce();
  });

  it("lanza PRECONDITION_FAILED si el incidente no está PENDIENTE", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([{ status: "RECONOCIDO" }]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.acknowledge({ incidentId: INC_ID }),
    ).rejects.toThrow("Solo PENDIENTE puede ser reconocido");
  });

  it("lanza NOT_FOUND si el incidente no existe", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.acknowledge({ incidentId: INC_ID }),
    ).rejects.toThrow("Incidente no encontrado");
  });
});

// ---------------------------------------------------------------------------
// escalate
// ---------------------------------------------------------------------------

describe("farmacovigilancia.escalate", () => {
  it("cambia status a ESCALADO cuando el incidente no está CERRADO", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([
      { status: "RECONOCIDO", tipo: "RECALL_DETECTADO", severity: "CRITICAL" },
    ]);
    // $transaction mock: ejecuta el callback
    prisma.$transaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txMock = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      };
      return fn(txMock);
    });

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.escalate({
      incidentId: INC_ID,
      motivo: "Recall de lote crítico confirmado por MINSAL — escalar a jefe farmacia",
    });

    expect(result.ok).toBe(true);
  });

  it("lanza PRECONDITION_FAILED si el incidente ya está ESCALADO", async () => {
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([
      { status: "ESCALADO", tipo: "ALERGIA_DETECTADA", severity: "HIGH" },
    ]);

    const caller = farmacovigilanciaRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.escalate({
        incidentId: INC_ID,
        motivo: "Motivo de al menos 10 caracteres",
      }),
    ).rejects.toThrow("No se puede escalar");
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
