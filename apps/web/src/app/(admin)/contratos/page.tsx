/**
 * /contratos — Server Component: resuelve `roleCodes` del tenant (mismo
 * patrón que `/consultorios` y `/afiliados`) para que `ContratosShell` sepa
 * si puede ofrecer alta/edición.
 *
 * CC-0036 Ola 2 (REQ-HIS-AFIL-001 S2) — contratos de arrendamiento de
 * consultorio y devengo mensual. RBAC real vía
 * `requirePermission("contrato_arrendamiento.*")` en el router; `roleCodes`
 * acá solo gobierna si se muestran los botones de alta/acción (el 403 real
 * lo da el server).
 */
import { getTenantContext } from "@/lib/auth/session";
import { ContratosShell } from "./_components/contratos-shell";

export default async function ContratosPage() {
  const tenant = await getTenantContext();
  return <ContratosShell roleCodes={tenant?.roleCodes ?? []} />;
}
