/**
 * /consultorios — Server Component: resuelve `roleCodes` del tenant (mismo
 * patrón que `organizations/habitaciones`) para que `ConsultoriosShell` sepa
 * si puede ofrecer alta/edición.
 *
 * CC-0036 Ola 1B (REQ-HIS-AFIL-001 US.AFIL.1.1) — catálogo de consultorios
 * por sede. RBAC real vía `requirePermission("consultorio.*")` en el
 * router; `roleCodes` acá solo gobierna si se muestra el botón de alta
 * (misma UX que `/organizations/habitaciones` — el 403 real lo da el server).
 */
import { getTenantContext } from "@/lib/auth/session";
import { ConsultoriosShell } from "./_components/consultorios-shell";

export default async function ConsultoriosPage() {
  const tenant = await getTenantContext();
  return <ConsultoriosShell roleCodes={tenant?.roleCodes ?? []} />;
}
