/**
 * Tests del criticalResultRouter (JCI IPSG.2 ME 2 — read-back de valores críticos).
 *
 * Foco: R02 — aislamiento multi-tenant apoyado en RLS, no sólo en el `WHERE`.
 *
 * Contexto del hallazgo que motiva estos tests
 * --------------------------------------------
 * Los 4 endpoints seteaban el contexto RLS así:
 *
 *     await tx.$executeRaw`
 *       SET LOCAL app.current_org_id = ${orgId};
 *       SET LOCAL app.current_user_id = ${ctx.user.id};
 *       SET LOCAL ROLE authenticated;
 *     `;
 *
 * Eso no funciona en Postgres por DOS motivos independientes, ambos SQLSTATE
 * 42601 y ambos verificados contra la base real:
 *
 *   1. `$executeRaw` (template tag) usa el protocolo extendido, y `SET` no
 *      admite bind params:  `syntax error at or near "$1"`.
 *   2. Aunque no hubiera params, son 3 sentencias en un solo statement:
 *      `cannot insert multiple commands into a prepared statement`.
 *
 * O sea que el contexto nunca se aplicó y, peor, el endpoint entero abortaba
 * antes de tocar la tabla. El patrón correcto es `applyTenantContext`, que usa
 * `$executeRawUnsafe` y una sentencia por llamada.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { criticalResultRouter } from "../critical-result.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_TENANT_OTHER_ORG } from "@his/test-utils";

// El outbox se mockea: aquí interesa el contexto RLS, no el evento de dominio.
vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-mock-id" }),
  };
});

const USER = { id: "22222222-2222-2222-2222-222222222222", email: "mc@his.test", name: "Dra. Tratante" };
const MC_TENANT = { ...MOCK_TENANT, roleCodes: ["MC", "DIR"] };
const OTHER_TENANT = { ...MOCK_TENANT_OTHER_ORG, roleCodes: ["MC", "DIR"] };

const NOTIF_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ESCALADO_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    return cb;
  });
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  prisma.$executeRaw.mockResolvedValue(0 as never);
  prisma.$queryRaw.mockResolvedValue([] as never);
  return prisma;
}

/** Sentencias crudas efectivamente enviadas por applyTenantContext. */
function sentenciasContexto(prisma: DeepMockProxy<PrismaClient>): string[] {
  return prisma.$executeRawUnsafe.mock.calls.map((c) => String(c[0]));
}

describe("criticalResultRouter — contexto RLS (R02)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  it("pending aplica el contexto de tenant y demota el rol a authenticated", async () => {
    const caller = criticalResultRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: USER }),
    );

    await caller.pending({ limit: 10 });

    const q = sentenciasContexto(prisma);

    // set_tenant_context(...) con la organización del caller.
    expect(q.some((s) => s.includes("set_tenant_context") && s.includes(MC_TENANT.organizationId))).toBe(true);

    // Sin el demote el rol conserva BYPASSRLS y la policy
    // crn_tenant_isolation (organization_id = app.current_org_id) nunca aplica.
    expect(q.some((s) => /SET LOCAL ROLE authenticated/.test(s))).toBe(true);
  });

  it("pending scopea el contexto a la organización del caller, no a otra", async () => {
    const caller = criticalResultRouter.createCaller(
      makeCtx({ prisma, tenant: OTHER_TENANT, user: USER }),
    );

    await caller.pending({ limit: 10 });

    const q = sentenciasContexto(prisma).join("\n");
    expect(q).toContain(OTHER_TENANT.organizationId);
    // La org del otro tenant no debe filtrarse al contexto.
    expect(q).not.toContain(MOCK_TENANT.organizationId);
  });

  it("las mutaciones setean el contexto de tenant antes de tocar la tabla", async () => {
    // findNotification no encuentra nada → NOT_FOUND, pero el contexto ya se
    // aplicó: es lo que verificamos.
    const caller = criticalResultRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: USER }),
    );

    await expect(
      caller.escalate({ notificationId: NOTIF_ID, escaladoAId: ESCALADO_A }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(
      sentenciasContexto(prisma).some(
        (s) => s.includes("set_tenant_context") && s.includes(MC_TENANT.organizationId),
      ),
    ).toBe(true);
  });

  it("ningún endpoint vuelve a setear el contexto con $executeRaw (42601)", async () => {
    const caller = criticalResultRouter.createCaller(
      makeCtx({ prisma, tenant: MC_TENANT, user: USER }),
    );

    await caller.pending({ limit: 10 });
    await expect(
      caller.escalate({ notificationId: NOTIF_ID, escaladoAId: ESCALADO_A }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // `SET` no puede ir por protocolo extendido ni en statement multi-comando.
    // Si alguien reintroduce el patrón, estas dos aserciones lo atrapan.
    const rawTemplates = prisma.$executeRaw.mock.calls.map((c) =>
      Array.isArray(c[0]) ? (c[0] as unknown as string[]).join("?") : String(c[0]),
    );
    expect(rawTemplates.some((s) => /SET\s+LOCAL/i.test(s))).toBe(false);

    // Y una sentencia por llamada en el camino correcto.
    for (const s of sentenciasContexto(prisma)) {
      expect(s.replace(/;\s*$/, "")).not.toMatch(/;/);
    }
  });

  it("escalate corta con NOT_FOUND cuando la notificación no es de la organización", async () => {
    // findNotification filtra por organization_id; simulamos el caso en que la
    // notificación pertenece a otra org (0 filas) → no debe escalarse nada.
    prisma.$queryRaw.mockResolvedValue([] as never);

    const caller = criticalResultRouter.createCaller(
      makeCtx({ prisma, tenant: OTHER_TENANT, user: USER }),
    );

    await expect(
      caller.escalate({ notificationId: NOTIF_ID, escaladoAId: ESCALADO_A }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // No debe haberse ejecutado ningún UPDATE.
    const updates = prisma.$executeRaw.mock.calls.map((c) =>
      Array.isArray(c[0]) ? (c[0] as unknown as string[]).join("?") : String(c[0]),
    );
    expect(updates.some((s) => /UPDATE\s+ece\.critical_result_notification/i.test(s))).toBe(false);
  });
});
