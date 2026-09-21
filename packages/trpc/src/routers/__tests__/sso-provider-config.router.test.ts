/**
 * Tests unitarios — sso-provider-config.router (R1.4, plan remediación 2026-09).
 *
 * Cubre:
 *   - list: filtra por organizationId del tenant, corre dentro de withTenantContext.
 *   - upsert: requiere ADMIN/DIR; crea/actualiza por (organizationId, provider).
 *   - upsert: nunca acepta/persiste clientSecret (el schema no lo tiene).
 *   - delete: IDOR — NOT_FOUND si el provider es de otra org, cero escritura.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { ssoProviderConfigRouter } from "../sso-provider-config.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";
import { ssoProviderConfigUpsertInput } from "@his/contracts";

describe("ssoProviderConfigRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  /** Mismo patrón que patient.router.test.ts para withTenantContext. */
  function setupTx() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
      .mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma));
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("list", () => {
    it("filtra por organizationId del tenant y corre dentro de withTenantContext", async () => {
      setupTx();
      prisma.ssoProviderConfig.findMany.mockResolvedValue([
        {
          id: "10000000-0000-4000-8000-000000000001",
          organizationId: MOCK_TENANT.organizationId,
          provider: "AZURE_AD",
          displayName: "Microsoft 365",
          enabled: true,
          config: { clientId: "abc", autoProvision: false },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as never);

      const caller = ssoProviderConfigRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const args = prisma.ssoProviderConfig.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({ organizationId: MOCK_TENANT.organizationId });
      expect(result).toHaveLength(1);
      expect(result[0]!.provider).toBe("AZURE_AD");
      // Nunca expone un campo clientSecret — el schema de `config` no lo admite.
      expect(result[0]!.config).not.toHaveProperty("clientSecret");
    });

    it("filas con config inválido/corrupto caen a default seguro en vez de tronar", async () => {
      setupTx();
      prisma.ssoProviderConfig.findMany.mockResolvedValue([
        {
          id: "10000000-0000-4000-8000-000000000002",
          organizationId: MOCK_TENANT.organizationId,
          provider: "GOOGLE_WORKSPACE",
          displayName: "Google",
          enabled: true,
          config: { redirectUri: "no-es-una-url" }, // inválido: falla ssoProviderConfigMetaSchema
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as never);

      const caller = ssoProviderConfigRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list();

      expect(result[0]!.config).toEqual({ autoProvision: false });
    });
  });

  describe("upsert", () => {
    const INPUT = {
      provider: "AZURE_AD" as const,
      displayName: "Microsoft 365 (Hospital Central)",
      enabled: true,
      config: { clientId: "client-abc", autoProvision: false },
    };

    it("FORBIDDEN sin rol ADMIN/DIR", async () => {
      const caller = ssoProviderConfigRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] } }),
      );
      await expect(caller.upsert(INPUT)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(prisma.ssoProviderConfig.upsert).not.toHaveBeenCalled();
    });

    it("crea/actualiza por (organizationId, provider) dentro de withTenantContext", async () => {
      setupTx();
      prisma.ssoProviderConfig.upsert.mockResolvedValue({
        id: "10000000-0000-4000-8000-000000000003",
        organizationId: MOCK_TENANT.organizationId,
        provider: "AZURE_AD",
        displayName: INPUT.displayName,
        enabled: true,
        config: INPUT.config,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const caller = ssoProviderConfigRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.upsert(INPUT);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const args = prisma.ssoProviderConfig.upsert.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId_provider: {
          organizationId: MOCK_TENANT.organizationId,
          provider: "AZURE_AD",
        },
      });
      expect(args.create).toMatchObject({ organizationId: MOCK_TENANT.organizationId });
      expect(result.provider).toBe("AZURE_AD");
    });

    it("el schema Zod del input strippea clientSecret aunque el cliente lo mande", () => {
      const withSecret = { ...INPUT, config: { ...INPUT.config, clientSecret: "shh" } };
      const parsed = ssoProviderConfigUpsertInput.safeParse(withSecret);
      // Zod por default hace "strip" de claves desconocidas — clientSecret nunca
      // llega a persistirse aunque el cliente lo mande.
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.config).not.toHaveProperty("clientSecret");
      }
    });
  });

  describe("delete", () => {
    const OTHER_ORG_PROVIDER_ID = "10000000-0000-4000-8000-000000000009";

    it("IDOR — NOT_FOUND si el provider es de otra org, sin ninguna escritura", async () => {
      setupTx();
      prisma.ssoProviderConfig.findFirst.mockResolvedValue(null);

      const caller = ssoProviderConfigRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.delete({ id: OTHER_ORG_PROVIDER_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(prisma.ssoProviderConfig.delete).not.toHaveBeenCalled();
    });

    it("FORBIDDEN sin rol ADMIN/DIR", async () => {
      const caller = ssoProviderConfigRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["NURSE"] } }),
      );
      await expect(
        caller.delete({ id: OTHER_ORG_PROVIDER_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(prisma.ssoProviderConfig.findFirst).not.toHaveBeenCalled();
    });

    it("elimina cuando el provider pertenece al tenant", async () => {
      setupTx();
      prisma.ssoProviderConfig.findFirst.mockResolvedValue({ id: OTHER_ORG_PROVIDER_ID } as never);
      prisma.ssoProviderConfig.delete.mockResolvedValue({} as never);

      const caller = ssoProviderConfigRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.delete({ id: OTHER_ORG_PROVIDER_ID });

      expect(result).toEqual({ ok: true });
      expect(prisma.ssoProviderConfig.delete).toHaveBeenCalledWith({
        where: { id: OTHER_ORG_PROVIDER_ID },
      });
    });
  });
});
