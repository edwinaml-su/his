/**
 * /rentabilidad — Server Component: resuelve `roleCodes` del tenant (mismo
 * patrón que `/honorarios`/`/contratos`). CC-0036 Ola 6 (REQ-HIS-AFIL-001 S7,
 * US.AFIL.1.8) — tablero de rentabilidad por afiliado y ocupación de
 * consultorios. RBAC real vía `requirePermission("tablero_afiliado.leer")`
 * en el router; `roleCodes` acá no gobierna nada porque la pantalla es
 * solo-lectura (sin botones de mutación).
 */
import { getTenantContext } from "@/lib/auth/session";
import { RentabilidadShell } from "./_components/rentabilidad-shell";

export default async function RentabilidadPage() {
  const tenant = await getTenantContext();
  return <RentabilidadShell roleCodes={tenant?.roleCodes ?? []} />;
}
