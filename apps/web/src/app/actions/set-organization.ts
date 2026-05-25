"use server";

/**
 * Server Action — cambia la organización activa de la sesión.
 *
 * Flujo (US-1.5):
 *   1. Cliente invoca con organizationId.
 *   2. Validamos que el usuario tenga membresía vigente en esa org.
 *   3. Seteamos cookies `his.org` y `his.estab` (primer establishment activo).
 *   4. revalidatePath("/") para que toda Server Component re-renderee con
 *      el nuevo tenant context.
 *
 * Cookies son httpOnly + secure + sameSite=lax (configuración estándar
 * para auth tokens — no las lee JS del cliente).
 */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@his/database";
import { getCurrentUser } from "@/lib/auth/session";
import { HIS_COOKIES } from "@/lib/auth/session";

const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

export async function setOrganization(organizationId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("No autenticado");

  // Validar membresía vigente — defensa en profundidad: el cliente NO debería
  // ofrecer orgs no autorizadas, pero si llega una request adversaria
  // bloqueamos aquí.
  const now = new Date();
  const membership = await prisma.userOrganizationRole.findFirst({
    where: {
      userId: user.id,
      organizationId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
  });
  if (!membership) {
    throw new Error("No perteneces a esa organización.");
  }

  // Resolver primer establishment activo de la org (puede no haber).
  const firstEstab = await prisma.establishment.findFirst({
    where: { organizationId, active: true },
    orderBy: { code: "asc" },
    select: { id: true },
  });

  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ONE_WEEK_SECONDS,
  };

  const store = cookies();
  store.set(HIS_COOKIES.ORG_COOKIE, organizationId, cookieOpts);
  if (firstEstab) {
    store.set(HIS_COOKIES.ESTAB_COOKIE, firstEstab.id, cookieOpts);
  } else {
    store.delete(HIS_COOKIES.ESTAB_COOKIE);
  }
  // Resetear roles activos al cambiar de org: los codes válidos cambian.
  // Backend usará todos los disponibles en la nueva org como default.
  store.delete(HIS_COOKIES.ROLES_COOKIE);

  // Refrescar todas las Server Components dependientes de tenant context.
  revalidatePath("/", "layout");

  return { ok: true, organizationId, establishmentId: firstEstab?.id ?? null };
}
