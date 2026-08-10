/**
 * CC-0017 F3 — `applyTenantContext`/`withTenantContext` heredan
 * `tenant.breakGlass` automáticamente (rls-context.ts), sin que cada uno de
 * los ~50 call sites existentes tenga que pasar `{ breakGlass: true }`
 * explícito. Unit test puro (tx mockeado, sin Postgres real) — la prueba de
 * que la policy RLS efectivamente eleva el acceso vive en
 * `rls-isolation.test.ts` Test 4 (RUN_RLS_TESTS=1, no tocado por este CC).
 */
import { describe, it, expect, vi } from "vitest";
import { applyTenantContext, withTenantContext } from "../rls-context";

function makeMockTx() {
  const calls: string[] = [];
  return {
    tx: {
      $executeRawUnsafe: vi.fn(async (sql: string) => {
        calls.push(sql);
        return 0;
      }),
    },
    calls,
  };
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

describe("applyTenantContext — CC-0017 F3 auto-flow de tenant.breakGlass", () => {
  it("tenant.breakGlass ausente (fail-safe) → set_tenant_context(..., false)", async () => {
    const { tx, calls } = makeMockTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyTenantContext(tx as any, { userId: USER_ID, organizationId: ORG_ID });
    expect(calls[0]).toContain("false)");
    expect(calls[0]).not.toContain(", true)");
  });

  it("tenant.breakGlass = false → set_tenant_context(..., false)", async () => {
    const { tx, calls } = makeMockTx();
    await applyTenantContext(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx as any,
      { userId: USER_ID, organizationId: ORG_ID, breakGlass: false },
    );
    expect(calls[0]).toContain("false)");
  });

  it("tenant.breakGlass = true → set_tenant_context(..., true) SIN pasar options.breakGlass", async () => {
    const { tx, calls } = makeMockTx();
    await applyTenantContext(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx as any,
      { userId: USER_ID, organizationId: ORG_ID, breakGlass: true },
    );
    expect(calls[0]).toContain(", true)");
  });

  it("options.breakGlass explícito gana sobre tenant.breakGlass", async () => {
    const { tx, calls } = makeMockTx();
    await applyTenantContext(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx as any,
      { userId: USER_ID, organizationId: ORG_ID, breakGlass: true },
      { breakGlass: false },
    );
    expect(calls[0]).toContain("false)");
  });

  it("withTenantContext — mismo comportamiento vía $transaction", async () => {
    const calls: string[] = [];
    const fakePrisma = {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          $executeRawUnsafe: async (sql: string) => {
            calls.push(sql);
            return 0;
          },
        }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await withTenantContext(
      fakePrisma,
      { userId: USER_ID, organizationId: ORG_ID, breakGlass: true },
      async () => "ok",
    );

    expect(calls[0]).toContain(", true)");
  });
});
