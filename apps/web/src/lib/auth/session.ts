/**
 * Helpers de sesión y tenant context para Server Components.
 *
 * Flujo (TDR §6.1):
 *   1. Supabase auth.getUser() → identidad federada.
 *   2. Sync/upsert en tabla `User` local por email.
 *   3. Resuelve organización activa: cookie `his.org` o primera membresía.
 *   4. Establecimiento activo: cookie `his.estab` o el primero activo de la org.
 *
 * IMPORTANTE — Pool exhaustion fix:
 *   `getCurrentUser`, `getTenantContext` y `getVisibleOrgIds` están envueltos
 *   en `cache()` de React Server Components. Eso garantiza una sola llamada
 *   por request HTTP — críticamente importante porque cada llamada hace
 *   `prisma.user.upsert()` que consume una conexión del pool de Supabase
 *   (15 max en session mode). Sin la memoización, una page que se compone
 *   de layout + Server Component + sidebar agotaba el pool en producción
 *   con error `(EMAXCONNSESSION) max clients reached in session mode`.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@his/database";
import type { TenantContext } from "@his/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ORG_COOKIE = "his.org";
const ESTAB_COOKIE = "his.estab";
// CSV de role codes activos seleccionados por el usuario (subset de los
// que tiene en la org activa). Si está vacía o ausente: usa todos.
const ROLES_COOKIE = "his.roles";
// CSV de organization IDs ADICIONALES a la primaria, para visibilidad
// cross-org de roles directivos/gerenciales (DIR, ADM, JEFE, GERENTE).
// Solo se usa para consultas opt-in (dashboards, reports). Las queries
// transaccionales siguen filtrando por organizationId primaria.
const ORGS_COOKIE = "his.orgs";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const supaUser = data.user;
  if (!supaUser?.email) return null;

  const fullName =
    (supaUser.user_metadata?.full_name as string | undefined) ??
    (supaUser.user_metadata?.name as string | undefined) ??
    supaUser.email;

  // Sync local con tabla User. Email es @unique y citext.
  const user = await prisma.user.upsert({
    where: { email: supaUser.email },
    update: { lastLoginAt: new Date() },
    create: {
      email: supaUser.email,
      fullName,
      active: true,
    },
  });

  return { id: user.id, email: user.email, fullName: user.fullName };
});

export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const cookieStore = cookies();
  const orgCookie = cookieStore.get(ORG_COOKIE)?.value;
  const estabCookie = cookieStore.get(ESTAB_COOKIE)?.value;

  const now = new Date();
  const memberships = await prisma.userOrganizationRole.findMany({
    where: {
      userId: user.id,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
    include: { organization: true, role: true },
  });
  if (memberships.length === 0) return null;

  const chosen =
    memberships.find((m) => m.organizationId === orgCookie) ?? memberships[0]!;

  const establishments = await prisma.establishment.findMany({
    where: { organizationId: chosen.organizationId, active: true },
    orderBy: { code: "asc" },
  });
  const establishmentId =
    establishments.find((e) => e.id === estabCookie)?.id ?? establishments[0]?.id;

  // Roles del usuario en la org elegida (todos los que tiene asignados).
  const availableRoleCodes = memberships
    .filter((m) => m.organizationId === chosen.organizationId)
    .map((m) => m.role.code);

  // Subconjunto activo seleccionado por el usuario vía cookie his.roles.
  // Semántica restrictiva: si el usuario marca solo ENF, requireRole(['MC'])
  // falla aunque tenga MC en availableRoleCodes. Sirve para auditoría
  // (la firma queda con el rol activo, no con el más privilegiado).
  // Default cuando la cookie está ausente o vacía: TODOS (compat backward).
  const rolesCookieValue = cookieStore.get(ROLES_COOKIE)?.value;
  const selectedFromCookie = rolesCookieValue
    ? rolesCookieValue.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const activeRoleCodes =
    selectedFromCookie.length > 0
      ? availableRoleCodes.filter((code) => selectedFromCookie.includes(code))
      : availableRoleCodes;

  return {
    userId: user.id,
    countryId: chosen.organization.countryId,
    organizationId: chosen.organizationId,
    establishmentId,
    // `roleCodes` mantiene la semántica del contrato: lo que el motor usa
    // para autorización en runtime. Cuando el usuario marca un subset, ese
    // subset gobierna.
    roleCodes: activeRoleCodes.length > 0 ? activeRoleCodes : availableRoleCodes,
  };
});

/**
 * IDs de organizaciones ADICIONALES con visibilidad para el usuario actual,
 * leídos de la cookie `his.orgs`. Solo populated cuando el usuario tiene un
 * rol multiorg (DIR, ADM, JEFE, GERENTE) activo y eligió ≥2 orgs en el
 * switcher. Se valida que todas pertenezcan a sus membresías vigentes —
 * cualquier ID no autorizado se descarta silenciosamente.
 *
 * Uso típico: dashboards o reports consolidados que opt-in a esta lista.
 *   const visibleOrgs = await getVisibleOrgIds();  // [primaria, ...adicionales]
 */
export const getVisibleOrgIds = cache(async (): Promise<string[]> => {
  const user = await getCurrentUser();
  if (!user) return [];

  const cookieStore = cookies();
  const orgCookie = cookieStore.get(ORG_COOKIE)?.value;
  const orgsCookie = cookieStore.get(ORGS_COOKIE)?.value ?? "";

  const ids = new Set<string>();
  if (orgCookie) ids.add(orgCookie);
  for (const id of orgsCookie.split(",").map((s) => s.trim()).filter(Boolean)) {
    ids.add(id);
  }
  if (ids.size === 0) return [];

  // Validar que el usuario realmente tiene membresía en cada ID — defensa
  // en profundidad contra cookie tampering.
  const now = new Date();
  const memberships = await prisma.userOrganizationRole.findMany({
    where: {
      userId: user.id,
      organizationId: { in: Array.from(ids) },
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
    select: { organizationId: true },
  });
  const valid = new Set(memberships.map((m) => m.organizationId));
  return Array.from(ids).filter((id) => valid.has(id));
});

export const HIS_COOKIES = { ORG_COOKIE, ESTAB_COOKIE, ROLES_COOKIE, ORGS_COOKIE };
