/**
 * Dashboard del Portal del Paciente — placeholder Beta.20.
 * Las tarjetas se poblarán en Beta.20b (HCE consulta).
 */
export default function PortalDashboardPage() {
  const cards = [
    { title: "Mis citas", description: "Ver y gestionar citas médicas.", href: "#" },
    { title: "Resultados", description: "Laboratorio e imágenes.", href: "#" },
    { title: "Medicamentos", description: "Recetas y tratamientos activos.", href: "#" },
    { title: "Mi perfil", description: "Datos de contacto y acceso.", href: "/settings/mfa" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Mi portal de salud</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <a
            key={c.title}
            href={c.href}
            className="rounded-xl border bg-white p-6 hover:shadow-md transition-shadow space-y-1"
          >
            <p className="font-medium text-slate-800">{c.title}</p>
            <p className="text-sm text-slate-500">{c.description}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
