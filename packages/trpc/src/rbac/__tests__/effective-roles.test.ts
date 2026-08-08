/**
 * CC-0017 — tests del motor de roles/permisos efectivos.
 *
 * Cubre el contrato de seguridad completo:
 *   §1 fail-safe (caso base == comportamiento pre-CC-0017, sin importar por
 *      qué la BD no responde: mock sin configurar, tabla vacía, error).
 *   §2 herencia transitiva + anti-ciclo.
 *   §3 alias de código.
 *   §4 permisos efectivos: DENY gana sobre ALLOW, fail-safe a Map vacío.
 *
 * Nota: NO hay caching entre llamadas (ver comentario de cabecera en
 * effective-roles.ts) — se descartó a propósito porque el `tenant` de estos
 * mismos tests es a menudo un objeto reusado entre `it()` (patrón MOCK_TENANT
 * del repo), y un WeakMap module-scoped filtraba resultados entre tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { getEffectiveRoleCodes, getEffectivePermissions } from "../effective-roles";

const ORG_ID = "00000000-0000-0000-0000-0000000000aa";

function tenant(roleCodes: string[]) {
  // Objeto NUEVO por test — la cache es por-referencia, así que cada test
  // necesita su propia identidad de tenant para no leer resultados de otro.
  return { roleCodes, organizationId: ORG_ID };
}

describe("effective-roles — getEffectiveRoleCodes", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ---------------------------------------------------------------------
  // §1 — Fail-safe: caso base debe ser BIT-IDÉNTICO al roleCodes original.
  // ---------------------------------------------------------------------

  it("[fail-safe] sin mock configurado (mockDeep -> undefined) devuelve roleCodes sin cambios", async () => {
    const t = tenant(["PHYSICIAN", "NURSE"]);
    const result = await getEffectiveRoleCodes(prisma, t);
    expect(result).toEqual(["PHYSICIAN", "NURSE"]);
  });

  it("[fail-safe] Role.findMany devuelve [] (tablas nuevas, sin seed) devuelve roleCodes sin cambios", async () => {
    prisma.role.findMany.mockResolvedValue([] as never);
    const t = tenant(["ADMIN"]);
    const result = await getEffectiveRoleCodes(prisma, t);
    expect(result).toEqual(["ADMIN"]);
  });

  it("[fail-safe] Role.findMany lanza error devuelve roleCodes sin cambios (no rompe autorización)", async () => {
    prisma.role.findMany.mockRejectedValue(new Error("conexión perdida") as never);
    const t = tenant(["DIR"]);
    const result = await getEffectiveRoleCodes(prisma, t);
    expect(result).toEqual(["DIR"]);
  });

  it("[fail-safe] roleCodes vacío devuelve [] sin tocar la BD", async () => {
    const t = tenant([]);
    const result = await getEffectiveRoleCodes(prisma, t);
    expect(result).toEqual([]);
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });

  it("[fail-safe] Role rows resueltas pero SIN inheritsFromRoleId (caso normal sin config) no agrega códigos", async () => {
    prisma.role.findMany.mockResolvedValueOnce([
      { id: "r1", code: "PHYSICIAN", inheritsFromRoleId: null },
    ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
    const t = tenant(["PHYSICIAN"]);
    const result = await getEffectiveRoleCodes(prisma, t);
    expect(result).toEqual(["PHYSICIAN"]);
  });

  // ---------------------------------------------------------------------
  // §2 — Herencia
  // ---------------------------------------------------------------------

  it("expande un nivel de herencia (rol nuevo hereda de PHYSICIAN)", async () => {
    prisma.role.findMany
      .mockResolvedValueOnce([
        { id: "child", code: "MEDICO_RESIDENTE_JR", inheritsFromRoleId: "parent" },
      ] as never)
      .mockResolvedValueOnce([
        { id: "parent", code: "PHYSICIAN", inheritsFromRoleId: null },
      ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);

    const t = tenant(["MEDICO_RESIDENTE_JR"]);
    const result = await getEffectiveRoleCodes(prisma, t);
    expect(result.sort()).toEqual(["MEDICO_RESIDENTE_JR", "PHYSICIAN"]);
  });

  it("expande herencia transitiva A -> B -> C", async () => {
    prisma.role.findMany
      .mockResolvedValueOnce([{ id: "a", code: "A", inheritsFromRoleId: "b" }] as never)
      .mockResolvedValueOnce([{ id: "b", code: "B", inheritsFromRoleId: "c" }] as never)
      .mockResolvedValueOnce([{ id: "c", code: "C", inheritsFromRoleId: null }] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);

    const t = tenant(["A"]);
    const result = await getEffectiveRoleCodes(prisma, t);
    expect(result.sort()).toEqual(["A", "B", "C"]);
  });

  it("anti-ciclo: A hereda de B, B hereda de A — termina sin loop infinito", async () => {
    prisma.role.findMany
      .mockResolvedValueOnce([{ id: "a", code: "A", inheritsFromRoleId: "b" }] as never)
      .mockResolvedValueOnce([{ id: "b", code: "B", inheritsFromRoleId: "a" }] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);

    const t = tenant(["A"]);
    const result = await getEffectiveRoleCodes(prisma, t);
    // Debe incluir A y B (ambos alcanzables) pero terminar (no colgarse).
    expect(result.sort()).toEqual(["A", "B"]);
  });

  // ---------------------------------------------------------------------
  // §3 — Alias
  // ---------------------------------------------------------------------

  it("agrega el código canónico cuando hay un alias resuelto (MEDICO -> PHYSICIAN)", async () => {
    prisma.role.findMany.mockResolvedValueOnce([
      { id: "r1", code: "MEDICO", inheritsFromRoleId: null },
    ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([
      { canonicalCode: "PHYSICIAN" },
    ] as never);

    const t = tenant(["MEDICO"]);
    const result = await getEffectiveRoleCodes(prisma, t);
    expect(result.sort()).toEqual(["MEDICO", "PHYSICIAN"]);
  });
});

describe("effective-roles — getEffectivePermissions", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("[fail-safe] sin mocks configurados devuelve Map vacío (deniega por defecto)", async () => {
    const t = tenant(["PHYSICIAN"]);
    const result = await getEffectivePermissions(prisma, t);
    expect(result.size).toBe(0);
  });

  it("resuelve ALLOW cuando el rol tiene el permiso otorgado", async () => {
    prisma.role.findMany.mockResolvedValue([
      { id: "r1", code: "ADMIN", inheritsFromRoleId: null },
    ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
    prisma.rolePermission.findMany.mockResolvedValue([
      { effect: "ALLOW", permission: { code: "accounting.post" } },
    ] as never);

    const t = tenant(["ADMIN"]);
    const result = await getEffectivePermissions(prisma, t);
    expect(result.get("accounting.post")).toBe("ALLOW");
  });

  it("DENY gana sobre ALLOW cuando dos roles efectivos discrepan", async () => {
    prisma.role.findMany.mockResolvedValue([
      { id: "r1", code: "ROLE_A", inheritsFromRoleId: null },
      { id: "r2", code: "ROLE_B", inheritsFromRoleId: null },
    ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
    prisma.rolePermission.findMany.mockResolvedValue([
      { effect: "ALLOW", permission: { code: "patient.delete" } },
      { effect: "DENY", permission: { code: "patient.delete" } },
    ] as never);

    const t = tenant(["ROLE_A", "ROLE_B"]);
    const result = await getEffectivePermissions(prisma, t);
    expect(result.get("patient.delete")).toBe("DENY");
  });

  it("DENY gana sin importar el orden de llegada (ALLOW después de DENY)", async () => {
    prisma.role.findMany.mockResolvedValue([
      { id: "r1", code: "ROLE_A", inheritsFromRoleId: null },
    ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
    prisma.rolePermission.findMany.mockResolvedValue([
      { effect: "DENY", permission: { code: "patient.delete" } },
      { effect: "ALLOW", permission: { code: "patient.delete" } },
    ] as never);

    const t = tenant(["ROLE_A"]);
    const result = await getEffectivePermissions(prisma, t);
    expect(result.get("patient.delete")).toBe("DENY");
  });

  it("[fail-safe] RolePermission.findMany lanza error devuelve Map vacío", async () => {
    prisma.role.findMany.mockResolvedValue([
      { id: "r1", code: "ADMIN", inheritsFromRoleId: null },
    ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
    prisma.rolePermission.findMany.mockRejectedValue(new Error("boom") as never);

    const t = tenant(["ADMIN"]);
    const result = await getEffectivePermissions(prisma, t);
    expect(result.size).toBe(0);
  });
});
