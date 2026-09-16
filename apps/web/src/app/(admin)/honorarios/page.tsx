/**
 * /honorarios — Server Component: resuelve `roleCodes` del tenant (mismo
 * patrón que `/contratos`/`/consultorios`/`/afiliados`) para que
 * `HonorariosShell` sepa si puede ofrecer alta/aprobación.
 *
 * CC-0036 Ola 5 (REQ-HIS-AFIL-001 S6) — convenios/reglas de honorario,
 * producción atribuida y liquidación por médico afiliado. RBAC real vía
 * `requirePermission("convenio_honorario.*"/"produccion_medica.*"/
 * "liquidacion.*")` en el router; `roleCodes` acá solo gobierna qué botones
 * se ofrecen.
 */
import { getTenantContext } from "@/lib/auth/session";
import { HonorariosShell } from "./_components/honorarios-shell";

export default async function HonorariosPage() {
  const tenant = await getTenantContext();
  return <HonorariosShell roleCodes={tenant?.roleCodes ?? []} />;
}
