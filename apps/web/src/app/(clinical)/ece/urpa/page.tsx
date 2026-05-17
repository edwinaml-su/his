/**
 * ECE — URPA: Unidad de Recuperación Post-Anestésica
 *
 * Lista pacientes activos en URPA con puntaje Aldrete y tiempo en unidad.
 * Los datos son mock; el router eceUrpa.list se conecta cuando haya
 * paciente seleccionado en el contexto clínico.
 */
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { AldreteBadge } from "@/components/urpa/aldrete-badge";
import { UrpaCountdown } from "@/components/urpa/urpa-countdown";

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

interface UrpaRow {
  id: string;
  pacienteNombre: string;
  actoQuirurgicoId: string;
  ingresoUrpaTs: string;
  escalaAldreteIngreso: number;
  estadoRegistro: "activo" | "alta_otorgada";
}

// ---------------------------------------------------------------------------
// Mock — reemplazar con api.eceUrpa.list en el RSC cuando esté cableado.
// ---------------------------------------------------------------------------

const MOCK_ROWS: UrpaRow[] = [
  {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    pacienteNombre: "María López",
    actoQuirurgicoId: "bbbbbbbb-0000-0000-0000-000000000001",
    ingresoUrpaTs: new Date(Date.now() - 45 * 60_000).toISOString(),
    escalaAldreteIngreso: 9,
    estadoRegistro: "activo",
  },
  {
    id: "aaaaaaaa-0000-0000-0000-000000000002",
    pacienteNombre: "Carlos Rivas",
    actoQuirurgicoId: "bbbbbbbb-0000-0000-0000-000000000002",
    ingresoUrpaTs: new Date(Date.now() - 95 * 60_000).toISOString(),
    escalaAldreteIngreso: 6,
    estadoRegistro: "activo",
  },
  {
    id: "aaaaaaaa-0000-0000-0000-000000000003",
    pacienteNombre: "Ana Pérez",
    actoQuirurgicoId: "bbbbbbbb-0000-0000-0000-000000000003",
    ingresoUrpaTs: new Date(Date.now() - 150 * 60_000).toISOString(),
    escalaAldreteIngreso: 3,
    estadoRegistro: "activo",
  },
];

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function UrpaPage() {
  const activos = MOCK_ROWS.filter((r) => r.estadoRegistro === "activo");

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            URPA — Recuperación Post-Anestésica
          </h1>
          <p className="text-sm text-muted-foreground">
            Pacientes activos en la unidad · ECE
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/urpa/nuevo">Registrar ingreso</Link>
        </Button>
      </div>

      {/* Tabla de pacientes activos */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table
          className="w-full text-sm"
          aria-label="Pacientes activos en URPA"
        >
          <caption className="sr-only">
            Lista de pacientes en recuperación post-anestésica, con puntaje
            Aldrete y tiempo transcurrido en la unidad.
          </caption>
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2.5">Paciente</th>
              <th scope="col" className="px-3 py-2.5">Aldrete ingreso</th>
              <th scope="col" className="px-3 py-2.5">Tiempo en URPA</th>
              <th scope="col" className="px-3 py-2.5">Estado</th>
              <th scope="col" className="px-3 py-2.5 sr-only">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {activos.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  No hay pacientes activos en URPA.
                </td>
              </tr>
            ) : (
              activos.map((row) => (
                <tr key={row.id} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-medium">{row.pacienteNombre}</td>
                  <td className="px-3 py-2.5">
                    <AldreteBadge score={row.escalaAldreteIngreso} />
                  </td>
                  <td className="px-3 py-2.5">
                    <UrpaCountdown ingresoTs={row.ingresoUrpaTs} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                      Activo
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/ece/urpa/${row.id}`}
                      className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
