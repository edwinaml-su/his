/**
 * Helpers de sesión y tenant context para Server Components.
 *
 * Flujo (TDR §6.1):
 *   1. Supabase auth.getUser() → identidad federada.
 *   2. Sync/upsert en tabla `User` local por email.
 *   3. Resuelve organización activa: cookie `his.org` o primera membresía.
 *   4. Establecimiento activo: cookie `his.estab` o el primero activo de la org.
 */
import { cookies } from "next/headers";
import { prisma } from "@his/database";
import type { TenantContext } from "@his/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ORG_COOKIE = "his.org";
const ESTAB_COOKIE = "his.estab";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
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
}

export async function getTenantContext(): Promise<TenantContext | null> {
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

  // Roles del usuario en la org elegida.
  const roleCodes = memberships
    .filter((m) => m.organizationId === chosen.organizationId)
    .map((m) => m.role.code);

  return {
    userId: user.id,
    countryId: chosen.organization.countryId,
    organizationId: chosen.organizationId,
    establishmentId,
    roleCodes,
  };
}

export const HIS_COOKIES = { ORG_COOKIE, ESTAB_COOKIE };
