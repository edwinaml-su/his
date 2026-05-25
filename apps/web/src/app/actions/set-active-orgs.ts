"use server";

/**
 * Server Action — selecciona organizaciones ADICIONALES con visibilidad para
 * el usuario (cookie `his.orgs`).
 *
 * Solo aplica cuando el usuario tiene un rol multi-org activo
 * (DIR, ADM, JEFE, GERENTE — ver `lib/auth/multi-org-roles.ts`). Para roles
 * regulares el switcher debe operar en single-select y esta action ni se
 * invoca.
 *
 * La cookie `his.org` (org PRIMARIA) sigue siendo la única usada por queries
 * transaccionales para trazabilidad. `his.orgs` es opt-in: dashboards y
 * reports cross-org pueden leerla via `getVisibleOrgIds()` de session.ts.
 *
 * Defensa en profundidad: validamos que TODOS los IDs sean membresías
 * vigentes del usuario; los no válidos se descartan silenciosamente.
 */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@his/database";
import { getCurrentUser, HIS_COOKIES } from "@/lib/auth/session";

const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

export interface SetActiveOrgsResult {
  ok: boolean;
  activeOrgs?: string[];
  error?: string;
}

export async function setActiveOrgs(organizationIds: string[]): Promise<SetActiveOrgsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "No autenticado" };

  const now = new Date();
  const memberships = await prisma.userOrganizationRole.findMany({
    where: {
      userId: user.id,
      organizationId: { in: organizationIds },
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
    select: { organizationId: true },
  });
  const valid = Array.from(new Set(memberships.map((m) => m.organizationId)));

  const store = cookies();
  store.set(HIS_COOKIES.ORGS_COOKIE, valid.join(","), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ONE_WEEK_SECONDS,
  });

  revalidatePath("/", "layout");
  return { ok: true, activeOrgs: valid };
}
