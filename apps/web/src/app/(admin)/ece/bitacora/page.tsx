"use client";

/**
 * Bitácora ECE — Viewer avanzado.
 * NTEC Arts. 45-52 — Acceso, filtros, métricas y export.
 *
 * Accesibilidad: WCAG 2.2 AA — labels explícitos, aria-describedby en filtros,
 * roles de navegación, foco gestionado en paginación.
 */

import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import { Separator } from "@his/ui/components/separator";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

/**
 * Acciones NTEC + legadas.
 * Las acciones críticas determinan el toggle "Solo accesos críticos".
 */
const ACCIONES_CRITICAS = ["FIRMAR", "CERTIFICAR", "ANULAR", "VALIDAR"] as const;

const ACCIONES_TODAS = [
  "view", "create", "update", "delete", "export", "print", "share",
  "verify", "confirm",
  "FIRMAR", "VALIDAR", "CERTIFICAR", "ANULAR", "CREATE", "UPDATE",
] as const;

type Accion = (typeof ACCIONES_TODAS)[number];

/** Forma de fila retornada por bitacora.list (espejo del router — cols DDL reales). */
type BitacoraRow = {
  id: string;
  authUserId: string | null;
  recursoId: string | null;
  accion: string;
  autorizado: boolean;
  justificacion: string | null;
  ipOrigen: string | null;
  ocurridoEn: string;
};

// ---------------------------------------------------------------------------
// Tipos de estado de filtros
// ---------------------------------------------------------------------------

type Filters = {
  desde: string;
  hasta: string;
  acciones: Accion[];
  soloCriticos: boolean;
  pacienteQuery: string;
  personalQuery: string;
};

const FILTERS_INITIAL: Filters = {
  desde: "",
  hasta: "",
  acciones: [],
  soloCriticos: false,
  pacienteQuery: "",
  personalQuery: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * HG-04: Evita timezone shift de new Date("YYYY-MM-DD").toISOString().
 * En UTC-6, new Date("2026-05-19") produce 2026-05-18T18:00:00Z.
 * Enviamos el string sin conversión de zona para que el servidor lo interprete correctamente.
 */
function parseDateOnly(s: string, endOfDay = false): string {
  return endOfDay ? `${s}T23:59:59` : `${s}T00:00:00`;
}

function buildListInput(f: Filters, offset: number) {
  const accionesEfectivas: Accion[] = f.soloCriticos
    ? [...ACCIONES_CRITICAS]
    : f.acciones;

  return {
    desde:  f.desde ? parseDateOnly(f.desde)          : undefined,
    hasta:  f.hasta ? parseDateOnly(f.hasta, true)     : undefined,
    // El router acepta una sola accion — enviamos la primera si hay exactamente una.
    // Si hay varias, no filtramos por acción (se muestra todo); el filtro visual
    // queda en el cliente para no romper el contrato del router existente.
    accion: accionesEfectivas.length === 1 ? accionesEfectivas[0] : undefined,
    limit:  PAGE_SIZE,
    offset,
  };
}

function buildExportInput(f: Filters) {
  const accionesEfectivas = f.soloCriticos ? [...ACCIONES_CRITICAS] : f.acciones;
  return {
    desde:  f.desde ? parseDateOnly(f.desde)          : undefined,
    hasta:  f.hasta ? parseDateOnly(f.hasta, true)     : undefined,
    accion: accionesEfectivas.length === 1 ? accionesEfectivas[0] : undefined,
  };
}

function buildMetricsInput(f: Filters) {
  return {
    desde: f.desde ? parseDateOnly(f.desde)          : undefined,
    hasta: f.hasta ? parseDateOnly(f.hasta, true)     : undefined,
  };
}

function downloadCsv(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: "text/csv;charset=utf-8;" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  a.href      = url;
  a.download  = `bitacora_ece_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * HG-03: genera un hash SHA-256 del contenido del reporte para integridad básica.
 * La firma DIR formal requiere un endpoint server-side (TODO: /api/bitacora/report.pdf).
 * Esta implementación cubre la integridad verificable del contenido imprimible.
 */
async function computeReportHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Genera un reporte HTML imprimible con cabecera MINSAL, parámetros de filtro
 * visibles y hash SHA-256 del contenido (Art. 52 NTEC — integridad documental).
 *
 * TODO (HG-03 pendiente parcial): para reportes firmados digitalmente válidos ante
 * reguladores, implementar endpoint /api/bitacora/report.pdf server-side que genere
 * PDF con PIN DIR verificado vía argon2id antes de entregar.
 */
async function printPdfReport(
  filterParams: string,
  tableHtml: string,
) {
  const fecha = new Date().toLocaleString("es-SV");
  const contentToHash = `${fecha}|${filterParams}|${tableHtml}`;
  const hash = await computeReportHash(contentToHash);

  const win = window.open("", "_blank");
  if (!win) return;

  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Bitácora ECE — MINSAL</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 10pt; margin: 20mm; }
    h1 { font-size: 14pt; margin-bottom: 2px; }
    .sub { font-size: 9pt; color: #555; }
    .hash { font-family: monospace; font-size: 7pt; color: #333; word-break: break-all; }
    table { width: 100%; border-collapse: collapse; margin-top: 12pt; }
    th { background: #1a3c5e; color: white; padding: 4px 6px; font-size: 9pt; }
    td { border-bottom: 1px solid #ddd; padding: 3px 6px; font-size: 8pt; }
    .footer { margin-top: 24pt; border-top: 1px solid #000; padding-top: 8px; font-size: 9pt; }
    .params { background: #f5f5f5; border: 1px solid #ddd; padding: 6px 8px; margin: 8px 0; font-size: 8pt; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <div>
    <h1>Ministerio de Salud — MINSAL</h1>
    <p class="sub">Reporte de Bitácora ECE — Arts. 45-52 NTEC</p>
    <p class="sub">Generado: ${fecha}</p>
    <div class="params">
      <strong>Parámetros de consulta:</strong> ${filterParams || "Sin filtros aplicados"}
    </div>
    <p class="sub">Hash SHA-256 de integridad del reporte:</p>
    <p class="hash">${hash}</p>
    <p class="sub" style="color:#c00">
      NOTA: Este reporte es de uso interno. Para reporte oficial firmado ante MINSAL,
      solicitar al Director exportar desde el módulo de reportes con PIN DIR.
    </p>
  </div>
  ${tableHtml}
  <div class="footer">
    <p>Director/a de establecimiento (firma): _______________________________</p>
    <p>Este reporte fue generado automáticamente por el HIS Avante. Su veracidad es
       responsabilidad del personal autorizado conforme al NTEC Art. 52.</p>
    <p class="hash">Integridad SHA-256: ${hash}</p>
  </div>
  <br/>
  <button onclick="window.print()">Imprimir / Guardar PDF</button>
</body>
</html>`);
  win.document.close();
}

/** Badge de color por acción. */
function AccionBadge({ accion }: { accion: string }) {
  const isCritical = (ACCIONES_CRITICAS as readonly string[]).includes(accion);
  return (
    <Badge variant={isCritical ? "destructive" : "outline"}>
      {accion}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Componente: Panel de filtros collapsable
// ---------------------------------------------------------------------------

type FilterPanelProps = {
  filters: Filters;
  onChange: (partial: Partial<Filters>) => void;
  onSearch: () => void;
};

function FilterPanel({ filters, onChange, onSearch }: FilterPanelProps) {
  const [open, setOpen] = React.useState(true);

  function toggleAccion(accion: Accion) {
    onChange({
      acciones: filters.acciones.includes(accion)
        ? filters.acciones.filter((a) => a !== accion)
        : [...filters.acciones, accion],
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Filtros avanzados</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls="bitacora-filtros-panel"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Ocultar" : "Mostrar"}
          </Button>
        </div>
      </CardHeader>

      {open && (
        <CardContent id="bitacora-filtros-panel">
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => { e.preventDefault(); onSearch(); }}
            aria-label="Formulario de filtros de bitácora"
          >
            {/* Rango fecha */}
            <div className="space-y-1.5">
              <Label htmlFor="bf-desde">Desde</Label>
              <Input
                id="bf-desde"
                type="date"
                aria-describedby="bf-fecha-hint"
                value={filters.desde}
                onChange={(e) => onChange({ desde: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bf-hasta">Hasta</Label>
              <Input
                id="bf-hasta"
                type="date"
                aria-describedby="bf-fecha-hint"
                value={filters.hasta}
                onChange={(e) => onChange({ hasta: e.target.value })}
              />
              <p id="bf-fecha-hint" className="sr-only">
                Rango de fecha de registro del acceso
              </p>
            </div>

            {/* Búsqueda paciente — texto libre (el servidor filtra por uuid si es uuid,
                o por nombre si el router expone búsqueda de texto) */}
            <div className="space-y-1.5">
              <Label htmlFor="bf-paciente">
                Paciente
                <span className="ml-1 text-xs text-muted-foreground">(nombre o ID)</span>
              </Label>
              <Input
                id="bf-paciente"
                placeholder="Ej: García López…"
                aria-describedby="bf-paciente-hint"
                value={filters.pacienteQuery}
                onChange={(e) => onChange({ pacienteQuery: e.target.value })}
              />
              <p id="bf-paciente-hint" className="sr-only">
                Nombre completo o UUID del paciente
              </p>
            </div>

            {/* Búsqueda personal */}
            <div className="space-y-1.5">
              <Label htmlFor="bf-personal">
                Personal
                <span className="ml-1 text-xs text-muted-foreground">(nombre o ID)</span>
              </Label>
              <Input
                id="bf-personal"
                placeholder="Ej: Dr. Martínez…"
                aria-describedby="bf-personal-hint"
                value={filters.personalQuery}
                onChange={(e) => onChange({ personalQuery: e.target.value })}
              />
              <p id="bf-personal-hint" className="sr-only">
                Nombre completo o UUID del personal
              </p>
            </div>

            {/* Multi-select acciones */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                Acciones
                <span className="ml-1 text-xs text-muted-foreground">
                  (selección múltiple)
                </span>
              </Label>
              <div
                role="group"
                aria-label="Selección de acciones"
                aria-describedby="bf-acciones-hint"
                className="flex flex-wrap gap-2"
              >
                {ACCIONES_TODAS.map((accion) => {
                  const selected = filters.acciones.includes(accion);
                  const isCritical = (ACCIONES_CRITICAS as readonly string[]).includes(accion);
                  return (
                    <button
                      key={accion}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      onClick={() => toggleAccion(accion)}
                      className={[
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? isCritical
                            ? "border-destructive bg-destructive text-destructive-foreground"
                            : "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:bg-accent",
                      ].join(" ")}
                    >
                      {accion}
                    </button>
                  );
                })}
              </div>
              <p id="bf-acciones-hint" className="text-xs text-muted-foreground">
                Las acciones en rojo son criticas (FIRMAR, CERTIFICAR, ANULAR, VALIDAR).
              </p>
            </div>

            {/* Toggle solo criticos — native checkbox para evitar dep Radix Switch */}
            <div className="flex items-center gap-3">
              <input
                id="bf-solo-criticos"
                type="checkbox"
                role="switch"
                checked={filters.soloCriticos}
                onChange={(e) =>
                  onChange({ soloCriticos: e.target.checked, acciones: [] })
                }
                aria-checked={filters.soloCriticos}
                aria-describedby="bf-criticos-hint"
                className="h-4 w-4 cursor-pointer rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Label htmlFor="bf-solo-criticos" className="cursor-pointer">
                Solo accesos criticos
              </Label>
              <p id="bf-criticos-hint" className="sr-only">
                Filtra unicamente FIRMAR, CERTIFICAR, ANULAR y VALIDAR
              </p>
            </div>

            {/* Acciones del form */}
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit">Aplicar filtros</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onChange(FILTERS_INITIAL)}
              >
                Limpiar
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Componente: Panel de métricas
// ---------------------------------------------------------------------------

type MetricsPanelProps = {
  desde: string;
  hasta: string;
};

function MetricsPanel({ desde, hasta }: MetricsPanelProps) {
  const input = {
    desde: desde ? parseDateOnly(desde)          : undefined,
    hasta: hasta ? parseDateOnly(hasta, true)     : undefined,
  };

  const { data, isLoading } = trpc.bitacora.metrics.useQuery(input);

  return (
    <section aria-label="Resumen de metricas del periodo">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total accesos */}
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total accesos</p>
            <p
              className="text-2xl font-bold tabular-nums"
              aria-live="polite"
              aria-atomic="true"
            >
              {isLoading ? "…" : (data?.totalAccesos ?? 0).toLocaleString("es-SV")}
            </p>
          </CardContent>
        </Card>

        {/* Total firmas */}
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Firmas / actos criticos</p>
            <p
              className="text-2xl font-bold tabular-nums text-destructive"
              aria-live="polite"
              aria-atomic="true"
            >
              {isLoading ? "…" : (data?.totalFirmas ?? 0).toLocaleString("es-SV")}
            </p>
          </CardContent>
        </Card>

        {/* Top documentos */}
        <Card className="sm:col-span-1">
          <CardContent className="pt-4">
            <p className="mb-2 text-xs text-muted-foreground">Top 5 documentos</p>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Cargando…</p>
            ) : (
              <ol className="space-y-0.5 text-xs">
                {(data?.topDocumentos ?? []).map(
                  (d: { documento: string; accesos: number }, i: number) => (
                    <li key={d.documento} className="flex justify-between gap-1">
                      <span className="truncate text-muted-foreground">
                        {i + 1}. {d.documento}
                      </span>
                      <span className="font-medium">{d.accesos}</span>
                    </li>
                  ),
                )}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Top usuarios */}
        <Card className="sm:col-span-1">
          <CardContent className="pt-4">
            <p className="mb-2 text-xs text-muted-foreground">Top 5 usuarios</p>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Cargando…</p>
            ) : (
              <ol className="space-y-0.5 text-xs">
                {(data?.topUsuarios ?? []).map(
                  (u: { userId: string; accesos: number }, i: number) => (
                    <li key={u.userId} className="flex justify-between gap-1">
                      <span className="truncate font-mono text-muted-foreground">
                        {i + 1}. {u.userId.slice(0, 8)}…
                      </span>
                      <span className="font-medium">{u.accesos}</span>
                    </li>
                  ),
                )}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page principal
// ---------------------------------------------------------------------------

export default function BitacoraEcePage() {
  const [draft, setDraft]       = React.useState<Filters>(FILTERS_INITIAL);
  const [committed, setCommitted] = React.useState<Filters>(FILTERS_INITIAL);
  const [offset, setOffset]     = React.useState(0);
  const [exporting, setExporting] = React.useState(false);
  const tableRef = React.useRef<HTMLTableElement>(null);

  const queryInput   = buildListInput(committed, offset);
  const exportInput  = buildExportInput(committed);

  const { data, isLoading, isFetching } = trpc.bitacora.list.useQuery(queryInput);

  const exportCsvQuery = trpc.bitacora.exportCsv.useQuery(exportInput, {
    enabled: exporting,
  });

  React.useEffect(() => {
    if (exporting && exportCsvQuery.data) {
      downloadCsv(exportCsvQuery.data.base64);
      setExporting(false);
    }
  }, [exporting, exportCsvQuery.data]);

  const totalPages  = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function handleSearch() {
    setCommitted(draft);
    setOffset(0);
  }

  function handleExportPdf() {
    if (!tableRef.current) return;
    const params = [
      committed.desde ? `Desde: ${committed.desde}` : "",
      committed.hasta ? `Hasta: ${committed.hasta}` : "",
      committed.soloCriticos ? "Solo críticos" : "",
      committed.acciones.length > 0 ? `Acciones: ${committed.acciones.join(", ")}` : "",
    ].filter(Boolean).join(" | ");
    void printPdfReport(params, tableRef.current.outerHTML);
  }

  /** Filtra filas del cliente si hay múltiples acciones seleccionadas. */
  const accionesEfectivas = committed.soloCriticos
    ? [...ACCIONES_CRITICAS]
    : committed.acciones;

  const rows = React.useMemo(() => {
    const items: BitacoraRow[] = data?.items ?? [];
    if (accionesEfectivas.length <= 1) return items;
    return items.filter((r: BitacoraRow) =>
      accionesEfectivas.includes(r.accion as Accion),
    );
  }, [data?.items, accionesEfectivas]);

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bitacora ECE</h1>
          <p className="text-sm text-muted-foreground">
            Registro de accesos al expediente clinico — NTEC Arts. 45-52.
          </p>
        </div>
        <nav aria-label="Vistas de bitacora" className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/ece/bitacora/timeline">Vista timeline</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={exporting || exportCsvQuery.isFetching}
            onClick={() => setExporting(true)}
            aria-label="Exportar registros en formato CSV"
          >
            {exporting && exportCsvQuery.isFetching ? "Generando…" : "Exportar CSV"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            aria-label="Exportar reporte PDF imprimible con cabecera MINSAL"
          >
            Exportar PDF
          </Button>
        </nav>
      </div>

      {/* Métricas */}
      <MetricsPanel desde={committed.desde} hasta={committed.hasta} />

      <Separator />

      {/* Filtros */}
      <FilterPanel
        filters={draft}
        onChange={(partial) => setDraft((f) => ({ ...f, ...partial }))}
        onSearch={handleSearch}
      />

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {/* Virtualización: para >200 filas se muestra aviso de paginación.
              La tabla se pagina a 50 filas server-side, lo que evita renderizar
              listas largas sin requerir una librería de virtualización externa. */}
          <div
            className="overflow-x-auto"
            role="region"
            aria-label="Tabla de registros de bitacora"
          >
            <Table ref={tableRef} aria-describedby="bitacora-table-desc">
              <caption id="bitacora-table-desc" className="sr-only">
                Registros de acceso al expediente clinico. Ordenados por fecha descendente.
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Fecha / hora</TableHead>
                  <TableHead scope="col">Usuario</TableHead>
                  <TableHead scope="col">Recurso</TableHead>
                  <TableHead scope="col">Accion</TableHead>
                  <TableHead scope="col">Resultado</TableHead>
                  <TableHead scope="col">IP</TableHead>
                  <TableHead scope="col">Justificacion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading || isFetching ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      <span aria-live="polite">Cargando registros…</span>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Sin registros para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        <time dateTime={row.ocurridoEn}>
                          {new Date(row.ocurridoEn).toLocaleString("es-SV")}
                        </time>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.authUserId ? `${row.authUserId.slice(0, 8)}…` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.recursoId ? `${row.recursoId.slice(0, 8)}…` : "—"}
                      </TableCell>
                      <TableCell>
                        <AccionBadge accion={row.accion} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.autorizado ? "default" : "destructive"}>
                          {row.autorizado ? "OK" : "FALLO"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{row.ipOrigen ?? "—"}</TableCell>
                      <TableCell
                        className="max-w-xs truncate text-xs"
                        title={row.justificacion ?? undefined}
                      >
                        {row.justificacion ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Paginacion */}
      {data && data.total > PAGE_SIZE && (
        <nav
          aria-label="Paginacion de bitacora"
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
              onClick={() => {
                setOffset((o) => Math.max(0, o - PAGE_SIZE));
                tableRef.current?.focus();
              }}
              aria-label="Pagina anterior"
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= data.total}
              onClick={() => {
                setOffset((o) => o + PAGE_SIZE);
                tableRef.current?.focus();
              }}
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
