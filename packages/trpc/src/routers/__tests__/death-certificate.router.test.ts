/**
 * Tests del deathCertificate router (US-5.6).
 *
 * Cubre:
 *  - list filtra por org del tenant cuando no se pasa organizationId.
 *  - create exige causa de muerte coherente (manda intermedio sin desc → BAD_REQUEST).
 *  - get retorna NOT_FOUND si el certificado no existe en el tenant (tenant isolation).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { deathCertificateRouter } from "../death-certificate.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

/** Helper local: pequeño envoltorio sobre vi.fn() para reducir ruido. */
function fn<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

describe("deathCertificateRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("list", () => {
    it("filtra por organizationId del tenant cuando no se pasa explícito", async () => {
      prisma.deathCertificate.findMany.mockResolvedValue([] as never);
      prisma.deathCertificate.count.mockResolvedValue(0 as never);

      const caller = deathCertificateRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ page: 1, pageSize: 20 });

      const args = prisma.deathCertificate.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
      });
    });
  });

  describe("create", () => {
    it("rechaza causa intermedia con código pero sin descripción (BAD_REQUEST)", async () => {
      const caller = deathCertificateRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          encounterId: "00000000-0000-0000-0000-000000000010",
          occurredAt: new Date("2026-01-15T08:00:00Z"),
          basicCauseCode: "I46.9",
          basicCauseDesc: "Paro cardíaco no especificado",
          // Code sin desc → debe disparar BAD_REQUEST.
          intermediateCauseCode: "I50.9",
          // intermediateCauseDesc deliberadamente omitido.
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza si el usuario no tiene rol PHYSICIAN (FORBIDDEN)", async () => {
      const caller = deathCertificateRouter.createCaller(
        makeCtx({
          prisma,
          tenant: {
            ...MOCK_TENANT,
            roleCodes: ["NURSE"], // sin médico ni admin.
          },
        }),
      );
      await expect(
        caller.create({
          encounterId: "00000000-0000-0000-0000-000000000010",
          occurredAt: new Date("2026-01-15T08:00:00Z"),
          basicCauseCode: "I46.9",
          basicCauseDesc: "Paro cardíaco no especificado",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("get", () => {
    it("retorna NOT_FOUND si el certificado no existe en el tenant", async () => {
      prisma.deathCertificate.findFirst = fn(null) as never;

      const caller = deathCertificateRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.get({ id: "00000000-0000-0000-0000-000000000099" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rechaza si el rol no es médico ni admin (FORBIDDEN)", async () => {
      const caller = deathCertificateRouter.createCaller(
        makeCtx({
          prisma,
          tenant: { ...MOCK_TENANT, roleCodes: ["NURSE"] },
        }),
      );
      await expect(
        caller.get({ id: "00000000-0000-0000-0000-000000000099" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
