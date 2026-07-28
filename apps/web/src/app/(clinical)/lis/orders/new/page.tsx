"use client";

/**
 * §17 LIS — Escogitación de exámenes de laboratorio por cuenta (CC-0013).
 *
 * Fuente de verdad visual/funcional: docs/CC/0013/mockup_examenes_laboratorio.html
 * (pantalla "Seleccionar Exámenes de Laboratorio"). Reemplaza el form plano
 * anterior (UUIDs a mano) — ver historial en git para el form previo.
 *
 * Desviación aprobada de layout: sin la titlebar falsa de ventana del
 * mockup (`.window`/`.titlebar`) — la pantalla vive dentro del shell real
 * del HIS. Estructura y comportamiento del resto son 1:1 con el mockup.
 *
 * Paleta: valores puntuales tomados literalmente del `:root` del mockup
 * (líneas 8 del HTML) — este módulo es una herramienta operativa interna,
 * no parte del design system de paciente, por eso NO se materializan como
 * tokens Tailwind globales (instrucción explícita del brief CC-0013). Se
 * centralizan aquí en un solo objeto para no repetir literales sueltos.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@his/ui/components/input";
import { Switch } from "@his/ui/components/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@his/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import { SelectorCuenta } from "./_components/selector-cuenta";
import { MOCK_LAB_PALETTE as MOCK } from "../../_lib/mock-palette";

type LabPriority = "ROUTINE" | "URGENT";

interface ExamenItem {
  testId: string;
  nombre: string;
  seccion: string;
}

type ToastState = { title: string; variant?: "default" | "destructive" } | null;

export default function NewLisOrderPage(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cuentaId = searchParams.get("cuentaId");

  if (!cuentaId) {
    return (
      <SelectorCuenta onSelect={(id) => router.push(`/lis/orders/new?cuentaId=${id}`)} />
    );
  }

  return <SeleccionExamenes cuentaId={cuentaId} />;
}

function SeleccionExamenes({ cuentaId }: { cuentaId: string }): React.ReactElement {
  const router = useRouter();

  const contexto = trpc.patient.contextoCuenta.useQuery({ cuentaId });
  const panelesQ = trpc.lis.test.listByArea.useQuery({ area: "LABORATORIO" });
  const panels = React.useMemo(() => panelesQ.data ?? [], [panelesQ.data]);

  const [modoBusqueda, setModoBusqueda] = React.useState(false);
  const [buscador, setBuscador] = React.useState("");
  const [seccionActual, setSeccionActual] = React.useState<string | null>(null);
  const [seleccionadas, setSeleccionadas] = React.useState<Map<string, ExamenItem>>(new Map());
  const [priority, setPriority] = React.useState<LabPriority>("ROUTINE");
  const [resumenModo, setResumenModo] = React.useState<"ver" | "guardar" | null>(null);
  const [toast, setToast] = React.useState<ToastState>(null);

  React.useEffect(() => {
    if (!seccionActual && panels.length > 0) setSeccionActual(panels[0]!.panelId);
  }, [panels, seccionActual]);

  const flatItems = React.useMemo<ExamenItem[]>(
    () => panels.flatMap((p) => p.tests.map((t) => ({ testId: t.id, nombre: t.nombre, seccion: p.nombre }))),
    [panels],
  );

  const panelActual = panels.find((p) => p.panelId === seccionActual) ?? null;

  const listaVisible: ExamenItem[] = React.useMemo(() => {
    if (modoBusqueda) {
      const q = buscador.trim().toUpperCase();
      if (!q) return flatItems;
      return flatItems.filter(
        (it) => it.nombre.toUpperCase().includes(q) || it.seccion.toUpperCase().includes(q),
      );
    }
    if (!panelActual) return [];
    return panelActual.tests.map((t) => ({ testId: t.id, nombre: t.nombre, seccion: panelActual.nombre }));
  }, [modoBusqueda, buscador, flatItems, panelActual]);

  function toggleSeleccion(item: ExamenItem): void {
    setSeleccionadas((prev) => {
      const next = new Map(prev);
      if (next.has(item.testId)) next.delete(item.testId);
      else next.set(item.testId, item);
      return next;
    });
  }

  function limpiarSeleccion(): void {
    if (seleccionadas.size === 0) {
      setToast({ title: "No hay selección que limpiar." });
      return;
    }
    setSeleccionadas(new Map());
    setToast({ title: "Selección limpiada." });
  }

  function cambiarModo(checked: boolean): void {
    setModoBusqueda(checked);
    if (!checked) setBuscador("");
  }

  const create = trpc.lis.order.create.useMutation({
    onSuccess: (data) => {
      setResumenModo(null);
      setToast({ title: `${data.items.length} prestación(es) guardada(s) correctamente.` });
      setSeleccionadas(new Map());
    },
    onError: (err) => {
      setResumenModo(null);
      setToast({ title: err.message, variant: "destructive" });
    },
  });

  function onGuardarClick(): void {
    if (seleccionadas.size === 0) {
      setToast({ title: "Seleccione al menos una prestación antes de guardar." });
      return;
    }
    setResumenModo("guardar");
  }

  function verSeleccion(): void {
    if (seleccionadas.size === 0) {
      setToast({ title: "No hay prestaciones seleccionadas." });
      return;
    }
    setResumenModo("ver");
  }

  function confirmarGuardado(): void {
    create.mutate({
      cuentaId,
      priority,
      items: [...seleccionadas.values()].map((i) => ({ testId: i.testId })),
    });
  }

  function onCancelar(): void {
    if (
      seleccionadas.size > 0 &&
      !window.confirm("¿Desea cancelar? Se perderá la selección actual.")
    ) {
      return;
    }
    router.push("/lis/orders");
  }

  const seleccionArr = [...seleccionadas.values()].sort(
    (a, b) => a.seccion.localeCompare(b.seccion) || a.nombre.localeCompare(b.nombre),
  );

  const paciente = contexto.data?.paciente;
  const edad = calcularEdadSimple(paciente?.birthDate ?? null);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <button
          type="button"
          onClick={onCancelar}
          className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: MOCK.orange }}
        >
          ⊗ Cancelar
        </button>
        <div className="flex items-center gap-3">
          {paciente ? (
            <span className="text-sm text-muted-foreground">
              {paciente.firstName} {paciente.lastName}
              {edad !== null ? ` · ${edad} años` : ""}
              {contexto.data?.cuenta.numeroCuenta ? ` · ${contexto.data.cuenta.numeroCuenta}` : ""}
            </span>
          ) : null}
          <Select value={priority} onValueChange={(v) => setPriority(v as LabPriority)}>
            <SelectTrigger className="w-32" aria-label="Prioridad">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ROUTINE">Rutina</SelectItem>
              <SelectItem value="URGENT">Urgente</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={onGuardarClick}
            className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: MOCK.teal }}
          >
            💾 Guardar Exámenes
          </button>
          <Link
            href="/lis/orders?vista=tablero"
            className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: MOCK.teal }}
          >
            📋 Consultar Tablero
          </Link>
        </div>
      </div>

      <div className="rounded-lg border">
        {/* Controles: toggle búsqueda + secciones */}
        <div className="space-y-3 border-b p-4">
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex min-w-[120px] flex-col items-start gap-1.5">
              <span className="text-xs font-medium" style={{ color: MOCK.teal }}>
                Buscar por N...
              </span>
              <Switch
                checked={modoBusqueda}
                onCheckedChange={cambiarModo}
                aria-label="Buscar por nombre"
              />
            </div>
            <Input
              className="flex-1"
              placeholder="Escriba el nombre de la prueba..."
              value={buscador}
              onChange={(e) => setBuscador(e.target.value)}
              disabled={!modoBusqueda}
            />
          </div>

          {!modoBusqueda ? (
            <div>
              <div className="mb-2 text-xs font-medium" style={{ color: MOCK.teal }}>
                Sección
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-5">
                {panels.map((p) => (
                  <label
                    key={p.panelId}
                    className="flex cursor-pointer items-center gap-2 py-0.5 text-sm"
                    style={{ color: p.panelId === seccionActual ? MOCK.blue : MOCK.inkSoft }}
                  >
                    <input
                      type="radio"
                      name="seccion"
                      checked={p.panelId === seccionActual}
                      onChange={() => setSeccionActual(p.panelId)}
                      style={{ accentColor: MOCK.blue }}
                    />
                    <span className={p.panelId === seccionActual ? "font-semibold" : undefined}>
                      {p.nombre}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Prestaciones */}
        <div className="flex items-center gap-4 px-4 pt-3">
          <span className="text-base font-semibold">Prestaciones</span>
          <span
            className="rounded-full px-3 py-0.5 text-xs font-semibold text-white"
            style={{ backgroundColor: seleccionadas.size === 0 ? "#aeb9bf" : MOCK.teal }}
          >
            {seleccionadas.size} {seleccionadas.size === 1 ? "seleccionada" : "seleccionadas"}
          </span>
        </div>
        <div className="max-h-[42vh] overflow-y-auto px-4 py-3">
          {panelesQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando catálogo…</p>
          ) : listaVisible.length === 0 ? (
            <p className="italic text-muted-foreground">
              {modoBusqueda
                ? "No se encontraron prestaciones con ese criterio de búsqueda."
                : "Esta sección no tiene prestaciones disponibles."}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-x-7 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {listaVisible.map((it) => {
                const checked = seleccionadas.has(it.testId);
                return (
                  <label
                    key={it.testId}
                    className={`flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted ${checked ? "font-semibold" : ""}`}
                    style={{ color: checked ? MOCK.ink : MOCK.inkSoft }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSeleccion(it)}
                      className="mt-0.5"
                      style={{ accentColor: MOCK.teal }}
                    />
                    <span>
                      {it.nombre}
                      {modoBusqueda ? (
                        <span
                          className="ml-1.5 rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold"
                          style={{ backgroundColor: "#e6eef0", color: MOCK.tealDark }}
                        >
                          {it.seccion}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Barra de selección */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-4 py-3">
          <div className="text-sm" style={{ color: MOCK.inkSoft }}>
            {seleccionadas.size === 0 ? (
              "Ninguna prestación seleccionada."
            ) : (
              <>
                <b style={{ color: MOCK.tealDark }}>{seleccionadas.size}</b> prestación(es):{" "}
                {seleccionArr
                  .slice(0, 3)
                  .map((i) => i.nombre)
                  .join(" · ")}
                {seleccionadas.size > 3 ? " …" : ""}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button type="button" className="underline" style={{ color: MOCK.blue }} onClick={verSeleccion}>
              Ver selección
            </button>
            <span>·</span>
            <button
              type="button"
              className="underline"
              style={{ color: MOCK.blue }}
              onClick={limpiarSeleccion}
            >
              Limpiar selección
            </button>
          </div>
        </div>

        {/* Panel Solicitud de laboratorio */}
        <div className="space-y-3 border-t bg-muted/10 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base font-semibold">Solicitud de laboratorio</span>
            <span
              className="rounded-full px-3 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: seleccionArr.length === 0 ? "#aeb9bf" : MOCK.teal }}
            >
              {seleccionArr.length} {seleccionArr.length === 1 ? "examen" : "exámenes"}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              className="text-sm underline"
              style={{ color: MOCK.blue }}
              onClick={limpiarSeleccion}
            >
              Vaciar solicitud
            </button>
            <button
              type="button"
              onClick={onGuardarClick}
              className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: MOCK.teal }}
            >
              💾 Guardar Exámenes
            </button>
          </div>

          {seleccionArr.length === 0 ? (
            <p className="italic text-muted-foreground">
              Aún no hay exámenes en la solicitud. Seleccione pruebas arriba para agregarlas.
            </p>
          ) : (
            <div className="grid max-h-[30vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {seleccionArr.map((it) => (
                <div
                  key={it.testId}
                  className="flex items-center gap-2 rounded-lg border bg-background p-2 text-sm"
                  style={{ borderColor: "#d9e6e8" }}
                >
                  <span className="flex-1 font-semibold leading-tight" style={{ color: MOCK.ink }}>
                    {it.nombre}
                  </span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: "#e6eef0", color: MOCK.tealDark }}
                  >
                    {it.seccion}
                  </span>
                  <button
                    type="button"
                    title="Quitar de la solicitud"
                    onClick={() => toggleSeleccion(it)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs"
                    style={{ backgroundColor: "#fbe4e0", color: "#c0392b" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal resumen: Ver selección / Confirmar y Guardar */}
      <Dialog open={resumenModo !== null} onOpenChange={(o) => !o && setResumenModo(null)}>
        <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {resumenModo === "guardar" ? "Prestaciones a guardar" : "Prestaciones seleccionadas"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Total: <b>{seleccionArr.length}</b> prestación(es).
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {seleccionArr.map((it) => (
              <li key={it.testId} style={{ color: MOCK.inkSoft }}>
                {it.nombre}{" "}
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: "#e6eef0", color: MOCK.tealDark }}
                >
                  {it.seccion}
                </span>
              </li>
            ))}
          </ol>
          {create.error ? (
            <p className="text-sm text-destructive" role="alert">
              {create.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setResumenModo(null)}
              className="rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: MOCK.orange }}
            >
              Cerrar
            </button>
            <button
              type="button"
              disabled={create.isPending}
              onClick={resumenModo === "guardar" ? confirmarGuardado : () => setResumenModo(null)}
              className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: MOCK.teal }}
            >
              {resumenModo === "guardar"
                ? create.isPending
                  ? "Guardando…"
                  : "Confirmar y Guardar"
                : "Aceptar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast ? (
        <Toast
          variant={toast.variant ?? "default"}
          open
          onOpenChange={(o) => !o && setToast(null)}
        >
          <ToastTitle>{toast.title}</ToastTitle>
          <ToastDescription />
        </Toast>
      ) : null}
    </div>
  );
}

/** Edad simple en años, sin dependencia cruzada de paquete — mismo cálculo que el resto del router LIS. */
function calcularEdadSimple(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}
