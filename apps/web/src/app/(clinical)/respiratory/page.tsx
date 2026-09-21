/**
 * CC-0042 / REQ-HIS-TR-001 — Módulo de Terapia Respiratoria (S1) sobre el
 * legacy §21 (adecuar, no duplicar). Server Component: resuelve roleCodes
 * para ocultar «Configuración» sin hook de sesión en cliente (mismo patrón
 * que imaging/page.tsx).
 */
import { getTenantContext } from "@/lib/auth/session";
import { RespiratoryShell } from "./_components/respiratory-shell";

export default async function RespiratoryPage() {
  const tenant = await getTenantContext();
  return <RespiratoryShell roleCodes={tenant?.roleCodes ?? []} />;
}
