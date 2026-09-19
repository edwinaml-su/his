/**
 * R1.4 (plan de remediación 2026-09) — `listSsoProvidersForLogin`
 * (apps/web/src/app/actions/sso.ts).
 *
 * Cubre:
 *   - Tabla vacía (MVP en transición) → cae al mock legacy, comportamiento
 *     IDÉNTICO al de antes de R1.4 (cero regresión para el login actual).
 *   - Tabla con filas `enabled` → las usa en vez del mock.
 *   - Filtra por `organizationDomain` cuando se provee.
 *   - `config` corrupto/inválido en BD no tumba la función (degrada a
 *     `organizationDomain: undefined`, fila igual se lista).
 *   - P2-1 (revisión independiente 2026-09-19): la query a BD puede fallar
 *     (P2021 "tabla no existe" si sql/258 aún no se aplicó, o la BD no
 *     responde) — degrada al mock legacy en vez de propagar y vaciar el
 *     selector `/sso`.
 *
 * `@his/database` se mockea — sin Prisma/Supabase real en el entorno de
 * test de `@his/web` (mismo patrón que `break-glass.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();

vi.mock("@his/database", () => ({
  prisma: {
    ssoProviderConfig: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}));

describe("listSsoProvidersForLogin — R1.4", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("tabla vacía → cae al mock legacy (mismo comportamiento que antes de R1.4)", async () => {
    mockFindMany.mockResolvedValue([]);
    const { listSsoProvidersForLogin } = await import("../sso");

    const result = await listSsoProvidersForLogin();

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.provider).sort()).toEqual(["AZURE_AD", "GOOGLE_WORKSPACE"]);
  });

  it("P2-1 — la query a BD falla (P2021/conexión) → degrada al mock legacy, no propaga ni vacía el selector", async () => {
    mockFindMany.mockRejectedValue(
      new Error('The table `public.SsoProviderConfig` does not exist in the current database.'),
    );
    const { listSsoProvidersForLogin } = await import("../sso");

    const result = await listSsoProvidersForLogin();

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.provider).sort()).toEqual(["AZURE_AD", "GOOGLE_WORKSPACE"]);
  });

  it("tabla vacía + filtro por dominio → mismo filtro que el mock legacy aplicaba", async () => {
    mockFindMany.mockResolvedValue([]);
    const { listSsoProvidersForLogin } = await import("../sso");

    const result = await listSsoProvidersForLogin("hospitalcentral.sv");

    expect(result).toHaveLength(1);
    expect(result[0]!.provider).toBe("AZURE_AD");
  });

  it("con filas en BD (enabled) → usa BD en vez del mock", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "10000000-0000-4000-8000-000000000001",
        provider: "WORKOS",
        displayName: "Hospital Central AD",
        config: { organizationDomain: "hospitalcentral.sv" },
      },
    ]);
    const { listSsoProvidersForLogin } = await import("../sso");

    const result = await listSsoProvidersForLogin();

    expect(result).toEqual([
      {
        id: "10000000-0000-4000-8000-000000000001",
        provider: "WORKOS",
        displayName: "Hospital Central AD",
        organizationDomain: "hospitalcentral.sv",
      },
    ]);
    // Solo pide enabled=true — nunca expone providers deshabilitados.
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
  });

  it("config corrupto en BD no tumba la función — degrada a organizationDomain undefined", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "10000000-0000-4000-8000-000000000002",
        provider: "AUTH0",
        displayName: "Auth0 roto",
        config: { redirectUri: "no-es-una-url" }, // inválido para el schema
      },
    ]);
    const { listSsoProvidersForLogin } = await import("../sso");

    const result = await listSsoProvidersForLogin();

    expect(result).toHaveLength(1);
    expect(result[0]!.organizationDomain).toBeUndefined();
  });

  it("nunca expone un campo clientSecret (la tabla no lo tiene)", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "10000000-0000-4000-8000-000000000003",
        provider: "AZURE_AD",
        displayName: "Azure",
        config: { clientId: "abc" },
      },
    ]);
    const { listSsoProvidersForLogin } = await import("../sso");

    const result = await listSsoProvidersForLogin();

    expect(result[0]).not.toHaveProperty("clientSecret");
  });
});
