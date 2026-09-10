/**
 * /organizations/establecimientos — Server Component: resuelve `roleCodes`
 * del tenant (mismo patrón que `finance/invoices/nuevo` /
 * `finance/price-lists`) para que `EstablecimientosShell` sepa si puede
 * ofrecer alta/edición (ADMIN/DIR — `establishment.router.ts`).
 *
 * Parametrización admin (2026-09-10): los establecimientos (HE/CM/US, ver
 * SQL 227) se sembraban por SQL directo — ahora son un CRUD del admin.
 */
import { getTenantContext } from "@/lib/auth/session";
import { EstablecimientosShell } from "./_components/establecimientos-shell";

export default async function EstablecimientosPage() {
  const tenant = await getTenantContext();
  return <EstablecimientosShell roleCodes={tenant?.roleCodes ?? []} />;
}
