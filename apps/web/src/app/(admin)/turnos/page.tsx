/**
 * /turnos — CC-0036 Ola 1A: rostering 24/7 de médicos generales y enfermería
 * por sede (REQ-HIS-AFIL-001 Bloque C). Server Component: resuelve
 * `roleCodes` del tenant (mismo patrón que `organizations/habitaciones`)
 * para que `TurnosShell` sepa si puede programar/publicar (gate real vive
 * en `turno.router.ts` vía `requirePermission`; esto solo habilita/oculta
 * controles en la UI).
 */
import { getTenantContext } from "@/lib/auth/session";
import { TurnosShell } from "./_components/turnos-shell";

export default async function TurnosPage() {
  const tenant = await getTenantContext();
  return <TurnosShell roleCodes={tenant?.roleCodes ?? []} />;
}
