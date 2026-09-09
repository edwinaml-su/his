/**
 * §17 LIS — Escogitación de exámenes de laboratorio por cuenta (CC-0013 →
 * rediseño 2026-09).
 *
 * Fuente de verdad visual/funcional: `design/mockup/mockup_examenes_laboratorio.html`
 * (pantalla "Seleccionar Exámenes de Laboratorio", cascada Tipo→Subtipo→Sección).
 * Reemplaza el filtro plano por sección único del form anterior — ver
 * historial en git para la versión previa (CC-0013 original).
 *
 * Server Component: resuelve `roleCodes` del tenant (patrón (clinical)/imaging
 * — apps/web/src/lib/auth/session.ts) para que el link "Mantenimiento de
 * catálogos" solo se muestre a ADMIN/DIR, sin depender de un hook de sesión
 * en cliente.
 */
import { getTenantContext } from "@/lib/auth/session";
import { SeleccionExamenesShell } from "./_components/seleccion-examenes-shell";

export default async function NewLisOrderPage() {
  const tenant = await getTenantContext();
  return <SeleccionExamenesShell roleCodes={tenant?.roleCodes ?? []} />;
}
