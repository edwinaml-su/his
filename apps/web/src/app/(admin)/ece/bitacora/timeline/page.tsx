"use client";

/**
 * Bitácora ECE — Vista Timeline.
 * Muestra entradas agrupadas por día, con iconos por acción y
 * detalle expandible (payload_hash, IP).
 *
 * Accesibilidad WCAG 2.2 AA:
 *   - Cada entrada es un <details>/<summary> nativo (keyboard-friendly sin ARIA extra).
 *   - Días como <section> con <h2> aria-label.
 *   - aria-live en el área de carga.
 */

import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100; // Timeline carga más filas por paginación

/** Iconos ASCII/Unicode por acción para no depender de una librería de iconos. */
const ACCION_ICON: Record<string, string> = {
  view:        "👁",
  create:      "✚",
  update:      "✎",
  delete:      "✗",
  export:      "↓",
  print:       "⎙",
  share:       "⤴",
  verify:      "✔",
  confirm:     "✔",
  FIRMAR:      "✍",
  VALIDAR:     "✔",
  CERTIFICAR:  "🔒",
  ANULAR:      "⊘",
  CREATE:      "✚",
  UPDATE:      "✎",
};

const ACCIONES_CRITICAS = new Set(["FIRMAR", "CERTIFICAR", "ANULAR", "VALIDAR"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDay(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

function formatDay(day: string): string {
  const d = new Date(day + "T00:00:00");
  return d.toLocaleDateString("es-SV", {
    weekday: "long",
    year:    "numeric",
    month:   "long",
    day:     "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-SV", {
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type BitacoraItem = {
  id: string;
  firmaId: string | null;
  userId: string;
  pacienteId: string | null;
  accion: string;
  exito: boolean;
  contexto: string | null;
  ip: string | null;
  registradoEn: string;
};

/**
 * Agrupa items por día local.
 * Retorna Map<YYYY-MM-DD, BitacoraItem[]> ordenado cronológicamente.
 */
function groupByDay(items: BitacoraItem[]): Map<string, BitacoraItem[]> {
  const map = new Map<string, BitacoraItem[]>();
  for (const item of items) {
    const day = isoDay(item.registradoEn);
    const bucket = map.get(day) ?? [];
    bucket.push(item);
    map.set(day, bucket);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Componente: entrada de timeline
// ---------------------------------------------------------------------------

function TimelineEntry({ item }: { item: BitacoraItem }) {
  const isCritical = ACCIONES_CRITICAS.has(item.accion);
  const icon = ACCION_ICON[item.accion] ?? "•";

  return (
    <li className="flex gap-3">
      {/* Icono + línea vertical */}
      <div className="flex flex-col items-center">
        <span
          className={[
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm",
            isCritical
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
          ].join(" ")}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
      </div>

      {/* Contenido expandible */}
      <details className="mb-3 flex-1 rounded-md border bg-card p-3 text-sm">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center gap-2">
            <time
              dateTime={item.registradoEn}
              className="font-mono text-xs text-muted-foreground"
            >
              {formatTime(item.registradoEn)}
            </time>
            <Badge variant={isCritical ? "destructive" : "outline"} className="text-xs">
              {item.accion}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Usuario:{" "}
              <span className="font-mono">{item.userId.slice(0, 8)}…</span>
            </span>
            {item.pacienteId && (
              <span className="text-xs text-muted-foreground">
                Paciente:{" "}
                <span className="font-mono">{item.pacienteId.slice(0, 8)}…</span>
              </span>
            )}
            {item.contexto && (
              <span className="truncate text-xs text-muted-foreground">
                {item.contexto}
              </span>
            )}
            <Badge
              variant={item.exito ? "default" : "destructive"}
              className="ml-auto text-xs"
            >
              {item.exito ? "OK" : "FALLO"}
            </Badge>
          </div>
        </summary>

        {/* Detalle expandido */}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div>
            <dt className="font-medium text-muted-foreground">ID evento</dt>
            <dd className="font-mono">{item.id}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">IP</dt>
            <dd>{item.ip ?? "—"}</dd>
          </div>
          {item.firmaId && (
            <div>
              <dt className="font-medium text-muted-foreground">Firma ID</dt>
              <dd className="font-mono">{item.firmaId}</dd>
            </div>
          )}
          {item.pacienteId && (
            <div>
              <dt className="font-medium text-muted-foreground">Paciente UUID</dt>
              <dd className="font-mono">{item.pacienteId}</dd>
            </div>
          )}
          <div className="col-span-2">
            <dt className="font-medium text-muted-foreground">Contexto completo</dt>
            <dd className="break-all">{item.contexto ?? "—"}</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BitacoraTimelinePage() {
  const [desde, setDesde] = React.useState("");
  const [hasta, setHasta] = React.useState("");
  const [committed, setCommitted] = React.useState({ desde: "", hasta: "" });
  const [offset, setOffset] = React.useState(0);

  const queryInput = {
    desde:  committed.desde ? new Date(committed.desde).toISOString() : undefined,
    hasta:  committed.hasta ? new Date(committed.hasta).toISOString() : undefined,
    limit:  PAGE_SIZE,
    offset,
  };

  const { data, isLoading, isFetching } = trpc.bitacora.list.useQuery(queryInput);

  const groupedDays = React.useMemo(
    () => groupByDay(data?.items ?? []),
    [data?.items],
  );

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setCommitted({ desde, hasta });
    setOffset(0);
  }

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bitacora ECE — Timeline</h1>
          <p className="text-sm text-muted-foreground">
            Vista cronologica de accesos agrupada por dia.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/ece/bitacora">Volver a tabla</Link>
        </Button>
      </div>

      {/* Filtro fecha */}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={handleSearch}
        aria-label="Filtrar timeline por fecha"
      >
        <div className="space-y-1.5">
          <Label htmlFor="tl-desde">Desde</Label>
          <Input
            id="tl-desde"
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tl-hasta">Hasta</Label>
          <Input
            id="tl-hasta"
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
        <Button type="submit">Filtrar</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDesde(""); setHasta("");
            setCommitted({ desde: "", hasta: "" });
            setOffset(0);
          }}
        >
          Limpiar
        </Button>
      </form>

      {/* Timeline */}
      <div aria-live="polite" aria-atomic="false">
        {isLoading || isFetching ? (
          <p className="py-8 text-center text-muted-foreground">
            Cargando timeline…
          </p>
        ) : groupedDays.size === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            Sin registros para el periodo seleccionado.
          </p>
        ) : (
          Array.from(groupedDays.entries()).map(([day, items]) => (
            <section
              key={day}
              aria-label={`Accesos del dia ${formatDay(day)}`}
              className="mb-6"
            >
              <h2 className="mb-3 text-sm font-semibold capitalize text-foreground">
                {formatDay(day)}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({items.length} registro{items.length !== 1 ? "s" : ""})
                </span>
              </h2>
              <ol
                aria-label={`Lista de accesos del ${formatDay(day)}`}
                className="space-y-0"
              >
                {items.map((item) => (
                  <TimelineEntry key={item.id} item={item} />
                ))}
              </ol>
            </section>
          ))
        )}
      </div>

      {/* Paginacion */}
      {data && data.total > PAGE_SIZE && (
        <nav
          aria-label="Paginacion de timeline"
          className="flex items-center justify-between text-sm text-muted-foreground"
        >
          <p aria-live="polite" aria-atomic="true">
            {data.total.toLocaleString("es-SV")} registros — pagina{" "}
            {currentPage} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              aria-label="Pagina anterior"
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= data.total}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              aria-label="Pagina siguiente"
            >
              Siguiente
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
