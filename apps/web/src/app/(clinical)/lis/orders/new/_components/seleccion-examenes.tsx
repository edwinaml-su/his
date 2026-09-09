"use client";

/**
 * Rediseño lab 2026-09 — pantalla "Seleccionar Exámenes de Laboratorio".
 *
 * Fuente de verdad: `design/mockup/mockup_examenes_laboratorio.html`.
 * Cascada Tipo de muestra → Subtipo de muestra → Sección (3 pasos
 * dependientes, líneas 147-153/269-356 del mockup) + lista de pruebas +
 * "Tablero especifico de solicitudes de laboratorio clinico" (tabla con
 * cantidad/parámetros por prueba, líneas 60-74/319-333).
 *
 * Datos: `trpc.lis.catalog.cascada` (payload único: tipos/subtipos/secciones
 * con testCount + pruebas con defaultQty/paramCount). Reemplaza
 * `lis.test.listByArea`, que queda reservado para el wizard de HC (§17,
 * no se toca en este cambio).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
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
import { MOCK_LAB_PALETTE as MOCK } from "../../../_lib/mock-palette";
import { ParametrosModal } from "./parametros-modal";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type CascadaData = RouterOutput["lis"]["catalog"]["cascada"];
type PruebaCascada = CascadaData["pruebas"][number];

type LabPriority = "ROUTINE" | "URGENT";
type ToastState = { title: string; variant?: "default" | "destructive" } | null;

interface SeleccionExamenesProps {
  cuentaId: string;
  roleCodes: string[];
}

export function SeleccionExamenes({ cuentaId, roleCodes }: SeleccionExamenesProps): React.ReactElement {
  const router = useRouter();
  const isAdmin = roleCodes.includes("ADMIN") || roleCodes.includes("DIR");

  const contexto = trpc.patient.contextoCuenta.useQuery({ cuentaId });
  const cascadaQ = trpc.lis.catalog.cascada.useQuery();
  const cascada = cascadaQ.data;
  const utils = trpc.useUtils();

  // ─── Cascada: Tipo → Subtipo → Sección ─────────────────────────────────
  const [tipoSel, setTipoSel] = React.useState<string | null>(null);
  const [subSel, setSubSel] = React.useState<string | null>(null);
  const [seccionActual, setSeccionActual] = React.useState<string | null>(null);
  const [modoBusqueda, setModoBusqueda] = React.useState(false);
  const [buscador, setBuscador] = React.useState("");

  // ─── Selección / solicitud ──────────────────────────────────────────────
  const [seleccionadas, setSeleccionadas] = React.useState<Set<string>>(new Set());
  const [cantidades, setCantidades] = React.useState<Record<string, number>>({});
  const [paramSel, setParamSel] = React.useState<Record<string, string[]>>({});
  const [paramModalTestId, setParamModalTestId] = React.useState<string | null>(null);
  const [priority, setPriority] = React.useState<LabPriority>("ROUTINE");
  const [resumenModo, setResumenModo] = React.useState<"ver" | "guardar" | null>(null);
  const [confirmando, setConfirmando] = React.useState(false);
  const [toast, setToast] = React.useState<ToastState>(null);

  const tipoNombreById = React.useMemo(
    () => new Map((cascada?.tipos ?? []).map((t) => [t.id, t.name])),
    [cascada],
  );
  const subtipoNombreById = React.useMemo(
    () => new Map((cascada?.subtipos ?? []).map((s) => [s.id, s.name])),
    [cascada],
  );
  const seccionNombreById = React.useMemo(
    () => new Map((cascada?.secciones ?? []).map((s) => [s.id, s.name])),
    [cascada],
  );
  const pruebaById = React.useMemo(
    () => new Map((cascada?.pruebas ?? []).map((p) => [p.id, p])),
    [cascada],
  );

  // `LabTest.panelId` es nullable (test independiente sin sección) — helper
  // para no repetir el guard `panelId ? ... : ""` en cada punto de uso.
  const seccionNombre = React.useCallback(
    (panelId: string | null): string => (panelId ? (seccionNombreById.get(panelId) ?? "") : ""),
    [seccionNombreById],
  );

  const pasaFiltro = React.useCallback(
    (p: PruebaCascada): boolean =>
      (tipoSel === null || p.sampleTypeId === tipoSel) &&
      (subSel === null || p.sampleSubtypeId === subSel),
    [tipoSel, subSel],
  );

  const subtipoOptions = React.useMemo(() => {
    if (tipoSel === null || !cascada) return [];
    return cascada.subtipos.filter((s) => s.sampleTypeId === tipoSel && s.testCount > 0);
  }, [cascada, tipoSel]);

  const seccionesPermitidas = React.useMemo(() => {
    if (!cascada) return [];
    const allowedIds = new Set(cascada.pruebas.filter(pasaFiltro).map((p) => p.panelId));
    return cascada.secciones.filter((s) => allowedIds.has(s.id));
  }, [cascada, pasaFiltro]);

  // fixSeccion() del mockup: si la sección actual deja de ser válida por el
  // filtro tipo/subtipo, cae a la primera sección permitida (o null).
  React.useEffect(() => {
    if (seccionesPermitidas.some((s) => s.id === seccionActual)) return;
    setSeccionActual(seccionesPermitidas[0]?.id ?? null);
  }, [seccionesPermitidas, seccionActual]);

  const listaVisible = React.useMemo<PruebaCascada[]>(() => {
    if (!cascada) return [];
    if (modoBusqueda) {
      const q = buscador.trim().toUpperCase();
      let list = cascada.pruebas.filter(pasaFiltro);
      if (q) {
        list = list.filter((p) => {
          const seccion = seccionNombre(p.panelId);
          const tipo = p.sampleTypeId ? (tipoNombreById.get(p.sampleTypeId) ?? "") : "";
          const subtipo = p.sampleSubtypeId ? (subtipoNombreById.get(p.sampleSubtypeId) ?? "") : "";
          return (
            p.name.toUpperCase().includes(q) ||
            seccion.toUpperCase().includes(q) ||
            tipo.toUpperCase().includes(q) ||
            subtipo.toUpperCase().includes(q)
          );
        });
      }
      return [...list].sort((a, b) => a.name.localeCompare(b.name, "es"));
    }
    if (!seccionActual) return [];
    return cascada.pruebas
      .filter((p) => p.panelId === seccionActual && pasaFiltro(p))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [cascada, modoBusqueda, buscador, seccionActual, pasaFiltro, seccionNombre, tipoNombreById, subtipoNombreById]);

  const filtroActivo = tipoSel !== null || subSel !== null;
  const examenesFiltrados = cascada ? cascada.pruebas.filter(pasaFiltro).length : 0;

  const todosRef = React.useRef<HTMLInputElement>(null);
  const allSelectedVisible = listaVisible.length > 0 && listaVisible.every((p) => seleccionadas.has(p.id));
  const someSelectedVisible = listaVisible.some((p) => seleccionadas.has(p.id));
  React.useEffect(() => {
    if (todosRef.current) todosRef.current.indeterminate = !allSelectedVisible && someSelectedVisible;
  }, [allSelectedVisible, someSelectedVisible]);

  function setTipo(v: string | null): void {
    setTipoSel(v);
    setSubSel(null);
  }

  function limpiarCfg(): void {
    setTipoSel(null);
    setSubSel(null);
  }

  function cambiarModo(checked: boolean): void {
    setModoBusqueda(checked);
    if (!checked) setBuscador("");
  }

  function toggleSeleccion(p: PruebaCascada): void {
    const yaSeleccionada = seleccionadas.has(p.id);
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (yaSeleccionada) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
    if (yaSeleccionada) {
      setCantidades((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      setParamSel((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
    } else {
      setCantidades((prev) => (p.id in prev ? prev : { ...prev, [p.id]: p.defaultQty || 1 }));
    }
  }

  function toggleTodos(checked: boolean): void {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      for (const p of listaVisible) {
        if (checked) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
    setCantidades((prev) => {
      const next = { ...prev };
      for (const p of listaVisible) {
        if (checked) {
          if (!(p.id in next)) next[p.id] = p.defaultQty || 1;
        } else {
          delete next[p.id];
        }
      }
      return next;
    });
    setToast({ title: checked ? "Se incluyeron todas las pruebas filtradas." : "Se quitaron las pruebas filtradas." });
  }

  function quitarDeSolicitud(testId: string): void {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      next.delete(testId);
      return next;
    });
    setCantidades((prev) => {
      const next = { ...prev };
      delete next[testId];
      return next;
    });
    setParamSel((prev) => {
      const next = { ...prev };
      delete next[testId];
      return next;
    });
  }

  function limpiarSeleccion(): void {
    if (seleccionadas.size === 0) {
      setToast({ title: "No hay selección que limpiar." });
      return;
    }
    setSeleccionadas(new Set());
    setCantidades({});
    setParamSel({});
    setToast({ title: "Selección limpiada." });
  }

  function onCantidadChange(testId: string, raw: string): void {
    let v = Number.parseInt(raw, 10);
    if (Number.isNaN(v) || v < 1) v = 1;
    setCantidades((prev) => ({ ...prev, [testId]: v }));
  }

  // Orden alfabético es-SV por sección→prueba, igual que `renderSolicitud`/
  // `abrirResumen` del mockup (`[...seleccionadas].sort()` sobre la clave
  // "SECCION|||PRUEBA").
  const seleccionOrdenada = React.useMemo<PruebaCascada[]>(() => {
    const arr = [...seleccionadas].map((id) => pruebaById.get(id)).filter((p): p is PruebaCascada => !!p);
    return arr.sort((a, b) => {
      const secA = seccionNombre(a.panelId);
      const secB = seccionNombre(b.panelId);
      return secA.localeCompare(secB, "es") || a.name.localeCompare(b.name, "es");
    });
  }, [seleccionadas, pruebaById, seccionNombre]);

  // Preview de la barra de selección: orden de inserción (Set), sin ordenar
  // — igual que `selSummary` en el mockup.
  const seleccionArr = [...seleccionadas].map((id) => pruebaById.get(id)).filter((p): p is PruebaCascada => !!p);

  const create = trpc.lis.order.create.useMutation({
    onSuccess: (data) => {
      setResumenModo(null);
      setToast({ title: `${data.items.length} prueba(s) guardada(s) correctamente.` });
      setSeleccionadas(new Set());
      setCantidades({});
      setParamSel({});
    },
    onError: (err) => {
      setResumenModo(null);
      setToast({ title: err.message, variant: "destructive" });
    },
  });

  function onGuardarClick(): void {
    if (seleccionadas.size === 0) {
      setToast({ title: "Seleccione al menos una prueba." });
      return;
    }
    setResumenModo("guardar");
  }

  function verSeleccion(): void {
    if (seleccionadas.size === 0) {
      setToast({ title: "No hay pruebas seleccionadas." });
      return;
    }
    setResumenModo("ver");
  }

  async function confirmarGuardado(): Promise<void> {
    setConfirmando(true);
    try {
      const items = await Promise.all(
        seleccionOrdenada.map(async (p) => {
          let parameterIds: string[] | undefined;
          if (p.paramCount > 0) {
            if (paramSel[p.id]) {
              parameterIds = paramSel[p.id];
            } else {
              const params = await utils.lis.test.parameters.fetch({ testId: p.id });
              parameterIds = params.map((param) => param.id);
            }
          }
          return {
            testId: p.id,
            quantity: cantidades[p.id] ?? p.defaultQty ?? 1,
            ...(parameterIds ? { parameterIds } : {}),
          };
        }),
      );
      create.mutate({ cuentaId, priority, items });
    } finally {
      setConfirmando(false);
    }
  }

  function onCancelar(): void {
    if (seleccionadas.size > 0 && !window.confirm("¿Desea cancelar? Se perderá la selección actual.")) {
      return;
    }
    router.push("/lis/orders");
  }

  const paciente = contexto.data?.paciente;
  const edad = calcularEdadSimple(paciente?.birthDate ?? null);
  const totalEstudios = seleccionOrdenada.reduce((acc, p) => acc + (cantidades[p.id] ?? p.defaultQty ?? 1), 0);
  const paramModalPrueba = paramModalTestId ? pruebaById.get(paramModalTestId) : null;

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
        <div className="flex flex-wrap items-center gap-3">
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
            data-testid="lab-guardar-btn"
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
          {isAdmin ? (
            <Link
              href="/catalogs/laboratorio"
              className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: MOCK.teal }}
            >
              ⚙ Mantenimiento de catálogos
            </Link>
          ) : null}
        </div>
      </div>

      {cascadaQ.error ? (
        <p role="alert" className="text-sm text-destructive">
          {cascadaQ.error.message}
        </p>
      ) : null}

      <div className="rounded-lg border">
        {/* Toggle búsqueda */}
        <div className="flex flex-wrap items-start gap-5 border-b p-4">
          <div className="flex min-w-[120px] flex-col items-start gap-1.5">
            <span className="text-xs" style={{ color: MOCK.teal }}>
              Buscar por N...
            </span>
            <Switch
              checked={modoBusqueda}
              onCheckedChange={cambiarModo}
              aria-label="Buscar por nombre"
              // Rediseño lab 2026-09 — override de color para track pixel-exacto
              // al mockup (§9.5 DESIGN-SPEC: `.slider` custom, líneas 19-23).
              style={{ backgroundColor: modoBusqueda ? MOCK.teal : MOCK.switchTrackOff }}
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

        {/* Configuración de la búsqueda (dependiente) — cascada */}
        <div className="border-b p-4" style={{ backgroundColor: MOCK.panelSoftBg }}>
          <div className="mb-2 text-xs font-bold" style={{ color: MOCK.teal }}>
            Configuración de la búsqueda (dependiente)
          </div>

          {/* Paso 1: Tipo de muestra */}
          <CfgStep num={1} label="Tipo de muestra" hint="selección única">
            <div className="flex flex-wrap gap-1.5">
              <RadioPill
                name="cfgTipo"
                label="Todos"
                count={null}
                active={tipoSel === null}
                onSelect={() => setTipo(null)}
                testId="lab-tipo-pill-Todos"
              />
              {(cascada?.tipos ?? []).map((t) => (
                <RadioPill
                  key={t.id}
                  name="cfgTipo"
                  label={t.name}
                  count={t.testCount}
                  active={tipoSel === t.id}
                  disabled={t.testCount === 0}
                  onSelect={() => setTipo(t.id)}
                  testId={`lab-tipo-pill-${t.name}`}
                />
              ))}
            </div>
          </CfgStep>

          {/* Paso 2: Subtipo de muestra */}
          <CfgStep num={2} label="Subtipo de muestra" hint="selección única">
            {tipoSel === null ? (
              <div className="flex flex-wrap items-center gap-2">
                <RadioPill name="cfgSub" label="Todos" count={null} active variant="sub" onSelect={() => undefined} />
                <span className="text-xs" style={{ color: MOCK.hintColor }}>
                  Seleccione un tipo de muestra para elegir subtipo.
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <RadioPill
                  name="cfgSub"
                  label="Todos"
                  count={null}
                  active={subSel === null}
                  variant="sub"
                  onSelect={() => setSubSel(null)}
                  testId="lab-subtipo-pill-Todos"
                />
                {subtipoOptions.map((s) => (
                  <RadioPill
                    key={s.id}
                    name="cfgSub"
                    label={s.name}
                    count={s.testCount}
                    active={subSel === s.id}
                    variant="sub"
                    onSelect={() => setSubSel(s.id)}
                    testId={`lab-subtipo-pill-${s.name}`}
                  />
                ))}
              </div>
            )}
          </CfgStep>

          {/* Paso 3: Sección — oculto en modo búsqueda */}
          {!modoBusqueda ? (
            <CfgStep num={3} label="Sección" hint="selección única">
              <div className="flex flex-wrap gap-1.5">
                {seccionesPermitidas.map((s) => (
                  <RadioPill
                    key={s.id}
                    name="cfgSeccion"
                    label={s.name}
                    count={null}
                    active={seccionActual === s.id}
                    onSelect={() => setSeccionActual(s.id)}
                    testId={`lab-seccion-pill-${s.name}`}
                  />
                ))}
              </div>
            </CfgStep>
          ) : null}

          <p className="mt-1.5 text-[11.5px]" style={{ color: MOCK.hintColor }}>
            {filtroActivo
              ? `Filtrando · ${seccionesPermitidas.length} sección(es) · ${examenesFiltrados} examen(es). `
              : `Sin filtro de muestra: ${seccionesPermitidas.length} secciones · ${cascada?.pruebas.length ?? 0} exámenes. `}
            {filtroActivo ? (
              <button type="button" className="underline" style={{ color: MOCK.blue }} onClick={limpiarCfg}>
                Quitar filtro de muestra
              </button>
            ) : null}
          </p>
        </div>

        {/* Pruebas */}
        <div className="flex flex-wrap items-center gap-4 px-4 pt-3">
          <span className="text-base font-semibold">Pruebas</span>
          <span
            className="rounded-full px-3 py-0.5 text-xs font-semibold text-white"
            style={{ backgroundColor: seleccionadas.size === 0 ? MOCK.zeroBadgeBg : MOCK.teal }}
          >
            {seleccionadas.size} {seleccionadas.size === 1 ? "seleccionada" : "seleccionadas"}
          </span>
          <label
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold"
            style={{ borderColor: MOCK.rbBorder, color: MOCK.tealDark }}
            title="Incluir todas las pruebas visibles con el filtro actual."
          >
            <input
              ref={todosRef}
              type="checkbox"
              data-testid="lab-chk-todos"
              checked={allSelectedVisible}
              onChange={(e) => toggleTodos(e.target.checked)}
              style={{ accentColor: MOCK.teal }}
            />
            TODOS
          </label>
          <span className="text-xs" style={{ color: MOCK.hintColor }}>
            · selección múltiple
          </span>
        </div>
        <div className="max-h-[42vh] overflow-y-auto px-4 py-3">
          {cascadaQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando catálogo…</p>
          ) : listaVisible.length === 0 ? (
            <p className="italic text-muted-foreground">
              {modoBusqueda
                ? "No se encontraron pruebas con ese criterio."
                : "No hay pruebas para esta combinación de filtros."}
            </p>
          ) : (
            // .prest-grid del mockup (column-count 3→2→1, líneas 49/113-114).
            <div className="columns-1 gap-7 sm:columns-2 lg:columns-3">
              {listaVisible.map((p) => {
                const checked = seleccionadas.has(p.id);
                return (
                  <label
                    key={p.id}
                    className="mb-1 flex items-start gap-2 break-inside-avoid rounded px-1 py-1 text-sm"
                    style={{ color: checked ? MOCK.ink : MOCK.inkSoft, fontWeight: checked ? 600 : 400 }}
                  >
                    <input
                      type="checkbox"
                      data-testid="lab-prueba-check"
                      checked={checked}
                      onChange={() => toggleSeleccion(p)}
                      className="mt-0.5"
                      style={{ accentColor: MOCK.teal }}
                    />
                    <span>
                      {p.name}
                      {modoBusqueda ? (
                        <span
                          className="ml-1.5 rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold"
                          style={{ backgroundColor: MOCK.secBadgeBg, color: MOCK.tealDark }}
                        >
                          {seccionNombre(p.panelId)}
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
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"
          style={{ backgroundColor: MOCK.selectionBarBg }}
        >
          <div className="text-sm" style={{ color: MOCK.inkSoft }}>
            {seleccionadas.size === 0 ? (
              "Ninguna prueba seleccionada."
            ) : (
              <>
                <b style={{ color: MOCK.tealDark }}>{seleccionadas.size}</b> prueba(s):{" "}
                {seleccionArr
                  .slice(0, 3)
                  .map((p) => p.name)
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
            <button type="button" className="underline" style={{ color: MOCK.blue }} onClick={limpiarSeleccion}>
              Limpiar selección
            </button>
          </div>
        </div>

        {/* Tablero especifico de solicitudes de laboratorio clinico */}
        <div className="space-y-2 border-t p-4" style={{ backgroundColor: MOCK.panelSoftBg }}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base font-semibold">Tablero especifico de solicitudes de laboratorio clinico</span>
            <span
              className="rounded-full px-3 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: seleccionOrdenada.length === 0 ? MOCK.zeroBadgeBg : MOCK.teal }}
            >
              {seleccionOrdenada.length} {seleccionOrdenada.length === 1 ? "examen" : "exámenes"}
            </span>
            <span className="flex-1" />
            <button type="button" className="text-sm underline" style={{ color: MOCK.blue }} onClick={limpiarSeleccion}>
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

          {seleccionOrdenada.length === 0 ? (
            <p className="italic text-muted-foreground">
              Aún no hay pruebas en la solicitud. Seleccione arriba para agregarlas.
            </p>
          ) : (
            <div className="max-h-[34vh] overflow-y-auto rounded-lg border" style={{ borderColor: MOCK.line }}>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr style={{ backgroundColor: MOCK.cntBg }}>
                    <th className="px-3 py-2 text-center font-semibold" style={{ color: "#2a4650" }}>
                      #
                    </th>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: "#2a4650" }}>
                      Prueba
                    </th>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: "#2a4650" }}>
                      Sección
                    </th>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: "#2a4650" }}>
                      Tipo / subtipo
                    </th>
                    <th className="px-3 py-2 text-center font-semibold" style={{ color: "#2a4650" }}>
                      Parámetros
                    </th>
                    <th className="px-3 py-2 text-center font-semibold" style={{ color: "#2a4650" }}>
                      Cantidad
                    </th>
                    <th className="px-3 py-2 text-center font-semibold" style={{ color: "#2a4650" }} />
                  </tr>
                </thead>
                <tbody>
                  {seleccionOrdenada.map((p, idx) => (
                    <tr key={p.id} data-testid="lab-solicitud-row" className="border-t" style={{ borderColor: "#eef1f3" }}>
                      <td className="px-3 py-1.5 text-center">{idx + 1}</td>
                      <td className="px-3 py-1.5 font-semibold" style={{ color: MOCK.ink }}>
                        {p.name}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ backgroundColor: MOCK.secBadgeBg, color: MOCK.tealDark }}
                        >
                          {seccionNombre(p.panelId)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-[11.5px]">
                        {p.sampleTypeId ? tipoNombreById.get(p.sampleTypeId) : "—"}
                        <br />
                        <span style={{ color: MOCK.hintColor }}>
                          {p.sampleSubtypeId ? subtipoNombreById.get(p.sampleSubtypeId) : ""}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {p.paramCount > 0 ? (
                          <button
                            type="button"
                            data-testid="lab-param-btn"
                            onClick={() => setParamModalTestId(p.id)}
                            className="rounded-md px-2.5 py-1 text-[11.5px] font-medium text-white"
                            style={{ backgroundColor: MOCK.teal }}
                          >
                            {paramSel[p.id] ? paramSel[p.id]!.length : p.paramCount}/{p.paramCount} parám.
                          </button>
                        ) : (
                          <span className="text-[11px]" style={{ color: MOCK.hintColor }}>
                            Sin parámetros
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          data-testid="lab-qty-input"
                          aria-label={`Cantidad de ${p.name}`}
                          value={cantidades[p.id] ?? p.defaultQty ?? 1}
                          onChange={(e) => onCantidadChange(p.id, e.target.value)}
                          className="w-16 rounded border px-1.5 py-1 text-center"
                          style={{ borderColor: "#cbd4d9" }}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button
                          type="button"
                          title="Quitar"
                          onClick={() => quitarDeSolicitud(p.id)}
                          className="flex h-6 w-6 items-center justify-center rounded text-xs"
                          style={{ backgroundColor: MOCK.removeBg, color: MOCK.removeColor }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal parámetros por prueba */}
      {paramModalPrueba ? (
        <ParametrosModal
          testId={paramModalPrueba.id}
          testName={paramModalPrueba.name}
          seccion={seccionNombre(paramModalPrueba.panelId)}
          tipoNombre={paramModalPrueba.sampleTypeId ? (tipoNombreById.get(paramModalPrueba.sampleTypeId) ?? "") : "—"}
          subtipoNombre={
            paramModalPrueba.sampleSubtypeId ? (subtipoNombreById.get(paramModalPrueba.sampleSubtypeId) ?? "") : ""
          }
          initialSelected={paramSel[paramModalPrueba.id]}
          onSave={(ids) => {
            setParamSel((prev) => ({ ...prev, [paramModalPrueba.id]: ids }));
            setParamModalTestId(null);
            setToast({ title: "Parámetros del examen actualizados." });
          }}
          onClose={() => setParamModalTestId(null)}
        />
      ) : null}

      {/* Modal resumen: Ver selección / Confirmar y Guardar */}
      <Dialog open={resumenModo !== null} onOpenChange={(o) => !o && setResumenModo(null)}>
        <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{resumenModo === "guardar" ? "Pruebas a guardar" : "Pruebas seleccionadas"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Total: <b>{seleccionOrdenada.length}</b> prueba(s) · <b>{totalEstudios}</b> estudio(s).
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {seleccionOrdenada.map((p) => {
              const custom = paramSel[p.id];
              const paramTxt =
                p.paramCount > 0
                  ? custom
                    ? ` — Parámetros: ${custom.length}/${p.paramCount}`
                    : ` — Todos los parámetros (${p.paramCount})`
                  : "";
              return (
                <li key={p.id} style={{ color: MOCK.inkSoft }}>
                  {p.name}{" "}
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: MOCK.secBadgeBg, color: MOCK.tealDark }}
                  >
                    {seccionNombre(p.panelId)}
                  </span>{" "}
                  — {p.sampleTypeId ? tipoNombreById.get(p.sampleTypeId) : "—"} /{" "}
                  {p.sampleSubtypeId ? subtipoNombreById.get(p.sampleSubtypeId) : "—"} — Cant:{" "}
                  <b>{cantidades[p.id] ?? p.defaultQty ?? 1}</b>
                  {paramTxt}
                </li>
              );
            })}
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
              disabled={create.isPending || confirmando}
              onClick={resumenModo === "guardar" ? () => void confirmarGuardado() : () => setResumenModo(null)}
              className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: MOCK.teal }}
            >
              {resumenModo === "guardar"
                ? create.isPending || confirmando
                  ? "Guardando…"
                  : "Confirmar y Guardar"
                : "Aceptar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast ? (
        <Toast variant={toast.variant ?? "default"} open onOpenChange={(o) => !o && setToast(null)}>
          <ToastTitle>{toast.title}</ToastTitle>
          <ToastDescription />
        </Toast>
      ) : null}
    </div>
  );
}

/** Paso numerado de la cascada (`.cfg-step` + `.cfg-label .num`, líneas 30-33 del mockup). */
function CfgStep({
  num,
  label,
  hint,
  children,
}: {
  num: number;
  label: string;
  hint: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="border-b border-dashed py-2 last:border-b-0" style={{ borderColor: MOCK.line }}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: MOCK.inkSoft }}>
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ backgroundColor: MOCK.teal }}
        >
          {num}
        </span>
        {label}
        <span className="font-normal" style={{ color: MOCK.hintColor }}>
          · {hint}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Pill radio de la cascada (`.rb`/`.rb.sub`, líneas 35-40 del mockup). */
function RadioPill({
  name,
  label,
  count,
  active,
  disabled,
  variant,
  onSelect,
  testId,
}: {
  name: string;
  label: string;
  count: number | null;
  active: boolean;
  disabled?: boolean;
  variant?: "sub";
  onSelect: () => void;
  testId?: string;
}): React.ReactElement {
  const activeBg = variant === "sub" ? MOCK.tealSub : MOCK.teal;
  return (
    <label
      data-testid={testId}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs transition-colors",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        // .rb:hover (mockup línea 36) — único uso arbitrario, solo cuando inactiva.
        !disabled && !active ? "hover:bg-[#f0f6f7]" : "",
      ].join(" ")}
      style={{
        borderColor: active ? activeBg : MOCK.rbBorder,
        backgroundColor: active ? activeBg : "#fff",
        color: active ? "#fff" : MOCK.inkSoft,
        fontWeight: active ? 600 : 400,
      }}
    >
      <input
        type="radio"
        name={name}
        checked={active}
        disabled={disabled}
        onChange={() => !disabled && onSelect()}
        className="sr-only"
      />
      {label}
      {count !== null ? (
        <span
          className="rounded-full px-1.5 text-[10.5px] font-bold"
          style={{
            backgroundColor: active ? "rgba(255,255,255,.25)" : MOCK.cntBg,
            color: active ? "#fff" : MOCK.tealDark,
          }}
        >
          {count}
        </span>
      ) : null}
    </label>
  );
}

/** Edad simple en años, sin dependencia cruzada de paquete — mismo cálculo que el resto del router LIS. */
function calcularEdadSimple(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}
