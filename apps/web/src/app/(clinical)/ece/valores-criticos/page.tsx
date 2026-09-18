/**
 * ECE — Valores críticos (IPSG.2). Server Component: resuelve roleCodes para
 * ocultar «Confirmar read-back» a roles supervisores (DIR/ADMIN ven la bandeja
 * pero la firma es del médico tratante) — mismo patrón que respiratory/page.tsx.
 */
import { getTenantContext } from "@/lib/auth/session";
import { ValoresCriticosClient } from "./valores-criticos-client";

export default async function ValoresCriticosPage() {
  const tenant = await getTenantContext();
  return <ValoresCriticosClient roleCodes={tenant?.roleCodes ?? []} />;
}
