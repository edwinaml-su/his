/**
 * Regresión de seguridad — OWASP A01:2025 (Broken Access Control).
 *
 * `workflowInbox` lee PHI de ~30 fuentes (prescripciones, triage, labs, imagen,
 * documentos NTEC del schema `ece`…). El rol Postgres de Supabase tiene
 * BYPASSRLS, así que sin `withTenantContext` el aislamiento multi-tenant
 * dependía sólo del filtro JS `organizationId` (hallazgo P1 del pentest
 * 2026-05-30, A01).
 *
 * Estos tests fijan la propiedad de seguridad, no el resultado funcional:
 * cada procedure debe abrir transacción y demotar el rol a `authenticated`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { workflowInboxRouter } from "../workflow-inbox.router";
import { makeCtx } from "../../__tests__/helpers/caller";

describe("workflowInboxRouter — contexto RLS", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let rawCalls: string[];

  /** Modelos Prisma que toca la bandeja; todos devuelven vacío en estos tests. */
  const MODELS = [
    "bed",
    "biomedicalEquipment",
    "drug",
    "ecePatientMerge",
    "encounter",
    "imagingOrder",
    "inpatientAdmission",
    "insuranceClaim",
    "labOrder",
    "medicationAdministration",
    "nutritionOrder",
    "outpatientAppointment",
    "patient",
    "pmSchedule",
    "prescription",
    "prescriptionItem",
    "respiratoryOrder",
    "stockLot",
    "surgeryCase",
    "transfusionRequest",
    "triageEvaluation",
    "user",
  ] as const;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    rawCalls = [];
    prisma.$executeRawUnsafe.mockImplementation(((sql: string) => {
      rawCalls.push(sql);
      return Promise.resolve(0);
    }) as never);
    prisma.$queryRawUnsafe.mockResolvedValue([] as never);
    prisma.$transaction.mockImplementation((async (fn: (tx: unknown) => unknown) =>
      typeof fn === "function" ? fn(prisma) : undefined) as never);
    for (const model of MODELS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (prisma as any)[model];
      m.findMany.mockResolvedValue([]);
      m.count.mockResolvedValue(0);
      m.findFirst.mockResolvedValue(null);
    }
  });

  /** Toda query PHI debe correr tras `SET LOCAL ROLE authenticated`. */
  function expectRlsApplied() {
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(rawCalls.some((s) => s.includes("set_tenant_context"))).toBe(true);
    expect(rawCalls.some((s) => s.includes("SET LOCAL ROLE authenticated"))).toBe(true);
  }

  it("miBandeja abre transacción y demota el rol", async () => {
    const caller = workflowInboxRouter.createCaller(makeCtx({ prisma }));
    await caller.miBandeja();
    expectRlsApplied();
  });

  it("contadorBadge abre transacción y demota el rol", async () => {
    prisma.prescription.count.mockResolvedValue(0 as never);
    const caller = workflowInboxRouter.createCaller(makeCtx({ prisma }));
    await caller.contadorBadge();
    expectRlsApplied();
  });

  it("historialTarea abre transacción y demota el rol", async () => {
    const caller = workflowInboxRouter.createCaller(makeCtx({ prisma }));
    await caller.historialTarea({ taskId: "PRESCRIPTION_TO_SIGN:abc" });
    expectRlsApplied();
  });

  it("reasignar corre la escritura de auditoría dentro del contexto", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: "u1", fullName: "Ana" } as never);
    const caller = workflowInboxRouter.createCaller(makeCtx({ prisma }));
    await caller.reasignar({
      taskId: "PRESCRIPTION_TO_SIGN:abc",
      taskType: "PRESCRIPTION_TO_SIGN",
      targetUserId: "3f1c9d4e-2b7a-4c1e-9f3b-1d2e3f4a5b6c",
      reason: "carga desigual",
    });
    expectRlsApplied();
    // El INSERT de WorkflowTaskAction va DESPUÉS del demote, no antes.
    const demoteIdx = rawCalls.findIndex((s) => s.includes("SET LOCAL ROLE authenticated"));
    const insertIdx = rawCalls.findIndex((s) => s.includes("WorkflowTaskAction"));
    expect(insertIdx).toBeGreaterThan(demoteIdx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
