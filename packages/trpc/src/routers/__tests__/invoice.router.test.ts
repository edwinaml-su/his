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

// docs/48 Ola 2 (C2-3) — resolverPrecio ya tiene su propia suite
// (price-resolver.test.ts); aquí solo se ejercita el CABLEADO de invoice.create
// (re-resolución server-side, override auditado). `mapFuenteAPriceSource` se
// conserva real (es una función pura, no hay razón para mockearla).
vi.mock("../../lib/price-resolver", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/price-resolver")>();
  return {
    ...original,
    resolverPrecio: vi.fn(),
  };
});

import { invoiceRouter } from "../invoice.router";
import { resolverPrecio } from "../../lib/price-resolver";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const resolverPrecioMock = vi.mocked(resolverPrecio);

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
    resolverPrecioMock.mockReset();
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

  // docs/48 Ola 1 (H-08) — patientAccountId ancla la factura a la cuenta de origen.
  describe("create — patientAccountId (docs/48 H-08)", () => {
    const patientId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const accountId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const baseInput = {
      patientId,
      currencyId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      items: [
        {
          description: "Consulta general",
          code: "CONS-GEN",
          quantity: 1,
          unitPrice: 10,
          costCenterId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        },
      ],
    };

    it("rechaza (Zod) sin patientAccountId — ahora es obligatorio", async () => {
      const caller = invoiceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        caller.create(baseInput as any),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza patientAccountId que no pertenece al tenant/paciente", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      const queryMock = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
      queryMock
        .mockResolvedValueOnce([{ id: "estab-1" }]) // Establishment
        .mockResolvedValueOnce([]); // PatientAccount check — no encontrada

      const caller = invoiceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({ ...baseInput, patientAccountId: accountId }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(queryMock).toHaveBeenCalledTimes(2); // nunca llega al INSERT
    });

    it("persiste patientAccountId cuando la cuenta pertenece al tenant y paciente", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      // docs/48 Ola 2 (C2-3) — el precio resuelto coincide con el unitPrice
      // enviado (10): la línea pasa sin necesitar override.
      resolverPrecioMock.mockResolvedValue({
        precio: 10,
        fuente: "estandar",
        priceListId: null,
        reglaId: null,
      });
      const queryMock = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
      queryMock
        .mockResolvedValueOnce([{ id: "estab-1" }]) // Establishment
        .mockResolvedValueOnce([{ id: accountId }]) // PatientAccount check — OK
        .mockResolvedValueOnce([{ id: "inv-1" }]) // INSERT Invoice RETURNING id
        .mockResolvedValueOnce(undefined); // INSERT InvoiceItem

      const caller = invoiceRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({ ...baseInput, patientAccountId: accountId });

      expect(result).toMatchObject({ id: "inv-1" });
      const insertCall = queryMock.mock.calls[2]!;
      expect(String(insertCall[0])).toContain('"patientAccountId"');
      expect(insertCall).toContain(accountId);
    });
  });

  // docs/48 Ola 2 (C2-3/H-03) — invoice.create re-resuelve precio server-side.
  describe("create — re-resolución de precio server-side (docs/48 C2-3/H-03)", () => {
    const patientId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const accountId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const baseInput = {
      patientId,
      patientAccountId: accountId,
      currencyId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      items: [
        {
          description: "Consulta general",
          code: "CONS-GEN",
          quantity: 1,
          unitPrice: 10,
          costCenterId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        },
      ],
    };

    function mockHastaCuenta(queryMock: ReturnType<typeof vi.fn>) {
      queryMock
        .mockResolvedValueOnce([{ id: "estab-1" }]) // Establishment
        .mockResolvedValueOnce([{ id: accountId }]); // PatientAccount check — OK
    }

    it("rechaza cuando el precio del cliente difiere del resuelto y no hay override", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      resolverPrecioMock.mockResolvedValue({
        precio: 25, // el cliente mandó 10 — no coincide
        fuente: "regla",
        priceListId: "list-1",
        reglaId: "regla-1",
      });
      const queryMock = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
      mockHastaCuenta(queryMock);

      const caller = invoiceRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(baseInput)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("rechaza cuando el precio no se puede resolver y no hay override (nunca 0)", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      resolverPrecioMock.mockResolvedValue({
        precio: null,
        fuente: null,
        priceListId: null,
        reglaId: null,
      });
      const queryMock = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
      mockHastaCuenta(queryMock);

      const caller = invoiceRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(baseInput)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("con overridePrecio + rol ADMIN acepta el precio del cliente y persiste priceSource='manual_override'", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      resolverPrecioMock.mockResolvedValue({
        precio: 25,
        fuente: "regla",
        priceListId: "list-1",
        reglaId: "regla-1",
      });
      const queryMock = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
      mockHastaCuenta(queryMock);
      queryMock
        .mockResolvedValueOnce([{ id: "inv-1" }]) // INSERT Invoice
        .mockResolvedValueOnce(undefined); // INSERT InvoiceItem

      // MOCK_TENANT trae rol ADMIN por defecto (packages/test-utils).
      const caller = invoiceRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({
        ...baseInput,
        items: [
          {
            ...baseInput.items[0]!,
            overridePrecio: { justificacion: "Descuento autorizado por dirección médica" },
          },
        ],
      });

      expect(result).toMatchObject({ id: "inv-1" });
      const itemInsertCall = queryMock.mock.calls[3]!;
      expect(String(itemInsertCall[0])).toContain('"priceSource"');
      expect(itemInsertCall).toContain("manual_override");
      // el override queda auditado en notes de la factura
      const invoiceInsertCall = queryMock.mock.calls[2]!;
      expect(String(invoiceInsertCall[0])).toContain("notes");
      expect(invoiceInsertCall.some((v: unknown) => typeof v === "string" && v.includes("Descuento autorizado"))).toBe(
        true,
      );
    });

    it("rechaza el override (FORBIDDEN) si el actor no tiene rol ADMIN/DIR", async () => {
      mockTransaction(prisma);
      (prisma.$executeRawUnsafe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      resolverPrecioMock.mockResolvedValue({
        precio: 25,
        fuente: "regla",
        priceListId: "list-1",
        reglaId: "regla-1",
      });
      const queryMock = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;
      mockHastaCuenta(queryMock);

      const tenantBilling = { ...MOCK_TENANT, roleCodes: ["BILLING"] };
      const caller = invoiceRouter.createCaller(makeCtx({ prisma, tenant: tenantBilling }));

      await expect(
        caller.create({
          ...baseInput,
          items: [
            {
              ...baseInput.items[0]!,
              overridePrecio: { justificacion: "Descuento autorizado por dirección médica" },
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});

// Suprime el import implícito de vi
import { vi } from "vitest";
void MOCK_TENANT;
void TRPCError;
