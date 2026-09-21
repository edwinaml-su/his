"use client";

/**
 * Dashboard del Portal del Paciente.
 *
 * Cards de navegación a las secciones reales del portal. "Mis citas" muestra
 * la próxima cita usando `hce.appointments.upcoming` (query liviana: take 5,
 * solo campos de resumen — ver packages/trpc/src/routers/portal.router.ts).
 * El resto son cards de navegación limpias: sus routers (labResults,
 * prescriptions, vaccinations) devuelven listas completas con joins, no aptas
 * para un resumen barato en el dashboard.
 */
import Link from "next/link";
import { trpc } from "@/lib/trpc/react";

function formatCitaFecha(d: Date | string) {
  return new Date(d).toLocaleString("es-SV", {
    timeZone: "America/El_Salvador",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PortalDashboardPage() {
  const upcoming = trpc.portal.hce.appointments.upcoming.useQuery({});
  const proximaCita = upcoming.data?.[0];

  const cards = [
    {
      title: "Mis citas",
      description: proximaCita
        ? `Próxima: ${formatCitaFecha(proximaCita.scheduledAt)}`
        : "Ver y gestionar citas médicas.",
      href: "/portal/citas",
    },
    {
      title: "Resultados",
      description: "Laboratorio e imágenes validados.",
      href: "/portal/resultados",
    },
    {
      title: "Medicamentos",
      description: "Recetas y tratamientos activos.",
      href: "/portal/recetas",
    },
    {
      title: "Vacunación",
      description: "Historial de dosis aplicadas.",
      href: "/portal/vacunacion",
    },
    {
      title: "Mi expediente",
      description: "Episodios de atención y diagnósticos.",
      href: "/mi-expediente",
    },
    {
      title: "Mi perfil",
      description: "Datos de contacto y acceso (MFA).",
      href: "/portal/settings/mfa",
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">Mi portal de salud</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.title}
            href={c.href}
            className="rounded-xl border bg-white p-6 hover:shadow-md transition-shadow space-y-1"
          >
            <p className="font-medium text-slate-800">{c.title}</p>
            <p className="text-sm text-slate-500">{c.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
