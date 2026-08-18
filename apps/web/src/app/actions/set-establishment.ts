"use server";

/**
 * Server Action — fija la sede (establishment) activa de la sesión, tras el
 * paso 2 del login AxisMed (CC-0010).
 *
 * Espeja las validaciones de `set-organization.ts`: en vez de recibir un
 * organizationId y resolver el primer establishment, aquí el cliente ya
 * eligió el establishment (select de sede) y resolvemos + validamos la
 * organización dueña.
 *
 * Flujo:
 *   1. Valida que el establishment exista y esté activo.
 *   2. Valida que el usuario tenga membresía vigente en la organización
 *      dueña de ese establishment (defensa en profundidad — el cliente
 *      solo debería ofrecer sedes de sus propias orgs, pero no confiamos
 *      en el input).
 *   3. Setea cookies `his.org` + `his.estab`, borra `his.roles`/`his.orgs`
 *      (el subset de roles activos depende de la org elegida).
 *   4. revalidatePath para que las Server Components re-lean el tenant.
 */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@his/database";
import { getCurrentUser, HIS_COOKIES } from "@/lib/auth/session";

const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

export async function setEstablishment(establishmentId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("No autenticado");

  const establishment = await prisma.establishment.findFirst({
    where: { id: establishmentId, active: true },
    select: { id: true, organizationId: true },
  });
  if (!establishment) {
    throw new Error("Sede no encontrada o inactiva.");
  }

  const now = new Date();
  const membership = await prisma.userOrganizationRole.findFirst({
    where: {
      userId: user.id,
      organizationId: establishment.organizationId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
  });
  if (!membership) {
    throw new Error("No perteneces a la organización de esa sede.");
  }

  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ONE_WEEK_SECONDS,
  };

  const store = await cookies();
  store.set(HIS_COOKIES.ORG_COOKIE, establishment.organizationId, cookieOpts);
  store.set(HIS_COOKIES.ESTAB_COOKIE, establishment.id, cookieOpts);
  store.delete(HIS_COOKIES.ROLES_COOKIE);
  store.delete(HIS_COOKIES.ORGS_COOKIE);

  revalidatePath("/", "layout");

  return { ok: true, organizationId: establishment.organizationId, establishmentId: establishment.id };
}
