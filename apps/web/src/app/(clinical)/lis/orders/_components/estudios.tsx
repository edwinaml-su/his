"use client";

/**
 * CC-0013b — Vista "Estudios": grid de consulta a nivel de EXAMEN, todos los
 * estados (Creado/En proceso/Hecho/Anulado). Complementa el tablero por
 * cuenta de CC-0013 (que agrupa por cuenta y solo muestra la orden activa).
 *
 * Filtros server-side vía `lis.order.estudios` (paciente/expediente, centro
 * solicitante-o-ejecutor, estado agrupado, rango de fechas) + paginación
 * cursor (mismo patrón que `/notifications`). Fila clickeable → reabre el
 * modal "Solicitud" del tablero (`cuentaModal` + `<SolicitudModal>`
 * compartido) para gestionar estados/instrucciones.
 */
import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import { parseDateOnly } from "@/lib/date-only";
import { MOCK_LAB_PALETTE as MOCK, ESTUDIO_ESTADO_PILL } from "../../_lib/mock-palette";
import { SolicitudModal } from "./solicitud-modal";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type RouterInput = inferRouterInputs<AppRouter>;
type RouterOutput = inferRouterOutputs<AppRouter>;
type EstudiosInput = RouterInput["lis"]["order"]["estudios"];
type EstudiosData = RouterOutput["lis"]["order"]["estudios"];
type EstudioRow = EstudiosData["items"][number];

type EstadoFiltro = "CREADO" | "EN_PROCESO" | "HECHO" | "ANULADO";
const ALL = "__ALL__";
const PAGE_SIZE = 25;

const PRIORITY_LABEL: Record<"ROUTINE" | "URGENT" | "STAT", string> = {
  ROUTINE: "Rutina",
  URGENT: "Urgente",
  STAT: "STAT",
};

export function Estudios(): React.ReactElement {
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [costCenterId, setCostCenterId] = React.useState("");
  const [estado, setEstado] = React.useState<EstadoFiltro | "">("");
  const [fechaDesde, setFechaDesde] = React.useState("");
  const [fechaHasta, setFechaHasta] = React.useState("");
  const [selectedOrderId, setSelectedOrderId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ title: string } | null>(null);
  const [pages, setPages] = React.useState<{ items: EstudioRow[]; nextCursor: string | null }[]>([]);
  const [loadingMore, setLoadingMore] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const queryInput: EstudiosInput = React.useMemo(() => {
    const desde = parseDateOnly(fechaDesde);
    const hasta = parseDateOnly(fechaHasta);
    return {
      ...(debounced && { search: debounced }),
      ...(costCenterId && { costCenterId }),
      ...(estado && { estado }),
      ...(desde && { fechaDesde: desde }),
      ...(hasta && { fechaHasta: hasta }),
      limit: PAGE_SIZE,
    };
  }, [debounced, costCenterId, estado, fechaDesde, fechaHasta]);

  const firstQuery = trpc.lis.order.estudios.useQuery(queryInput);
  const costCenters = trpc.costCenter.list.useQuery({ activo: true });
  const utils = trpc.useUtils();

  React.useEffect(() => {
    if (firstQuery.data) {
      setPages([{ items: firstQuery.data.items, nextCursor: firstQuery.data.nextCursor }]);
    }
  }, [firstQuery.data]);

  const items = React.useMemo(() => pages.flatMap((p) => p.items), [pages]);
  const lastCursor = pages.length > 0 ? pages[pages.length - 1]!.nextCursor : null;

  async function loadMore(): Promise<void> {
    if (!lastCursor) return;
    setLoadingMore(true);
    try {
      const next = await utils.lis.order.estudios.fetch({ ...queryInput, cursor: lastCursor });
      setPages((prev) => [...prev, { items: next.items, nextCursor: next.nextCursor }]);
    } finally {
      setLoadingMore(false);
    }
  }

  function limpiarFiltros(): void {
    setSearch("");
    setCostCenterId("");
    setEstado("");
    setFechaDesde("");
    setFechaHasta("");
  }

  const modal = trpc.lis.order.cuentaModal.useQuery(
    { orderId: selectedOrderId ?? "" },
    { enabled: selectedOrderId !== null },
  );

  React.useEffect(() => {
    if (selectedOrderId && modal.error) {
      setToast({ title: "Esta orden no está anclada a una cuenta administrativa; no se puede abrir el modal." });
      setSelectedOrderId(null);
    }
  }, [modal.error, selectedOrderId]);

  function handleSaved(numeroCuenta: string): void {
    setSelectedOrderId(null);
    void utils.lis.order.estudios.invalidate();
    setToast({ title: `Cambios guardados en la solicitud ${numeroCuenta}.` });
  }

  const kpis = firstQuery.data?.kpis;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2.5">
        <Kpi n={kpis?.total ?? 0} label="Total" />
        <Kpi n={kpis?.creados ?? 0} label="Creados" />
        <Kpi n={kpis?.enProceso ?? 0} label="En proceso" />
        <Kpi n={kpis?.hechos ?? 0} label="Hechos" />
      </div>

      <div className="rounded-lg border p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="estudios-search">Paciente</Label>
            <Input
              id="estudios-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre o expediente…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Centro</Label>
            <Select value={costCenterId || ALL} onValueChange={(v) => setCostCenterId(v === ALL ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                {costCenters.data?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select
              value={estado || ALL}
              onValueChange={(v) => setEstado(v === ALL ? "" : (v as EstadoFiltro))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                <SelectItem value="CREADO">Creado</SelectItem>
                <SelectItem value="EN_PROCESO">En proceso</SelectItem>
                <SelectItem value="HECHO">Hecho</SelectItem>
                <SelectItem value="ANULADO">Anulado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="estudios-desde">Desde</Label>
            <Input
              id="estudios-desde"
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="estudios-hasta">Hasta</Label>
            <Input
              id="estudios-hasta"
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={limpiarFiltros}>
            Limpiar filtros
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border">
        {firstQuery.error ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {firstQuery.error.message}
          </p>
        ) : null}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["Paciente", "Cuenta", "Examen", "Sección", "Centro", "Fecha", "Prioridad", "Estado"].map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap px-3 py-2 text-left font-semibold text-white"
                  style={{ backgroundColor: MOCK.teal }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!firstQuery.isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Sin resultados con estos filtros.
                </td>
              </tr>
            ) : null}
            {items.map((row) => {
              const pill = ESTUDIO_ESTADO_PILL[row.estadoGrupo];
              return (
                <tr
                  key={row.itemId}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir solicitud de ${row.paciente.nombre} — ${row.examen}`}
                  className="cursor-pointer border-b hover:bg-muted/50"
                  style={{ borderColor: MOCK.line }}
                  onClick={() => setSelectedOrderId(row.orderId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedOrderId(row.orderId);
                    }
                  }}
                >
                  <td className="px-3 py-2">
                    <div>{row.paciente.nombre}</div>
                    <div className="font-mono text-xs text-muted-foreground">{row.paciente.expediente}</div>
                  </td>
                  <td className="px-3 py-2">{row.cuenta ?? "—"}</td>
                  <td className="px-3 py-2">{row.examen}</td>
                  <td className="px-3 py-2">{row.seccion}</td>
                  <td className="px-3 py-2">{row.centro}</td>
                  <td className="px-3 py-2 tabular-nums">{new Date(row.fecha).toLocaleString("es-SV")}</td>
                  <td className="px-3 py-2">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={
                        row.prioridad === "STAT" || row.prioridad === "URGENT"
                          ? { backgroundColor: "#fbe4e0", color: "#c0392b" }
                          : { backgroundColor: "#e6eef0", color: MOCK.tealDark }
                      }
                    >
                      {PRIORITY_LABEL[row.prioridad]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: pill.background, color: pill.color }}
                    >
                      {pill.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {lastCursor ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      ) : null}

      {selectedOrderId && modal.data ? (
        <SolicitudModal
          cuenta={modal.data}
          onClose={() => setSelectedOrderId(null)}
          onSaved={() => handleSaved(modal.data!.numeroCuenta)}
        />
      ) : null}

      {toast ? (
        <Toast open onOpenChange={(o) => !o && setToast(null)}>
          <ToastTitle>{toast.title}</ToastTitle>
          <ToastDescription />
        </Toast>
      ) : null}
    </div>
  );
}

function Kpi({ n, label }: { n: number; label: string }): React.ReactElement {
  return (
    <div className="min-w-[120px] rounded-lg border p-2.5" style={{ borderColor: "#dbe7e9", backgroundColor: "#f0f6f7" }}>
      <div className="text-xl font-bold" style={{ color: MOCK.tealDark }}>
        {n}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
