/**
 * /agendas — Server Component: resuelve `roleCodes` del tenant (mismo patrón
 * que `/contratos`, `/turnos`, `/consultorios`) para que `AgendasShell` sepa
 * si puede ofrecer alta/configuración.
 *
 * CC-0036 Ola 3 (REQ-HIS-AFIL-001 S3) — motor de agenda: configuración,
 * excepciones y disponibilidad derivada. RBAC real vía
 * `requirePermission("agenda.*")` en el router; ABAC de
 * SECRETARIA_MEDICO_AFILIADO/MEDICO_AFILIADO (solo su médico afiliado) se
 * aplica server-side en `agenda.router.ts` — `roleCodes` acá solo gobierna
 * la UX de botones.
 */
import { getTenantContext } from "@/lib/auth/session";
import { AgendasShell } from "./_components/agendas-shell";

export default async function AgendasPage() {
  const tenant = await getTenantContext();
  return <AgendasShell roleCodes={tenant?.roleCodes ?? []} />;
}
