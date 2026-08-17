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

  it("H2: miBandeja abre 6 transacciones cortas (no una sola de ~30 queries)", async () => {
    // H2 (P1, pool exhaustion) — antes del fix, miBandeja retenía UNA conexión
    // del pool (Supabase session mode, ~15 conexiones) hasta 20s corriendo
    // sus ~30 queries dentro de un solo `withTenantContext`. Ahora se parte
    // en 6 bloques cortos; cada bloque es su propio `prisma.$transaction`
    // (ver `withTenantContext` en rls-context.ts). Verificamos el conteo de
    // transacciones, no solo que "alguna" transacción se haya abierto.
    const caller = workflowInboxRouter.createCaller(makeCtx({ prisma }));
    await caller.miBandeja();

    expect(prisma.$transaction).toHaveBeenCalledTimes(6);
    // Cada una de las 6 transacciones debe demotar el rol — no basta con que
    // la primera lo haga y las siguientes hereden el bypass.
    const demotes = rawCalls.filter((s) => s.includes("SET LOCAL ROLE authenticated"));
    expect(demotes.length).toBeGreaterThanOrEqual(6);
    // Y cada bloque vuelve a setear el contexto tenant (set_tenant_context),
    // no solo el primero — `SET LOCAL` es scoped a CADA transacción.
    const contextSets = rawCalls.filter((s) => s.includes("set_tenant_context"));
    expect(contextSets.length).toBeGreaterThanOrEqual(6);
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

  it("escalar abre transacción y demota el rol", async () => {
    const caller = workflowInboxRouter.createCaller(makeCtx({ prisma }));
    await caller.escalar({
      taskId: "PRESCRIPTION_TO_SIGN:abc",
      taskType: "PRESCRIPTION_TO_SIGN",
      reason: "carga desigual",
    });
    expectRlsApplied();
  });

  it("completar abre transacción y demota el rol", async () => {
    const caller = workflowInboxRouter.createCaller(makeCtx({ prisma }));
    await caller.completar({
      taskId: "PRESCRIPTION_TO_SIGN:abc",
      taskType: "PRESCRIPTION_TO_SIGN",
      reason: "atendida fuera del flujo normal",
    });
    expectRlsApplied();
  });

  it("comentar abre transacción y demota el rol", async () => {
    const caller = workflowInboxRouter.createCaller(makeCtx({ prisma }));
    await caller.comentar({
      taskId: "PRESCRIPTION_TO_SIGN:abc",
      taskType: "PRESCRIPTION_TO_SIGN",
      reason: "coordinando con turno entrante",
    });
    expectRlsApplied();
  });

  it("actividadEquipo abre transacción y demota el rol", async () => {
    const caller = workflowInboxRouter.createCaller(makeCtx({ prisma }));
    await caller.actividadEquipo({ days: 7 });
    expectRlsApplied();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
