/**
 * Gate MFA en `tenantProcedure` — OWASP A07:2025 (hallazgo H4, fix c440473).
 *
 * Antes de H4, `ctx.mfaSatisfied === undefined` significaba SIEMPRE "no
 * bloquear", incluso con la política de MFA prendida (`MFA_REQUIRED_ROLE_CODES`
 * no vacía) — un caller tenant-scoped que armara el contexto sin evaluar
 * `mfaSatisfied` bypaseaba la política en silencio. Ahora, con la política
 * prendida, `undefined` + `tenant` presente falla cerrado (FORBIDDEN); con la
 * política apagada, el comportamiento sigue siendo bit-idéntico al de antes.
 *
 * `MFA_POLICY_ENABLED` (packages/trpc/src/trpc.ts) se calcula UNA SOLA VEZ al
 * importar el módulo, leyendo `process.env.MFA_REQUIRED_ROLE_CODES`. Por eso
 * cada caso que necesite un valor distinto de esa variable hace
 * `vi.resetModules()` + `vi.stubEnv()` + reimporta `../trpc` dinámicamente
 * ANTES de construir el router de prueba — reusar el import estático dejaría
 * a todos los tests con el valor de política congelado en el primer import.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { MOCK_TENANT, MOCK_USER_ADMIN } from "@his/test-utils";
import type { TRPCContext } from "../context";

/** Reimporta `../trpc` con el registro de módulos limpio (ver nota arriba). */
async function importFreshTrpc() {
  vi.resetModules();
  return import("../trpc");
}

function buildCtx(
  prisma: DeepMockProxy<PrismaClient>,
  mfaSatisfied: boolean | undefined,
): TRPCContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: prisma as any,
    user: MOCK_USER_ADMIN,
    tenant: MOCK_TENANT,
    portalAccount: null,
    mfaSatisfied,
  };
}

describe("tenantProcedure — gate MFA (OWASP A07:2025, H4)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("mfaSatisfied: false → FORBIDDEN (comportamiento pre-existente, sin depender de la política)", async () => {
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "");
    const { router, tenantProcedure } = await importFreshTrpc();
    const testRouter = router({ ping: tenantProcedure.query(() => "ok" as const) });
    const caller = testRouter.createCaller(buildCtx(prisma, false));

    await expect(caller.ping()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("mfaSatisfied: true → pasa, con política prendida", async () => {
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "ADMIN,DIR");
    const { router, tenantProcedure } = await importFreshTrpc();
    const testRouter = router({ ping: tenantProcedure.query(() => "ok" as const) });
    const caller = testRouter.createCaller(buildCtx(prisma, true));

    await expect(caller.ping()).resolves.toBe("ok");
  });

  it("H4: mfaSatisfied undefined + MFA_REQUIRED_ROLE_CODES prendida → FORBIDDEN (fail-closed)", async () => {
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "ADMIN,DIR");
    const { router, tenantProcedure } = await importFreshTrpc();
    const testRouter = router({ ping: tenantProcedure.query(() => "ok" as const) });
    const caller = testRouter.createCaller(buildCtx(prisma, undefined));

    await expect(caller.ping()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("segundo factor"),
    });
  });

  it("H4: mfaSatisfied undefined + política apagada (var vacía) → pasa (comportamiento previo intacto)", async () => {
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "");
    const { router, tenantProcedure } = await importFreshTrpc();
    const testRouter = router({ ping: tenantProcedure.query(() => "ok" as const) });
    const caller = testRouter.createCaller(buildCtx(prisma, undefined));

    await expect(caller.ping()).resolves.toBe("ok");
  });

  it("H4: mfaSatisfied undefined + var ausente (sin definir) → pasa (política apagada por default)", async () => {
    delete (process.env as Record<string, string | undefined>).MFA_REQUIRED_ROLE_CODES;
    const { router, tenantProcedure } = await importFreshTrpc();
    const testRouter = router({ ping: tenantProcedure.query(() => "ok" as const) });
    const caller = testRouter.createCaller(buildCtx(prisma, undefined));

    await expect(caller.ping()).resolves.toBe("ok");
  });

  it("sin tenant → FORBIDDEN por selección de organización, antes de evaluar MFA", async () => {
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "ADMIN,DIR");
    const { router, tenantProcedure } = await importFreshTrpc();
    const testRouter = router({ ping: tenantProcedure.query(() => "ok" as const) });
    const caller = testRouter.createCaller({ ...buildCtx(prisma, true), tenant: null });

    await expect(caller.ping()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("organización"),
    });
  });
});
