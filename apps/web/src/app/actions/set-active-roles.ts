"use server";

/**
 * Server Action — selecciona el subconjunto de roles activos del usuario.
 *
 * Semántica RESTRICTIVA: el usuario opera con la UNIÓN de permisos de los
 * roles seleccionados, no con todos los que tiene. Sirve para:
 *   - Cumplimiento NTEC: la firma queda con el rol activo (auditoría).
 *   - Separación de funciones (un médico que también es DIR puede elegir
 *     con qué rol está actuando en cada sesión).
 *
 * Validación de seguridad: solo se aceptan codes que el usuario REALMENTE
 * tiene asignados en la organización activa. Si llega un code que no le
 * pertenece, lo descartamos silenciosamente.
 *
 * Cookie `his.roles` = CSV de codes. Si vacía → backend usa todos.
 */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@his/database";
import { getCurrentUser, HIS_COOKIES } from "@/lib/auth/session";

const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

export async function setActiveRoles(roleCodes: string[]) {
  const user = await getCurrentUser();
  if (!user) throw new Error("No autenticado");

  const store = cookies();
  const organizationId = store.get(HIS_COOKIES.ORG_COOKIE)?.value;
  if (!organizationId) throw new Error("Sin organización activa");

  // Filtrar a los codes que el usuario realmente tiene en la org activa.
  const now = new Date();
  const memberships = await prisma.userOrganizationRole.findMany({
    where: {
      userId: user.id,
      organizationId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
    include: { role: { select: { code: true } } },
  });
  const userCodes = new Set(memberships.map((m) => m.role.code));
  const validated = roleCodes.filter((c) => userCodes.has(c));

  store.set(HIS_COOKIES.ROLES_COOKIE, validated.join(","), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ONE_WEEK_SECONDS,
  });

  revalidatePath("/", "layout");
  return { ok: true, activeRoles: validated };
}
