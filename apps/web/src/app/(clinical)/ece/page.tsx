"use client";

/**
 * Landing del Expediente Clínico Electrónico (`/ece`).
 *
 * Lista las ADMISIONES (episodios de atención) de todas las áreas del
 * establecimiento, identificadas por su número de admisión (public_encounter_id)
 * y número de expediente del paciente. Por defecto muestra las activas; con el
 * toggle "Incluir egresados" agrega el histórico (admisiones cerradas/canceladas)
 * para conservar el registro de cada paciente.
 *
 * Las admisiones hospitalarias enlazan al detalle del episodio
 * (`/ece/episodio-hospitalario/[id]`) con sus pestañas por proceso.
 *
 * Antes esta ruta no existía → `/ece` devolvía 404.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Stethoscope, Search } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const dateTimeFmt = new Intl.DateTimeFormat("es-SV", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
function fmtDT(value: Date | string | null | undefined): string {
  return value ? dateTimeFmt.format(new Date(value)) : "—";
}

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  abierto: "default",
  en_curso: "default",
  alta_iniciada: "secondary",
  cerrado: "outline",
  cancelado: "destructive",
};

export default function EceLandingPage() {
  const router = useRouter();
  const [busquedaInput, setBusquedaInput] = React.useState("");
  const [incluirCerrados, setIncluirCerrados] = React.useState(false);
  const busqueda = useDebounced(busquedaInput);

  const query = (trpc as typeof trpc & {
    eceEpisodioHospitalario: {
      listAdmisiones: {
        useQuery: (input: { incluirCerrados: boolean; busqueda?: string }) => {
          data?: {
            id: string;
            public_encounter_id: string | null;
            numero_expediente: string | null;
            modalidad: string;
            servicio_categoria: string | null;
            servicio_nombre: string | null;
            estado: string;
            fecha_inicio: string | Date;
            fecha_cierre: string | Date | null;
            tiene_hospitalizacion: boolean;
          }[];
          isLoading: boolean;
          isFetching: boolean;
          error?: { message: string } | null;
        };
      };
    };
  }).eceEpisodioHospitalario.listAdmisiones.useQuery({
    incluirCerrados,
    busqueda: busqueda.trim() || undefined,
  });

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Stethoscope className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          Expediente Clínico Electrónico
        </h1>
        <p className="text-sm text-muted-foreground">
          Admisiones de pacientes en las áreas del hospital, agrupadas por número
          de admisión. Activa &ldquo;Incluir egresados&rdquo; para ver el histórico.
        </p>
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Admisiones</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={busquedaInput}
                onChange={(e) => setBusquedaInput(e.target.value)}
                placeholder="Buscar por expediente o admisión…"
                className="pl-8 sm:w-72"
                aria-label="Buscar por número de expediente o de admisión"
              />
            </div>
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={incluirCerrados}
                onChange={(e) => setIncluirCerrados(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Incluir egresados (histórico)
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Cargando admisiones…</p>
          ) : query.error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {query.error.message}
            </p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {busqueda.trim()
                ? "Sin admisiones que coincidan con la búsqueda."
                : incluirCerrados
                  ? "No hay admisiones registradas."
                  : "No hay admisiones activas. Activa “Incluir egresados” para ver el histórico."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N.º admisión</TableHead>
                  <TableHead>Expediente</TableHead>
                  <TableHead>Área</TableHead>
                  <TableHead>Modalidad</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Ingreso</TableHead>
                  <TableHead>Egreso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const tieneDetalle = r.tiene_hospitalizacion;
                  const irAlDetalle = () => {
                    if (tieneDetalle) {
                      router.push(`/ece/episodio-hospitalario/${r.id}`);
                    }
                  };
                  return (
                    <TableRow
                      key={r.id}
                      role={tieneDetalle ? "button" : undefined}
                      tabIndex={tieneDetalle ? 0 : undefined}
                      aria-label={tieneDetalle ? "Abrir detalle de la admisión" : undefined}
                      onClick={tieneDetalle ? irAlDetalle : undefined}
                      onKeyDown={
                        tieneDetalle
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                irAlDetalle();
                              }
                            }
                          : undefined
                      }
                      className={
                        tieneDetalle
                          ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          : undefined
                      }
                    >
                      <TableCell className="font-mono text-xs">
                        {r.public_encounter_id
                          ? `${r.public_encounter_id.slice(0, 8)}…`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-medium">
                        {r.numero_expediente ?? "—"}
                      </TableCell>
                      <TableCell>{r.servicio_nombre ?? r.servicio_categoria ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.modalidad}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ESTADO_VARIANT[r.estado] ?? "outline"}>
                          {r.estado.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">{fmtDT(r.fecha_inicio)}</TableCell>
                      <TableCell className="tabular-nums">{fmtDT(r.fecha_cierre)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
