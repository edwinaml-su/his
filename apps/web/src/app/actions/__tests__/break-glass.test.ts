/**
 * CC-0017 F3 — `clearBreakGlass` (apps/web/src/app/actions/break-glass.ts).
 *
 * Cubre la desactivación manual del break-glass: debe auditar el cierre
 * (lee el patientId de la cookie ANTES de borrarla) de forma best-effort —
 * un fallo al auditar no debe impedir que la cookie se borre.
 *
 * `@his/database`, `@/lib/auth/session`, `next/headers` y `next/cache` se
 * mockean explícitamente: no hay Prisma/Supabase reales en el entorno de
 * test de `@his/web` (sin `DATABASE_URL`), y `next/headers` fuera del
 * request scope de Next.js lanza si no se mockea.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuditLogCreate = vi.fn().mockResolvedValue({ id: 1n });
const mockCookieGet = vi.fn();
const mockCookieDelete = vi.fn();
const mockRevalidatePath = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockGetTenantContext = vi.fn();

vi.mock("@his/database", () => ({
  prisma: {
    auditLog: { create: (...args: unknown[]) => mockAuditLogCreate(...args) },
  },
  emitDomainEvent: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: mockCookieGet,
    delete: mockCookieDelete,
    set: vi.fn(),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
  getTenantContext: () => mockGetTenantContext(),
}));

const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

describe("clearBreakGlass — CC-0017 F3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ id: USER_ID, email: "mc@his.test", fullName: "MC Test" });
    mockGetTenantContext.mockResolvedValue({
      userId: USER_ID,
      organizationId: ORG_ID,
      establishmentId: null,
      countryId: "cc",
      roleCodes: ["PHYSICIAN"],
      assignedServiceUnitIds: [],
      assignedServiceUnitCodes: [],
      isCrossServiceRole: false,
    });
  });

  it("cookie presente y válida → audita el cierre (action=UPDATE, entity=BreakGlassAccess) y borra la cookie", async () => {
    mockCookieGet.mockReturnValue({
      value: JSON.stringify({
        patientId: PATIENT_ID,
        justification: "Justificación de más de veinte caracteres.",
        activatedAt: new Date().toISOString(),
      }),
    });

    const { clearBreakGlass } = await import("../break-glass");
    const result = await clearBreakGlass();

    expect(result).toEqual({ ok: true });
    expect(mockCookieDelete).toHaveBeenCalledWith("his.break_glass");
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    const call = mockAuditLogCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({
      userId: USER_ID,
      organizationId: ORG_ID,
      action: "UPDATE",
      entity: "BreakGlassAccess",
      entityId: PATIENT_ID,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("sin cookie → no audita, no lanza (fail-safe)", async () => {
    mockCookieGet.mockReturnValue(undefined);

    const { clearBreakGlass } = await import("../break-glass");
    const result = await clearBreakGlass();

    expect(result).toEqual({ ok: true });
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
    expect(mockCookieDelete).toHaveBeenCalledWith("his.break_glass");
  });

  it("auditLog.create falla → best-effort: no lanza, igual borra la cookie", async () => {
    mockCookieGet.mockReturnValue({
      value: JSON.stringify({
        patientId: PATIENT_ID,
        justification: "Justificación de más de veinte caracteres.",
        activatedAt: new Date().toISOString(),
      }),
    });
    mockAuditLogCreate.mockRejectedValueOnce(new Error("db down"));

    const { clearBreakGlass } = await import("../break-glass");
    await expect(clearBreakGlass()).resolves.toEqual({ ok: true });
    expect(mockCookieDelete).toHaveBeenCalledWith("his.break_glass");
  });
});
