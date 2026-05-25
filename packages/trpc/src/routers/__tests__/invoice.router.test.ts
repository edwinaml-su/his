/**
 * Tests del invoiceRouter (Wave 8b — Finance).
 *
 * Cubre:
 *   - listCostCenters: retorna filas del tenant.
 *   - get: NOT_FOUND cuando la BD no devuelve filas.
 *   - voidInvoice: NOT_FOUND cuando la BD no devuelve filas.
 *   - addPayment: BAD_REQUEST en factura VOIDED.
 *
 * Patrón: mockDeep<PrismaClient> con $queryRawUnsafe y $transaction mockeados.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { invoiceRouter } from "../invoice.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const invoiceId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** Simula withTenantContext: ejecuta fn directamente sin transacción real. */
function mockTransaction(prisma: DeepMockProxy<PrismaClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$transaction as any).mockImplementation(async (fn: (tx: any) => Promise<unknown>) => {
    return fn(prisma);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("invoiceRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("listCostCenters", () => {
    it("retorna lista de centros de costo del tenant", async () => {
      const costCenters = [
        { id: "cc-1", code: "1-EMG-ADU", name: "Emergencia adulto" },
        { id: "cc-2", code: "2-LAB-CLI", name: "Laboratorio clínico" },
      ];

      mockTransaction(prisma);
      // applyTenantContext usa $executeRawUnsafe (2 veces); después listCostCenters usa $queryRawUnsafe
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(costCenters);

      const ctx = makeCtx({ prisma });
      const caller = invoiceRouter.createCaller(ctx);
      const result = await caller.listCostCenters();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ code: "1-EMG-ADU" });
    });
  });

  describe("get", () => {
    it("lanza NOT_FOUND si no hay factura con ese id+org", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      // Invoice query devuelve []
      (prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const ctx = makeCtx({ prisma });
      const caller = invoiceRouter.createCaller(ctx);

      await expect(caller.get({ id: invoiceId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("voidInvoice", () => {
    it("lanza NOT_FOUND si la factura no existe en el tenant", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const ctx = makeCtx({ prisma });
      const caller = invoiceRouter.createCaller(ctx);

      await expect(caller.voidInvoice({ invoiceId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("es idempotente si ya está VOIDED", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
        { status: "VOIDED" },
      ]);

      const ctx = makeCtx({ prisma });
      const caller = invoiceRouter.createCaller(ctx);
      const result = await caller.voidInvoice({ invoiceId });

      expect(result).toMatchObject({ invoiceId });
    });
  });

  describe("addPayment", () => {
    it("lanza BAD_REQUEST en factura VOIDED", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
        { status: "VOIDED" },
      ]);

      const ctx = makeCtx({ prisma });
      const caller = invoiceRouter.createCaller(ctx);

      await expect(
        caller.addPayment({ invoiceId, amount: 10, method: "CASH" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("lanza NOT_FOUND si factura no existe", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const ctx = makeCtx({ prisma });
      const caller = invoiceRouter.createCaller(ctx);

      await expect(
        caller.addPayment({ invoiceId, amount: 10, method: "CARD" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});

// Suprime el import implícito de vi
import { vi } from "vitest";
void MOCK_TENANT;
void TRPCError;
