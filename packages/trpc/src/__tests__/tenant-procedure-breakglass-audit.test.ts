/**
 * CC-0017 F3 — `tenantProcedure` audita cada request que corrió con
 * `ctx.tenant.breakGlass === true` (Postgres no soporta triggers BEFORE
 * SELECT — ver `packages/database/sql/02_audit_triggers.sql` §4 — así que
 * las lecturas bajo break-glass sólo quedan cubiertas por este middleware).
 *
 * Fail-safe: sin `tenant.breakGlass` (ausente o `false`, el caso de HOY para
 * el 100% de los usuarios sin cookie) NO se escribe ningún audit log extra —
 * comportamiento idéntico al pre-CC-0017-F3.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { router, tenantProcedure } from "../trpc";
import { makeCtx } from "./helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const testRouter = router({
  ping: tenantProcedure.input(z.object({}).default({})).query(() => "pong" as const),
  boom: tenantProcedure.input(z.object({}).default({})).mutation(() => {
    throw new Error("business error");
  }),
});

describe("tenantProcedure — auditoría de acceso bajo break-glass (CC-0017 F3)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("tenant.breakGlass ausente (fail-safe, comportamiento actual) → NO audita", async () => {
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT }));
    await expect(caller.ping({})).resolves.toBe("pong");
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("tenant.breakGlass = false → NO audita", async () => {
    const tenant = { ...MOCK_TENANT, breakGlass: false };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.ping({})).resolves.toBe("pong");
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("tenant.breakGlass = true → audita con action=READ, entity=BreakGlassAccess", async () => {
    const tenant = {
      ...MOCK_TENANT,
      breakGlass: true,
      breakGlassSession: {
        patientId: "11111111-1111-4111-8111-111111111111",
        justification: "emergencia",
        activatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.ping({})).resolves.toBe("pong");

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const call = prisma.auditLog.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({
      organizationId: tenant.organizationId,
      action: "READ",
      entity: "BreakGlassAccess",
      entityId: tenant.breakGlassSession.patientId,
    });
  });

  it("procedure que lanza error → NO audita (result.ok=false)", async () => {
    const tenant = { ...MOCK_TENANT, breakGlass: true };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.boom({})).rejects.toThrow("business error");
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("fallo al escribir el audit log NO rompe la respuesta (best-effort)", async () => {
    const tenant = { ...MOCK_TENANT, breakGlass: true };
    prisma.auditLog.create.mockRejectedValueOnce(new Error("db down") as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.ping({})).resolves.toBe("pong");

    consoleSpy.mockRestore();
  });
});
