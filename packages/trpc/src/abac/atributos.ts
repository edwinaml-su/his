/**
 * CC-0017 F2 — construcción de atributos runtime desde el TenantContext.
 * Separado de `guard.ts` para poder reusarlo en `firma.confirm`
 * (protectedProcedure, no pasa por `abacGuard`) sin duplicar lógica.
 */
import type { TenantContext } from "@his/contracts";
import type { AbacAtributosRuntime } from "./types";

const TIMEZONE = "America/El_Salvador";

/** Hora actual "HH:MM" (24h) en la zona horaria fija del proyecto. */
export function horaActualHHMM(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
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
export function atributosDesdeContexto(tenant: TenantContext): AbacAtributosRuntime {
  return {
    rol: tenant.roleCodes,
    establecimiento: tenant.establishmentId,
    servicio: tenant.assignedServiceUnitCodes,
    horaActual: horaActualHHMM(),
    usuarioActivo: true,
  };
}
