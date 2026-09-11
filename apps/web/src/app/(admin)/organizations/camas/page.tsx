/**
 * /organizations/camas — Server Component: resuelve `roleCodes` del tenant
 * (mismo patrón que `organizations/establecimientos` y `organizations/
 * habitaciones`) para que `CamasShell` sepa si puede ofrecer alta/edición
 * (ADMIN/DIR — `bed.router.ts` create/update/setActive).
 *
 * Extensión admin de camas espejo Odoo ACS HMS (hospital.bed + custom
 * camas.config) — encargo de Edwin 2026-09-11. sql/231_room_bed_odoo_mirror.sql.
 */
import { getTenantContext } from "@/lib/auth/session";
import { CamasShell } from "./_components/camas-shell";

export default async function CamasPage() {
  const tenant = await getTenantContext();
  return <CamasShell roleCodes={tenant?.roleCodes ?? []} />;
}
