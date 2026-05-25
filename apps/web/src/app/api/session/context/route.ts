/**
 * GET /api/session/context
 *
 * Devuelve para el usuario autenticado:
 *   - Sus organizaciones disponibles (con todos los roles agrupados por org)
 *   - La org activa (de cookie `his.org`)
 *   - Los role codes activos seleccionados (de cookie `his.roles`)
 *
 * Lo consume el componente <OrgRoleSwitcher /> para poblar los dropdowns.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@his/database";
import { getCurrentUser, HIS_COOKIES } from "@/lib/auth/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }

  const now = new Date();
  const memberships = await prisma.userOrganizationRole.findMany({
    where: {
      userId: user.id,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
    select: {
      organizationId: true,
      organization: { select: { id: true, tradeName: true, legalName: true } },
      role:         { select: { code: true, name: true } },
    },
  });

  type OrgWithRoles = {
    id: string;
    name: string;
    code: string;
    roles: Array<{ code: string; name: string }>;
  };
  const byOrg = new Map<string, OrgWithRoles>();
  for (const m of memberships) {
    const displayName = m.organization.tradeName ?? m.organization.legalName;
    const role = { code: m.role.code, name: m.role.name };
    const existing = byOrg.get(m.organization.id);
    if (existing) {
      if (!existing.roles.some((r) => r.code === role.code)) existing.roles.push(role);
    } else {
      byOrg.set(m.organization.id, {
        id:    m.organization.id,
        name:  displayName,
        code:  m.organization.legalName,
        roles: [role],
      });
    }
  }
  const organizations = Array.from(byOrg.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  );

  const store = cookies();
  const activeOrgId  = store.get(HIS_COOKIES.ORG_COOKIE)?.value ?? organizations[0]?.id ?? null;
  const rolesCookie  = store.get(HIS_COOKIES.ROLES_COOKIE)?.value ?? "";
  const activeRoles  = rolesCookie ? rolesCookie.split(",").map((s) => s.trim()).filter(Boolean) : [];

  return NextResponse.json({
    user: { id: user.id, email: user.email, fullName: user.fullName },
    organizations,
    activeOrgId,
    activeRoles,
  });
}
