/**
 * Layout del Portal del Paciente — sin sidebar admin, centrado en el paciente.
 */
import type { ReactNode } from "react";

export const metadata = {
  title: "Portal del Paciente — HIS Avante",
  description: "Acceso a su información clínica y servicios de salud.",
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-3">
        <span className="text-lg font-semibold text-blue-700">
          Portal del Paciente
        </span>
        <span className="text-slate-400 text-sm">Complejo Hospitalario Avante</span>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
