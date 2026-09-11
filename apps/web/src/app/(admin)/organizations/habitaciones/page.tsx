/**
 * /organizations/habitaciones — Server Component: resuelve `roleCodes` del
 * tenant (mismo patrón que `organizations/establecimientos`) para que
 * `HabitacionesShell` sepa si puede ofrecer alta/edición (ADMIN/DIR —
 * `room.router.ts`).
 *
 * Modelo de habitaciones espejo Odoo ACS HMS (hospital.ward) — encargo de
 * Edwin 2026-09-11. sql/231_room_bed_odoo_mirror.sql.
 */
import { getTenantContext } from "@/lib/auth/session";
import { HabitacionesShell } from "./_components/habitaciones-shell";

export default async function HabitacionesPage() {
  const tenant = await getTenantContext();
  return <HabitacionesShell roleCodes={tenant?.roleCodes ?? []} />;
}
