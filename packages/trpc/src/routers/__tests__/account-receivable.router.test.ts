/**
 * CC-0027 — Tests del accountReceivableRouter (cxc.*).
 *
 * Cubre:
 *  - list filtra por organizationId del tenant y por estado si se provee.
 *  - registrarAbono reduce saldoActual y pasa a PAGADA al llegar a 0.
 *  - registrarAbono rechaza abonos que excedan el saldo pendiente.
 *  - registrarAbono rechaza si la CxC no está ABIERTA.
 *  - registrarAbono NO toca PatientAccount (la cuenta ya está CERRADA).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { accountReceivableRouter } from "../account-receivable.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const CXC_ID = "00000000-0000-0000-0000-000000000030";

describe("accountReceivableRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  describe("list", () => {
    it("filtra por organizationId del tenant", async () => {
      prisma.accountReceivable.findMany.mockResolvedValue([] as never);

      const caller = accountReceivableRouter.createCaller(makeCtx({ prisma }));
      await caller.list();

      const args = prisma.accountReceivable.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({ organizationId: MOCK_TENANT.organizationId });
    });

    it("filtra por estado si se provee", async () => {
      prisma.accountReceivable.findMany.mockResolvedValue([] as never);

      const caller = accountReceivableRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ estado: "ABIERTA" });

      const args = prisma.accountReceivable.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({ estado: "ABIERTA" });
    });
  });

  describe("registrarAbono", () => {
    function mockCxc(overrides: Partial<{ estado: string; saldoActual: number }> = {}) {
      return {
        id: CXC_ID,
        organizationId: MOCK_TENANT.organizationId,
        saldoActual: overrides.saldoActual ?? 100,
        estado: overrides.estado ?? "ABIERTA",
        notas: null,
      };
    }

    it("reduce saldoActual y pasa a PAGADA cuando el abono cubre el saldo completo", async () => {
      prisma.accountReceivable.findFirst.mockResolvedValue(mockCxc({ saldoActual: 100 }) as never);
      prisma.accountReceivable.update.mockResolvedValue({ id: CXC_ID, estado: "PAGADA" } as never);

      const caller = accountReceivableRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.registrarAbono({ id: CXC_ID, monto: 100 });

      expect(result.estado).toBe("PAGADA");
      const updateArgs = prisma.accountReceivable.update.mock.calls[0]![0];
      expect(updateArgs.data).toMatchObject({ saldoActual: 0, estado: "PAGADA" });
    });

    it("deja la CxC ABIERTA con el saldo reducido cuando el abono es parcial", async () => {
      prisma.accountReceivable.findFirst.mockResolvedValue(mockCxc({ saldoActual: 100 }) as never);
      prisma.accountReceivable.update.mockResolvedValue({ id: CXC_ID, estado: "ABIERTA" } as never);

      const caller = accountReceivableRouter.createCaller(makeCtx({ prisma }));
      await caller.registrarAbono({ id: CXC_ID, monto: 40 });

      const updateArgs = prisma.accountReceivable.update.mock.calls[0]![0];
      expect(updateArgs.data).toMatchObject({ saldoActual: 60, estado: "ABIERTA" });
    });

    it("rechaza un abono que exceda el saldo pendiente", async () => {
      prisma.accountReceivable.findFirst.mockResolvedValue(mockCxc({ saldoActual: 50 }) as never);

      const caller = accountReceivableRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.registrarAbono({ id: CXC_ID, monto: 75 })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(prisma.accountReceivable.update).not.toHaveBeenCalled();
    });

    it("rechaza si la CxC no está ABIERTA", async () => {
      prisma.accountReceivable.findFirst.mockResolvedValue(mockCxc({ estado: "PAGADA" }) as never);

      const caller = accountReceivableRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.registrarAbono({ id: CXC_ID, monto: 10 })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(prisma.accountReceivable.update).not.toHaveBeenCalled();
    });

    it("NOT_FOUND si la CxC no existe en el tenant", async () => {
      prisma.accountReceivable.findFirst.mockResolvedValue(null as never);

      const caller = accountReceivableRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.registrarAbono({ id: CXC_ID, monto: 10 })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("no toca PatientAccount (la cuenta ya está cerrada)", async () => {
      prisma.accountReceivable.findFirst.mockResolvedValue(mockCxc({ saldoActual: 100 }) as never);
      prisma.accountReceivable.update.mockResolvedValue({ id: CXC_ID, estado: "PAGADA" } as never);

      const caller = accountReceivableRouter.createCaller(makeCtx({ prisma }));
      await caller.registrarAbono({ id: CXC_ID, monto: 100 });

      expect(prisma.patientAccount.update).not.toHaveBeenCalled();
      expect(prisma.patientAccount.findFirst).not.toHaveBeenCalled();
    });
  });
});
