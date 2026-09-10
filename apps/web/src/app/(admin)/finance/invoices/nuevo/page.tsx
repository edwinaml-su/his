/**
 * /finance/invoices/nuevo — Server Component: resuelve `roleCodes` del
 * tenant (patrón `(clinical)/lis/orders/new` — apps/web/src/lib/auth/session.ts)
 * para que `NuevaFacturaShell` sepa si puede ofrecer el dialog de override de
 * precio (docs/48 Ola 4b, H-17) sin depender de un hook de sesión en cliente.
 */
import { getTenantContext } from "@/lib/auth/session";
import { NuevaFacturaShell } from "./_components/nueva-factura-shell";

export default async function NuevaFacturaPage() {
  const tenant = await getTenantContext();
  return <NuevaFacturaShell roleCodes={tenant?.roleCodes ?? []} />;
}
