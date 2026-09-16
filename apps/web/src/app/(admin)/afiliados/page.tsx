/**
 * /afiliados — Server Component: resuelve `roleCodes` del tenant (mismo
 * patrón que `/consultorios`) para que `AfiliadosShell` sepa si puede
 * ofrecer alta/edición/baja.
 *
 * CC-0036 Ola 1B (REQ-HIS-AFIL-001 US.AFIL.1.2) — catálogo de médicos
 * afiliados (contraparte económica). RBAC real vía
 * `requirePermission("medico_afiliado.*")` en el router.
 */
import { getTenantContext } from "@/lib/auth/session";
import { AfiliadosShell } from "./_components/afiliados-shell";

export default async function AfiliadosPage() {
  const tenant = await getTenantContext();
  return <AfiliadosShell roleCodes={tenant?.roleCodes ?? []} />;
}
