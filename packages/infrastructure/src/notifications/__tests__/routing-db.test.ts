/**
 * CC-0031 Fase 1(d) — `resolveChannelsFromDb` / `buildMatrixFromRows`.
 * Deuda declarada en routing.ts desde Beta.15 ("estos defaults vivirán en
 * RoleNotificationDefault — mientras esa US no aterriza, el dispatcher
 * resuelve aquí"): ahora que `sql/238` siembra la tabla, el dispatcher debe
 * leerla, con fallback al mapa hardcodeado si el rol no tiene filas o la BD
 * falla.
 */
import { describe, it, expect } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

import { buildMatrixFromRows, resolveChannelsFromDb } from "../routing";

const ORG = "11111111-1111-4111-8111-111111111111";
const ROLE_ID = "22222222-2222-4222-8222-222222222222";

describe("buildMatrixFromRows", () => {
  it("usa las filas provistas y completa las faltantes con FALLBACK_DEFAULTS", () => {
    const matrix = buildMatrixFromRows([
      { severity: "CRITICAL", channel: "INBOX", enabled: true },
      { severity: "CRITICAL", channel: "EMAIL", enabled: false }, // override explícito: sin email en crítico
    ]);
    expect(matrix.critical).toEqual({ inbox: true, email: false });
    // WARNING/INFO no vinieron en `rows` → FALLBACK_DEFAULTS (INBOX_ONLY).
    expect(matrix.warning).toEqual({ inbox: true, email: false });
    expect(matrix.info).toEqual({ inbox: true, email: false });
  });
});

describe("resolveChannelsFromDb", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  function makePrisma(): DeepMockProxy<PrismaClient> {
    return mockDeep<PrismaClient>();
  }

  it("roleCode null → cae directo al mapa hardcodeado (FALLBACK_DEFAULTS)", async () => {
    prisma = makePrisma();
    const channels = await resolveChannelsFromDb({
      prisma,
      organizationId: ORG,
      roleCode: null,
      severity: "WARNING",
      hasEmail: true,
    });
    expect(channels).toEqual({ inbox: true, email: false }); // FALLBACK_DEFAULTS.warning
    expect(prisma.role.findFirst).not.toHaveBeenCalled();
  });

  it("Role no existe en BD → fallback al mapa hardcodeado por roleCode", async () => {
    prisma = makePrisma();
    prisma.role.findFirst.mockResolvedValue(null as never);
    const channels = await resolveChannelsFromDb({
      prisma,
      organizationId: ORG,
      roleCode: "PHYSICIAN",
      severity: "INFO",
      hasEmail: true,
    });
    // DEFAULT_ROLE_DEFAULTS.PHYSICIAN.info = INBOX_ONLY
    expect(channels).toEqual({ inbox: true, email: false });
  });

  it("Role existe pero sin filas RoleNotificationDefault → fallback", async () => {
    prisma = makePrisma();
    prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID } as never);
    prisma.roleNotificationDefault.findMany.mockResolvedValue([] as never);
    const channels = await resolveChannelsFromDb({
      prisma,
      organizationId: ORG,
      roleCode: "NURSE",
      severity: "CRITICAL",
      hasEmail: true,
    });
    // DEFAULT_ROLE_DEFAULTS.NURSE.critical = ALL
    expect(channels).toEqual({ inbox: true, email: true });
  });

  it("Role con filas RoleNotificationDefault en BD → usa la matriz de BD, no el hardcodeo", async () => {
    prisma = makePrisma();
    prisma.role.findFirst.mockResolvedValue({ id: ROLE_ID } as never);
    // Rol nuevo CC-0031 (p.ej. FACTURACION) con WARNING+EMAIL habilitado en BD,
    // a diferencia de FALLBACK_DEFAULTS que lo tendría deshabilitado.
    prisma.roleNotificationDefault.findMany.mockResolvedValue([
      { severity: "WARNING", channel: "EMAIL", enabled: true },
      { severity: "WARNING", channel: "INBOX", enabled: true },
    ] as never);
    const channels = await resolveChannelsFromDb({
      prisma,
      organizationId: ORG,
      roleCode: "FACTURACION",
      severity: "WARNING",
      hasEmail: true,
    });
    expect(channels).toEqual({ inbox: true, email: true });
  });

  it("error de BD → degrada al mapa hardcodeado (fail-safe, nunca lanza)", async () => {
    prisma = makePrisma();
    prisma.role.findFirst.mockRejectedValue(new Error("connection lost"));
    const channels = await resolveChannelsFromDb({
      prisma,
      organizationId: ORG,
      roleCode: "ADMIN",
      severity: "CRITICAL",
      hasEmail: true,
    });
    // DEFAULT_ROLE_DEFAULTS.ADMIN.critical = ALL
    expect(channels).toEqual({ inbox: true, email: true });
  });
});
