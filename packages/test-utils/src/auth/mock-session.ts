/**
 * Sesión mockeada para tests unitarios y de integración.
 * Genera un `TRPCContext.user + tenant` listo para inyectar en routers.
 */
// Tipo inlineado (duplicado minimo de @his/contracts TenantContext) para
// romper el ciclo @his/contracts <-> @his/test-utils detectado por Turborepo.
// Si la forma cambia en contracts, actualizar aqui tambien.
type TenantContext = {
  userId: string;
  countryId: string;
  organizationId: string;
  establishmentId?: string;
  roleCodes: string[];
};

export interface MockSessionUser {
  id: string;
  email: string;
  fullName: string;
}

export const MOCK_USER_ADMIN: MockSessionUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "qa.admin@his.test",
  fullName: "QA Admin",
};

export const MOCK_USER_TRIAGIST: MockSessionUser = {
  id: "00000000-0000-0000-0000-000000000002",
  email: "qa.triagist@his.test",
  fullName: "QA Triagist",
};

export const MOCK_TENANT: TenantContext = {
  userId: MOCK_USER_ADMIN.id,
  organizationId: "00000000-0000-0000-0000-0000000000aa",
  countryId: "00000000-0000-0000-0000-0000000000bb",
  establishmentId: "00000000-0000-0000-0000-0000000000cc",
  roleCodes: ["ADMIN", "PHYSICIAN", "TRIAGIST"],
};

export const MOCK_TENANT_NO_ESTABLISHMENT: TenantContext = {
  ...MOCK_TENANT,
  establishmentId: undefined,
};

/** Helper de conveniencia para construir un contexto tRPC mínimo en tests. */
export function makeMockSession(overrides: {
  user?: MockSessionUser | null;
  tenant?: TenantContext | null;
} = {}) {
  return {
    user: overrides.user === undefined ? MOCK_USER_ADMIN : overrides.user,
    tenant: overrides.tenant === undefined ? MOCK_TENANT : overrides.tenant,
  };
}
