"use client";

/**
 * ECE — Tablero de episodios hospitalarios activos.
 * Agrupados por servicio/sala. Filtros: servicio, fecha.
 * Solo lectura. Navegación a detalle desde cada card.
 *
 * HD-08: filtro gravedad eliminado — columna no existe en ece.episodio_hospitalario.
 */
import * as React from "react";
import Link from "next/link";
import { BedDouble, Filter, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "medium" });

function diasDesde(fecha: Date | string): number {
  const ms = Date.now() - new Date(fecha).getTime();
  return Math.floor(ms / 86_400_000);
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface Filters {
  servicioId: string;
}

export default function EpisodioHospitalarioListPage() {
  const [filters, setFilters] = React.useState<Filters>({
    servicioId: "",
  });

  const queryInput = React.useMemo(() => {
    const i: Record<string, unknown> = { limit: 100 };
    if (filters.servicioId.trim()) i.servicioId = filters.servicioId.trim();
    return i;
  }, [filters]);

  const query = trpc.eceEpisodioHospitalario.listActivos.useQuery(queryInput);
  const episodios = query.data?.items ?? [];

  // Agrupar por sala_nombre (sala_id es alias de servicio_id)
  const grupos = React.useMemo(() => {
    const map = new Map<string, typeof episodios>();
    for (const ep of episodios) {
      const sala = ep.sala_nombre ?? ep.sala_id ?? "Sin sala";
      const arr = map.get(sala) ?? [];
      arr.push(ep);
      map.set(sala, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [episodios]);

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BedDouble className="h-6 w-6" aria-hidden />
            Episodios Hospitalarios
          </h1>
          <p className="text-sm text-muted-foreground">
            ECE — Hospitalario: pacientes activos agrupados por servicio.
          </p>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4" aria-hidden />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="f-servicio">Servicio / Sala (UUID)</Label>
              <Input
                id="f-servicio"
                placeholder="xxxxxxxx-xxxx-…"
                value={filters.servicioId}
                onChange={(e) => setFilters((f) => ({ ...f, servicioId: e.target.value }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Estados de carga / error */}
      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Cargando episodios…</p>
      )}
      {query.error && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {query.error.message}
        </div>
      )}

      {/* Grupos por sala */}
      {grupos.length === 0 && !query.isLoading && (
        <p className="text-sm text-muted-foreground">
          Sin episodios activos con los filtros aplicados.
        </p>
      )}

      {grupos.map(([sala, eps]) => (
        <Card key={sala}>
          <CardHeader>
            <CardTitle className="text-base">{sala}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {eps.map((ep) => {
                const dias = diasDesde(ep.fecha_ingreso);
                return (
                  <div
                    key={ep.id}
                    className="rounded-lg border bg-card p-4 shadow-sm space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium truncate">{ep.paciente_nombre}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          Cama: <span className="font-mono">{ep.cama_codigo ?? "—"}</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>Ingreso: {dateFmt.format(new Date(ep.fecha_ingreso))}</p>
                      <p>Estancia: <span className="font-semibold">{dias} día{dias !== 1 ? "s" : ""}</span></p>
                      {ep.medico_nombre && <p>MC: {ep.medico_nombre}</p>}
                    </div>
                    <Button asChild size="sm" className="w-full" variant="outline">
                      <Link href={`/ece/episodio-hospitalario/${ep.id}`}>
                        Ver episodio
                      </Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
