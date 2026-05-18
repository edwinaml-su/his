/**
 * /bedside — Cola de turno enfermería.
 *
 * Muestra la lista de pacientes del turno activo con indicaciones pendientes.
 * Optimizado para tablet portrait y móvil landscape (breakpoints 768px / 1024px).
 *
 * US.F2.6.23-26 — Proceso E PWA enfermería.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";
import { BedsideQueueClient } from "./_components/bedside-queue-client";

export const metadata = {
  title: "Bedside — Cola de turno | AVANTE HIS",
};

export default async function BedsidePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tenant = await getTenantContext();
  if (!tenant) redirect("/login");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bedside — Turno Activo</h1>
          <p className="mt-1 text-sm text-gray-500">
            Pacientes con indicaciones pendientes de administración
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
            Enfermería
          </span>
        </div>
      </div>

      {/* Leyenda de colores */}
      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
          Dentro de ventana
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          Ventana cerrando (&le;15 min)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          Vencida
        </span>
      </div>

      {/* Cola reactiva — Client Component */}
      <BedsideQueueClient />

      {/* PWA hint */}
      <p className="mt-6 text-center text-xs text-gray-400">
        Agrega esta pantalla a tu pantalla de inicio para acceso rápido.
      </p>
    </div>
  );
}
