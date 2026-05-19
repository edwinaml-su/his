/**
 * /bedside/ronda — Modo Rondas de Enfermería
 *
 * Página principal del modo rondas. Permite iniciar una nueva sesión,
 * continuar una sesión pausada, navegar entre indicaciones y pausar/completar
 * la ronda. Optimizado para tablet portrait.
 *
 * US.F2.6.46 (flujo optimizado 8-15 pacientes/turno)
 * US.F2.6.50 (ruta optimizada: POR_HORA vs POR_UBICACION)
 * US.F2.6.51 (pausa y reanudación de sesión)
 */

import { redirect } from "next/navigation";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";
import { RondaClient } from "./_components/ronda-client";

export const metadata = {
  title: "Modo Rondas | AVANTE HIS",
};

export default async function RondaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tenant = await getTenantContext();
  if (!tenant) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Modo Rondas</h1>
        <p className="mt-1 text-sm text-gray-500">
          Administracion secuencial de pacientes del turno activo
        </p>
      </div>
      <RondaClient />
    </div>
  );
}
