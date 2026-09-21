/**
 * CC-0017 F2 — construcción de atributos runtime desde el TenantContext.
 * Separado de `guard.ts` para poder reusarlo en `firma.confirm`
 * (protectedProcedure, no pasa por `abacGuard`) sin duplicar lógica.
 *
 * R2.2 (Plan remediación 2026-09): `horaActual` evaluaba SIEMPRE en
 * "America/El_Salvador", fijo. El ABAC horario ahora evalúa en la TZ de la
 * organización del tenant (`resolverLocaleOrg`) — fallback exacto a SV si
 * la organización no tiene país/TZ resuelta.
 */
import type { TenantContext } from "@his/contracts";
import type { AbacAtributosRuntime } from "./types";
import { resolverLocaleOrg, FALLBACK_ORG_LOCALE } from "../lib/org-locale";

type PrismaLike = Parameters<typeof resolverLocaleOrg>[0];

/** Hora actual "HH:MM" (24h) en la zona horaria dada (default: fallback SV). */
export function horaActualHHMM(
  now: Date = new Date(),
  timeZone: string = FALLBACK_ORG_LOCALE.timeZone,
): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // en-GB con hour12:false produce "HH:MM".
  return fmt.format(now);
}

/**
 * Atributos base derivables del tenant, sin conocimiento del recurso
 * concreto. `usuarioActivo` se asume `true` — si el usuario tiene sesión
 * activa (llegó hasta aquí protectedProcedure/tenantProcedure), ya pasó por
 * Supabase auth; `User.active=false` se corta antes en `getTenantContext`
 * (memberships vigentes). Un caller que necesite el atributo real de BD
 * puede sobreescribirlo vía `extractAtributos`.
 */
export async function atributosDesdeContexto(
  prisma: PrismaLike,
  tenant: TenantContext,
): Promise<AbacAtributosRuntime> {
  const { timeZone } = await resolverLocaleOrg(prisma, tenant.organizationId);
  return {
    rol: tenant.roleCodes,
    establecimiento: tenant.establishmentId,
    servicio: tenant.assignedServiceUnitCodes,
    horaActual: horaActualHHMM(new Date(), timeZone),
    usuarioActivo: true,
  };
}
