"use client";

/**
 * ECE — Listado cronológico inverso de evoluciones médicas por episodio.
 *
 * UX:
 *   - Filtro fecha (date input nativo) + filtro autor (texto libre).
 *   - Timeline vertical igual al patrón de notas clínicas (§14).
 *   - Estado vacío explícito con CTA a "Nueva evolución".
 *   - Firma muestra badge "Firmada" + "Validada" cuando ambos existen.
 */
import * as React from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

interface EvolucionRow {
  id: string;
  episodeId: string;
  authorId: string;
  authorName: string | null;
  fecha: string | Date;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  signedAt: string | Date | null;
  validatedAt: string | Date | null;
}

export default function EvolucionListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [fechaFiltro, setFechaFiltro] = React.useState(
    searchParams.get("fecha") ?? "",
  );
  const [autorFiltro, setAutorFiltro] = React.useState(
    searchParams.get("autor") ?? "",
  );

  const episodeId = searchParams.get("episodeId") ?? undefined;

  // Router espera `episodioId` (no `episodeId`) y `fecha: Date` (no string).
  // El nombre `episodeId` proviene del query param URL — lo mapeamos al input.
  const list = trpc.eceEvolucion.list.useQuery(
    {
      episodioId: episodeId,
      fecha: fechaFiltro ? new Date(fechaFiltro) : undefined,
      autorId: autorFiltro || undefined,
    },
    { enabled: true },
  );

  const evoluciones = (list.data ?? []) as unknown as EvolucionRow[];

  // Sincronizar filtros en URL para bookmarkability
  function applyFilters() {
    const params = new URLSearchParams();
    if (episodeId) params.set("episodeId", episodeId);
    if (fechaFiltro) params.set("fecha", fechaFiltro);
    if (autorFiltro) params.set("autor", autorFiltro);
    router.push(`/ece/evolucion?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Evoluciones médicas</h1>
          <p className="text-sm text-muted-foreground">
            {episodeId
              ? `Episodio #${episodeId.slice(0, 8)}`
              : "Todos los episodios"}{" "}
            · {evoluciones.length} registro{evoluciones.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button asChild>
          <Link
            href={
              episodeId
                ? `/ece/evolucion/nueva?episodeId=${episodeId}`
                : "/ece/evolucion/nueva"
            }
          >
            + Nueva evolución
          </Link>
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4">
          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-muted-foreground">
              Filtrar
            </legend>
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="filtro-fecha">Fecha</Label>
                <Input
                  id="filtro-fecha"
                  type="date"
                  value={fechaFiltro}
                  onChange={(e) => setFechaFiltro(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="filtro-autor">Autor</Label>
                <Input
                  id="filtro-autor"
                  type="text"
                  value={autorFiltro}
                  onChange={(e) => setAutorFiltro(e.target.value)}
                  placeholder="Nombre del médico…"
                  className="w-56"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={applyFilters}
                >
                  Aplicar filtros
                </Button>
              </div>
            </div>
          </fieldset>
        </CardContent>
      </Card>

      {/* Lista */}
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Cargando evoluciones…
        </p>
      ) : list.error ? (
        <p role="alert" className="text-sm text-destructive">
          Error: {list.error.message}
        </p>
      ) : evoluciones.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Sin evoluciones registradas.{" "}
            <Link
              href={
                episodeId
                  ? `/ece/evolucion/nueva?episodeId=${episodeId}`
                  : "/ece/evolucion/nueva"
              }
              className="font-medium text-primary underline underline-offset-2"
            >
              Registrar la primera
            </Link>
          </CardContent>
        </Card>
      ) : (
        <ol className="relative space-y-4 border-l border-muted pl-6">
          {evoluciones.map((ev, i) => {
            const fecha =
              typeof ev.fecha === "string" ? new Date(ev.fecha) : ev.fecha;
            return (
              <li key={ev.id} className="relative">
                <span
                  className="absolute -left-[31px] top-3 inline-block h-3 w-3 rounded-full border-2 border-background bg-primary"
                  aria-hidden="true"
                />
                <Card
                  className={
                    i === 0 ? "border-primary/40 shadow-sm" : undefined
                  }
                >
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                    <div className="space-y-1">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        <span>
                          {fecha.toLocaleDateString("es-SV", {
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                          })}
                        </span>
                        {ev.signedAt ? (
                          <Badge
                            variant="success"
                            aria-label="Nota firmada"
                          >
                            Firmada
                          </Badge>
                        ) : (
                          <Badge variant="warning">Borrador</Badge>
                        )}
                        {ev.validatedAt ? (
                          <Badge
                            variant="secondary"
                            aria-label="Validada por MC"
                          >
                            Validada
                          </Badge>
                        ) : null}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {ev.authorName ?? (
                          <span className="font-mono">
                            #{ev.authorId.slice(0, 8)}
                          </span>
                        )}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/ece/evolucion/${ev.id}`}>Ver detalle</Link>
                    </Button>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {ev.subjective
                      ? ev.subjective.slice(0, 120) +
                        (ev.subjective.length > 120 ? "…" : "")
                      : <span className="italic">Sin subjetivo registrado.</span>}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
