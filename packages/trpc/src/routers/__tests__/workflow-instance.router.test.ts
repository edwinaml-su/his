/**
 * Tests del workflowInstanceRouter (Fase 2 — Motor de Workflow ECE, Stream 15).
 *
 * Estrategia:
 *   - Los procedimientos operan sobre tablas ECE via $queryRaw / $executeRaw.
 *   - canTransition y executeTransition son importados de ../workflow/transitions.
 *   - Se mockean via vi.mock para aislar la lógica del router.
 *   - emitDomainEvent se mockea para verificar payload sin tocar Prisma.
 *
 * Cubre: create (estado inicial), get (NOT_FOUND), list (validación), advance
 * (canTransition FORBIDDEN, requiresSignature BAD_REQUEST, happy path),
 * history (paginación cursor).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { workflowInstanceRouter } from "../workflow-instance.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../workflow/transitions", () => ({
  canTransition: vi.fn(),
  executeTransition: vi.fn(),
}));

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "event-id" }),
  };
});

import { canTransition, executeTransition } from "../../workflow/transitions";
import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const INSTANCE_ID = "11111111-1111-1111-1111-111111111111";
const TIPO_ID     = "22222222-2222-2222-2222-222222222222";
const EPISODIO_ID = "33333333-3333-3333-3333-333333333333";
const PACIENTE_ID = "44444444-4444-4444-4444-444444444444";
const ESTADO_ID   = "55555555-5555-5555-5555-555555555555";
const TO_STATE_ID = "66666666-6666-6666-6666-666666666666";
const FIRMA_ID    = "77777777-7777-7777-7777-777777777777";
const ORG_ID      = MOCK_TENANT.organizationId;

const ECE_TENANT = {
  ...MOCK_TENANT,
  establishmentId: "00000000-0000-0000-0000-0000000000cc",
  roleCodes: ["MC", "DIR"],
};

const INSTANCIA_ROW = {
  id: INSTANCE_ID,
  tipo_documento_id: TIPO_ID,
  tipo_codigo: "HIST_CLIN",
  tipo_nombre: "Historia Clínica",
  episodio_id: EPISODIO_ID,
  paciente_id: PACIENTE_ID,
  registro_id: null,
  estado_actual_id: ESTADO_ID,
  estado_codigo: "borrador",
  estado_nombre: "Borrador",
  version: 1,
  estado_registro: "vigente",
  creado_por: "user-id",
  creado_en: new Date("2026-05-16T10:00:00Z"),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEcePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  // Simula withWorkflowContext / executeTransition que abren $transaction
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  // GUC setup dentro de withWorkflowContext
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  prisma.$executeRaw.mockResolvedValue(0 as never);
  return prisma;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("workflowInstanceRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makeEcePrisma();
    vi.clearAllMocks();
  });

  // ─── instance.create ──────────────────────────────────────────────────────

  describe("instance.create", () => {
    it("crea instancia con el estado inicial cuando existe", async () => {
      // Estado inicial
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: ESTADO_ID, codigo: "borrador" }] as never)
        // RETURNING id del INSERT
        .mockResolvedValueOnce([{ id: INSTANCE_ID }] as never)
        // Rol para historial
        .mockResolvedValueOnce([] as never); // historial va por $executeRaw

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.create({
        tipoDocumentoId: TIPO_ID,
        pacienteId: PACIENTE_ID,
        episodioId: EPISODIO_ID,
      });

      expect(result.id).toBe(INSTANCE_ID);
      expect(result.estadoInicialCodigo).toBe("borrador");
    });

    it("lanza BAD_REQUEST si el tipo no tiene estado inicial", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never); // sin estado inicial

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(
        caller.create({ tipoDocumentoId: TIPO_ID, pacienteId: PACIENTE_ID }),
      ).rejects.toThrow(TRPCError);
    });

    it("lanza BAD_REQUEST si no hay establecimiento en el tenant", async () => {
      const tenantSinEstab = { ...ECE_TENANT, establishmentId: undefined };
      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: tenantSinEstab }),
      );
      await expect(
        caller.create({ tipoDocumentoId: TIPO_ID, pacienteId: PACIENTE_ID }),
      ).rejects.toThrow(TRPCError);
    });
  });

  // ─── instance.get ─────────────────────────────────────────────────────────

  describe("instance.get", () => {
    it("retorna la instancia cuando existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([INSTANCIA_ROW] as never);

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.get({ id: INSTANCE_ID });
      expect(result.id).toBe(INSTANCE_ID);
      expect(result.estado_codigo).toBe("borrador");
    });

    it("lanza NOT_FOUND cuando la instancia no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(caller.get({ id: INSTANCE_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // ─── instance.list ────────────────────────────────────────────────────────

  describe("instance.list", () => {
    it("lanza BAD_REQUEST si no se pasa ni episodioId ni pacienteId", async () => {
      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(caller.list({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("retorna items y nextCursor cuando hay más de `limit` resultados", async () => {
      // 21 filas con limit=20 → hasMore = true
      const rows = Array.from({ length: 21 }, (_, i) => ({
        ...INSTANCIA_ROW,
        id: `id-${String(i).padStart(8, "0")}`,
      }));
      prisma.$queryRaw.mockResolvedValueOnce(rows as never);

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.list({ pacienteId: PACIENTE_ID, limit: 20 });
      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).not.toBeNull();
    });

    it("nextCursor es null cuando no hay más páginas", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([INSTANCIA_ROW] as never);

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.list({ pacienteId: PACIENTE_ID, limit: 20 });
      expect(result.nextCursor).toBeNull();
    });
  });

  // ─── instance.advance ─────────────────────────────────────────────────────

  describe("instance.advance", () => {
    it("lanza FORBIDDEN si canTransition.allowed = false", async () => {
      vi.mocked(canTransition).mockResolvedValueOnce({
        allowed: false,
        requiresSignature: false,
        targetStateId: undefined,
      });

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(
        caller.advance({ instanceId: INSTANCE_ID, accion: "firmar" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("lanza BAD_REQUEST si la transición requiere firma y no se pasa firmaId", async () => {
      vi.mocked(canTransition).mockResolvedValueOnce({
        allowed: true,
        requiresSignature: true,
        targetStateId: TO_STATE_ID,
      });

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      await expect(
        caller.advance({ instanceId: INSTANCE_ID, accion: "firmar" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("happy path: llama executeTransition + emite evento outbox", async () => {
      vi.mocked(canTransition).mockResolvedValueOnce({
        allowed: true,
        requiresSignature: true,
        targetStateId: TO_STATE_ID,
      });
      vi.mocked(executeTransition).mockResolvedValueOnce(undefined);

      // Pre-query de instancia para capturar fromState
      prisma.$queryRaw.mockResolvedValueOnce([
        { estado_actual_id: ESTADO_ID, tipo_documento_id: TIPO_ID, tipo_codigo: "HIST_CLIN" },
      ] as never);

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.advance({
        instanceId: INSTANCE_ID,
        accion: "firmar",
        firmaId: FIRMA_ID,
      });

      expect(result.ok).toBe(true);
      expect(result.fromStateId).toBe(ESTADO_ID);
      expect(result.toStateId).toBe(TO_STATE_ID);

      expect(executeTransition).toHaveBeenCalledWith(
        prisma,
        INSTANCE_ID,
        "firmar",
        expect.objectContaining({ establecimientoId: ECE_TENANT.establishmentId }),
        expect.any(String),
        FIRMA_ID,
        undefined,
      );

      expect(emitDomainEvent).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          eventType: "workflow.transitionExecuted",
          aggregateId: INSTANCE_ID,
          organizationId: ORG_ID,
          payload: expect.objectContaining({
            instanceId: INSTANCE_ID,
            fromStateId: ESTADO_ID,
            toStateId: TO_STATE_ID,
            accion: "firmar",
            firmaId: FIRMA_ID,
          }),
        }),
      );
    });
  });

  // ─── instance.history ─────────────────────────────────────────────────────

  describe("instance.history", () => {
    const HISTORIAL_ROW = {
      id: "hh111111-0000-0000-0000-000000000001",
      instancia_id: INSTANCE_ID,
      estado_anterior_id: null,
      estado_nuevo_id: ESTADO_ID,
      estado_anterior_codigo: null,
      estado_nuevo_codigo: "borrador",
      accion: "crear",
      ejecutado_por: "user-id",
      ejecutado_en: new Date("2026-05-16T10:00:00Z"),
      firma_id: null,
      observacion: null,
    };

    it("retorna historial DESC con paginación correcta (sin más páginas)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([HISTORIAL_ROW] as never);

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.history({ instanceId: INSTANCE_ID, limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("retorna nextCursor cuando hay más filas que limit", async () => {
      const rows = Array.from({ length: 11 }, (_, i) => ({
        ...HISTORIAL_ROW,
        id: `hh${String(i).padStart(6, "0")}-0000-0000-0000-000000000001`,
      }));
      prisma.$queryRaw.mockResolvedValueOnce(rows as never);

      const caller = workflowInstanceRouter.createCaller(
        makeCtx({ prisma, tenant: ECE_TENANT }),
      );
      const result = await caller.history({ instanceId: INSTANCE_ID, limit: 10 });
      expect(result.items).toHaveLength(10);
      expect(result.nextCursor).not.toBeNull();
    });
  });
});
