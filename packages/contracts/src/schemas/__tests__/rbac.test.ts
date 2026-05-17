/**
 * Tests de los schemas Zod de RBAC (US-2.3).
 *
 * Cubre: permissionEffectEnum, roleSchema, permissionSchema,
 * rolePermissionSchema, rbacListRolesInput, rbacCreateRoleInput,
 * rbacUpdateRoleInput, rbacSetRolePermissionsInput, roleWithStatsSchema.
 */
import { describe, it, expect } from "vitest";
import {
  permissionEffectEnum,
  roleSchema,
  permissionSchema,
  rolePermissionSchema,
  rbacListRolesInput,
  rbacGetRoleInput,
  rbacCreateRoleInput,
  rbacUpdateRoleInput,
  rbacDeactivateRoleInput,
  rbacSetRolePermissionsInput,
  roleWithStatsSchema,
  BASE_ROLE_CODES,
  KNOWN_RESOURCES,
} from "../rbac";

const uuid = "00000000-0000-0000-0000-000000000001";
const uuid2 = "00000000-0000-0000-0000-000000000002";

// ---------------------------------------------------------------------------
// permissionEffectEnum
// ---------------------------------------------------------------------------

describe("permissionEffectEnum", () => {
  it("acepta ALLOW", () => {
    expect(permissionEffectEnum.safeParse("ALLOW").success).toBe(true);
  });

  it("acepta DENY", () => {
    expect(permissionEffectEnum.safeParse("DENY").success).toBe(true);
  });

  it("rechaza valor no definido", () => {
    expect(permissionEffectEnum.safeParse("GRANT").success).toBe(false);
  });

  it("rechaza string vacío", () => {
    expect(permissionEffectEnum.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BASE_ROLE_CODES / KNOWN_RESOURCES (constantes de dominio)
// ---------------------------------------------------------------------------

describe("BASE_ROLE_CODES", () => {
  it("incluye super_admin y medico", () => {
    expect(BASE_ROLE_CODES).toContain("super_admin");
    expect(BASE_ROLE_CODES).toContain("medico");
  });

  it("tiene al menos 6 roles base", () => {
    expect(BASE_ROLE_CODES.length).toBeGreaterThanOrEqual(6);
  });
});

describe("KNOWN_RESOURCES", () => {
  it("incluye patient, encounter, rbac", () => {
    expect(KNOWN_RESOURCES).toContain("patient");
    expect(KNOWN_RESOURCES).toContain("encounter");
    expect(KNOWN_RESOURCES).toContain("rbac");
  });
});

// ---------------------------------------------------------------------------
// roleSchema
// ---------------------------------------------------------------------------

describe("roleSchema", () => {
  const validRole = {
    id: uuid,
    organizationId: uuid2,
    code: "admin_clinico",
    name: "Administrador Clínico",
    active: true,
  };

  it("acepta rol válido", () => {
    expect(roleSchema.safeParse(validRole).success).toBe(true);
  });

  it("acepta organizationId null (rol global)", () => {
    expect(roleSchema.safeParse({ ...validRole, organizationId: null }).success).toBe(true);
  });

  it("acepta description null", () => {
    expect(roleSchema.safeParse({ ...validRole, description: null }).success).toBe(true);
  });

  it("rechaza code menor a 2 caracteres", () => {
    expect(roleSchema.safeParse({ ...validRole, code: "a" }).success).toBe(false);
  });

  it("rechaza code mayor a 60 caracteres", () => {
    expect(roleSchema.safeParse({ ...validRole, code: "a".repeat(61) }).success).toBe(false);
  });

  it("rechaza code con caracteres especiales no permitidos", () => {
    expect(roleSchema.safeParse({ ...validRole, code: "admin clinico" }).success).toBe(false);
    expect(roleSchema.safeParse({ ...validRole, code: "admin@clinico" }).success).toBe(false);
  });

  it("acepta code con guión, punto y underscore", () => {
    expect(roleSchema.safeParse({ ...validRole, code: "admin_clinico-v1.0" }).success).toBe(true);
  });

  it("rechaza name vacío", () => {
    expect(roleSchema.safeParse({ ...validRole, name: "" }).success).toBe(false);
  });

  it("rechaza name mayor a 120 caracteres", () => {
    expect(roleSchema.safeParse({ ...validRole, name: "a".repeat(121) }).success).toBe(false);
  });

  it("rechaza id no-UUID", () => {
    expect(roleSchema.safeParse({ ...validRole, id: "not-a-uuid" }).success).toBe(false);
  });

  it("trim en code y name", () => {
    const r = roleSchema.safeParse({ ...validRole, code: "  medico  ", name: "  Médico  " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.code).toBe("medico");
      expect(r.data.name).toBe("Médico");
    }
  });
});

// ---------------------------------------------------------------------------
// permissionSchema
// ---------------------------------------------------------------------------

describe("permissionSchema", () => {
  const validPerm = {
    id: uuid,
    code: "patient:read",
    resource: "patient",
    action: "read",
  };

  it("acepta permiso válido", () => {
    expect(permissionSchema.safeParse(validPerm).success).toBe(true);
  });

  it("rechaza code menor a 2 caracteres", () => {
    expect(permissionSchema.safeParse({ ...validPerm, code: "a" }).success).toBe(false);
  });

  it("rechaza resource vacío", () => {
    expect(permissionSchema.safeParse({ ...validPerm, resource: "" }).success).toBe(false);
  });

  it("rechaza action vacío", () => {
    expect(permissionSchema.safeParse({ ...validPerm, action: "" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rolePermissionSchema
// ---------------------------------------------------------------------------

describe("rolePermissionSchema", () => {
  it("acepta ALLOW", () => {
    expect(rolePermissionSchema.safeParse({ permissionId: uuid, effect: "ALLOW" }).success).toBe(true);
  });

  it("acepta DENY", () => {
    expect(rolePermissionSchema.safeParse({ permissionId: uuid, effect: "DENY" }).success).toBe(true);
  });

  it("rechaza permissionId no-UUID", () => {
    expect(rolePermissionSchema.safeParse({ permissionId: "bad", effect: "ALLOW" }).success).toBe(false);
  });

  it("rechaza effect inválido", () => {
    expect(rolePermissionSchema.safeParse({ permissionId: uuid, effect: "MAYBE" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rbacListRolesInput
// ---------------------------------------------------------------------------

describe("rbacListRolesInput", () => {
  it("defaults vacíos: includeGlobal=true, activeOnly=true", () => {
    const r = rbacListRolesInput.parse({});
    expect(r.includeGlobal).toBe(true);
    expect(r.activeOnly).toBe(true);
    expect(r.search).toBeUndefined();
  });

  it("acepta includeGlobal=false", () => {
    const r = rbacListRolesInput.parse({ includeGlobal: false });
    expect(r.includeGlobal).toBe(false);
  });

  it("acepta search válido", () => {
    const r = rbacListRolesInput.parse({ search: "admin" });
    expect(r.search).toBe("admin");
  });

  it("rechaza search vacío", () => {
    expect(rbacListRolesInput.safeParse({ search: "" }).success).toBe(false);
  });

  it("rechaza search mayor a 120 caracteres", () => {
    expect(rbacListRolesInput.safeParse({ search: "a".repeat(121) }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rbacGetRoleInput
// ---------------------------------------------------------------------------

describe("rbacGetRoleInput", () => {
  it("acepta UUID válido", () => {
    expect(rbacGetRoleInput.safeParse({ id: uuid }).success).toBe(true);
  });

  it("rechaza id no-UUID", () => {
    expect(rbacGetRoleInput.safeParse({ id: "123" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rbacCreateRoleInput
// ---------------------------------------------------------------------------

describe("rbacCreateRoleInput", () => {
  const base = { code: "medico", name: "Médico" };

  it("acepta input mínimo", () => {
    expect(rbacCreateRoleInput.safeParse(base).success).toBe(true);
  });

  it("acepta organizationId null (global)", () => {
    expect(rbacCreateRoleInput.safeParse({ ...base, organizationId: null }).success).toBe(true);
  });

  it("acepta organizationId UUID", () => {
    expect(rbacCreateRoleInput.safeParse({ ...base, organizationId: uuid }).success).toBe(true);
  });

  it("rechaza code con espacio", () => {
    expect(rbacCreateRoleInput.safeParse({ ...base, code: "mi rol" }).success).toBe(false);
  });

  it("rechaza name menor a 2 caracteres", () => {
    expect(rbacCreateRoleInput.safeParse({ ...base, name: "A" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rbacUpdateRoleInput
// ---------------------------------------------------------------------------

describe("rbacUpdateRoleInput", () => {
  it("acepta solo id (sin campos opcionales)", () => {
    expect(rbacUpdateRoleInput.safeParse({ id: uuid }).success).toBe(true);
  });

  it("acepta active=false (desactivar)", () => {
    expect(rbacUpdateRoleInput.safeParse({ id: uuid, active: false }).success).toBe(true);
  });

  it("acepta description null", () => {
    expect(rbacUpdateRoleInput.safeParse({ id: uuid, description: null }).success).toBe(true);
  });

  it("rechaza id no-UUID", () => {
    expect(rbacUpdateRoleInput.safeParse({ id: "bad", name: "Test" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rbacDeactivateRoleInput
// ---------------------------------------------------------------------------

describe("rbacDeactivateRoleInput", () => {
  it("acepta UUID válido", () => {
    expect(rbacDeactivateRoleInput.safeParse({ id: uuid }).success).toBe(true);
  });

  it("rechaza id no-UUID", () => {
    expect(rbacDeactivateRoleInput.safeParse({ id: "bad" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rbacSetRolePermissionsInput
// ---------------------------------------------------------------------------

describe("rbacSetRolePermissionsInput", () => {
  it("acepta array vacío de permisos", () => {
    expect(rbacSetRolePermissionsInput.safeParse({ roleId: uuid, permissions: [] }).success).toBe(true);
  });

  it("acepta permisos ALLOW y DENY mezclados", () => {
    const r = rbacSetRolePermissionsInput.safeParse({
      roleId: uuid,
      permissions: [
        { permissionId: uuid, effect: "ALLOW" },
        { permissionId: uuid2, effect: "DENY" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza roleId no-UUID", () => {
    expect(rbacSetRolePermissionsInput.safeParse({ roleId: "bad", permissions: [] }).success).toBe(false);
  });

  it("rechaza permissionId no-UUID en array", () => {
    expect(rbacSetRolePermissionsInput.safeParse({
      roleId: uuid,
      permissions: [{ permissionId: "bad", effect: "ALLOW" }],
    }).success).toBe(false);
  });

  it("rechaza effect inválido en array", () => {
    expect(rbacSetRolePermissionsInput.safeParse({
      roleId: uuid,
      permissions: [{ permissionId: uuid, effect: "MAYBE" }],
    }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// roleWithStatsSchema
// ---------------------------------------------------------------------------

describe("roleWithStatsSchema", () => {
  const validStats = {
    id: uuid,
    organizationId: null,
    code: "admin",
    name: "Admin",
    active: true,
    userCount: 5,
    allowCount: 10,
    permissionCount: 12,
  };

  it("acepta stats válidos", () => {
    expect(roleWithStatsSchema.safeParse(validStats).success).toBe(true);
  });

  it("rechaza userCount negativo", () => {
    expect(roleWithStatsSchema.safeParse({ ...validStats, userCount: -1 }).success).toBe(false);
  });

  it("rechaza allowCount no entero", () => {
    expect(roleWithStatsSchema.safeParse({ ...validStats, allowCount: 1.5 }).success).toBe(false);
  });

  it("rechaza permissionCount negativo", () => {
    expect(roleWithStatsSchema.safeParse({ ...validStats, permissionCount: -1 }).success).toBe(false);
  });
});
