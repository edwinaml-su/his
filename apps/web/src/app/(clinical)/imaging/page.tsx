/**
 * CC-0016 — Módulo de Radiología e Imágenes (mockup) sobre el RIS legacy §18.
 * Fuente: docs/CC/0016/mockup_modulo_imagenes.html.
 *
 * Server Component: resuelve `roleCodes` del tenant (patrón (admin)/dashboard
 * y (clinical)/layout — apps/web/src/lib/auth/session.ts) para que el shell
 * cliente pueda ocultar la pestaña «Parametrización» a usuarios sin rol
 * ADMIN/DIR sin depender de un hook de sesión en cliente (no existe uno hoy).
 */
import { getTenantContext } from "@/lib/auth/session";
import { ImagingModuleShell } from "./_components/imaging-module-shell";

export default async function ImagingPage() {
  const tenant = await getTenantContext();
  return <ImagingModuleShell roleCodes={tenant?.roleCodes ?? []} />;
}
