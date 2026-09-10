/**
 * /finance/price-lists — Server Component: resuelve `roleCodes` del tenant
 * (patrón `(clinical)/lis/orders/new` / `finance/invoices/nuevo` —
 * apps/web/src/lib/auth/session.ts) para que `PriceListsShell` sepa si puede
 * ofrecer la acción "Marcar por defecto" (ADMIN/DIR) sin depender de un hook
 * de sesión en cliente.
 */
import { getTenantContext } from "@/lib/auth/session";
import { PriceListsShell } from "./_components/price-lists-shell";

export default async function PriceListsPage() {
  const tenant = await getTenantContext();
  return <PriceListsShell roleCodes={tenant?.roleCodes ?? []} />;
}
