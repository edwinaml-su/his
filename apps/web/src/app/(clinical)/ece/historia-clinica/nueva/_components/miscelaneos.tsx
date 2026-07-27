"use client";

/**
 * MiscelaneosConsulta — RF-10 (opcional).
 * Prescripción médica, laboratorio, gabinete, terapia respiratoria,
 * órdenes de inyecciones, tarjetas de acción a otros módulos.
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Textarea } from "@his/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@his/ui/components/dialog";
import { Toast, ToastTitle } from "@his/ui/components/toast";
import type {
  TerapiaRespiratoria,
  OrdenExamen,
  OrdenInyeccion,
  LabCatalogArea,
} from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import { toUpper } from "./utils";

// ── Sub-componente: Orden de exámenes ────────────────────────────────────────
// Catálogo consumido desde BD (trpc.lis.test.listByArea) — CC-0011 item 12.
// El shape persistido {seccion, examen, cantidad} no cambia: seccion = nombre
// del panel, examen = nombre del test (paridad con EXAM_CATALOGS del mockup).

function OrdenExamenesBlock({
  catalog,
  catalogKey,
  loading,
  value,
  onChange,
  onToast,
}: {
  catalog: Record<string, string[]>;
  catalogKey: string;
  loading: boolean;
  value: OrdenExamen[];
  onChange: (v: OrdenExamen[]) => void;
  onToast: (mensaje: string) => void;
}) {
  const secciones = Object.keys(catalog);
  const [seccion, setSeccion] = React.useState(secciones[0] ?? "");
  const [checked, setChecked] = React.useState<Record<number, boolean>>({});
  const [cantidades, setCantidades] = React.useState<Record<number, string>>({});

  // El catálogo llega asíncrono (trpc) — una vez cargado, selecciona la primera
  // sección si aún no hay ninguna seleccionada.
  React.useEffect(() => {
    const primera = secciones[0];
    if (!seccion && primera) setSeccion(primera);
  }, [seccion, secciones]);

  const examenesSeccion = catalog[seccion] ?? [];
  const catalogoVacio = !loading && secciones.length === 0;

  function handleAgregar() {
    const checkedIdx = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([k]) => parseInt(k, 10));
    if (checkedIdx.length === 0) {
      onToast("Seleccione al menos un examen");
      return;
    }
    const nuevos: OrdenExamen[] = [];
    let dup = 0;
    checkedIdx.forEach((idx) => {
      const examen = examenesSeccion[idx];
      if (!examen) return;
      const cantidad = parseInt(cantidades[idx] ?? "1", 10) || 1;
      if (value.some((o) => o.seccion === seccion && o.examen === examen)) {
        dup++;
      } else {
        nuevos.push({ seccion, examen, cantidad });
      }
    });
    // Bug fix (item 13a): los checkboxes se limpian SIEMPRE, incluso si todo era duplicado.
    setChecked({});
    setCantidades({});
    if (nuevos.length > 0) onChange([...value, ...nuevos]);
    const added = nuevos.length;
    if (added && dup) onToast(`${added} agregado(s) · ${dup} ya estaba(n) en la solicitud`);
    else if (added) onToast(`${added} examen(es) agregado(s) a la solicitud`);
    else if (dup) onToast("Esos exámenes ya están en la solicitud");
  }

  function eliminar(i: number) {
    onChange(value.filter((_, j) => j !== i));
  }

  if (catalogoVacio) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
        Catálogo no disponible para esta área.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Radios de sección */}
      <div className="flex flex-wrap gap-2">
        {secciones.map((s) => (
          <label
            key={s}
            className={[
              "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
              seccion === s
                ? "bg-primary/8 border-primary font-semibold text-primary"
                : "border-input text-muted-foreground hover:bg-muted",
            ].join(" ")}
          >
            <input
              type="radio"
              name={`sec-${catalogKey}`}
              value={s}
              checked={seccion === s}
              disabled={loading}
              onChange={() => {
                setSeccion(s);
                setChecked({});
                setCantidades({});
              }}
              className="accent-primary"
            />
            {s}
          </label>
        ))}
        {loading && secciones.length === 0 && (
          <span className="text-xs text-muted-foreground">Cargando catálogo…</span>
        )}
      </div>

      {/* Lista de exámenes */}
      <div className="overflow-hidden rounded-md border border-border">
        {examenesSeccion.map((ex, idx) => (
          <div
            key={idx}
            className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0"
          >
            <input
              type="checkbox"
              id={`ex-${catalogKey}-${idx}`}
              checked={checked[idx] ?? false}
              disabled={loading}
              onChange={(e) => setChecked((c) => ({ ...c, [idx]: e.target.checked }))}
              className="accent-primary"
            />
            <label htmlFor={`ex-${catalogKey}-${idx}`} className="flex-1 cursor-pointer text-sm">
              {ex}
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={cantidades[idx] ?? "1"}
              disabled={loading}
              onChange={(e) => setCantidades((c) => ({ ...c, [idx]: e.target.value }))}
              className="w-16 rounded border border-input bg-background px-2 py-1 text-center text-xs"
            />
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={handleAgregar} disabled={loading}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="mr-1.5 h-3.5 w-3.5"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Agregar a la Solicitud
      </Button>

      {/* Grid de solicitud */}
      {value.filter((o) => Object.keys(catalog).includes(o.seccion)).length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide">
                  Examen
                </th>
                <th
                  className="px-3 py-2 text-left font-semibold uppercase tracking-wide"
                  style={{ width: 100 }}
                >
                  Cantidad
                </th>
                <th className="px-3 py-2" style={{ width: 50 }} />
              </tr>
            </thead>
            <tbody>
              {value
                .map((o, i) => ({ o, i }))
                .filter(({ o }) => Object.keys(catalog).includes(o.seccion))
                .map(({ o, i }) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{o.examen}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        className="w-20 rounded border border-input bg-background px-2 py-1 text-center text-xs"
                        value={o.cantidad}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10) || 1;
                          onChange(value.map((x, j) => (j === i ? { ...x, cantidad: v } : x)));
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => eliminar(i)}
                        aria-label={`Eliminar ${o.examen}`}
                        className="hover:text-destructive/70 text-destructive"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          className="h-3.5 w-3.5"
                        >
                          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Props principales ─────────────────────────────────────────────────────────

interface MiscelaneosProps {
  terapiaRespiratoria: TerapiaRespiratoria | null;
  onTerapia: (v: TerapiaRespiratoria | null) => void;
  ordenesExamenes: OrdenExamen[];
  onOrdenesExamenes: (v: OrdenExamen[]) => void;
  ordenesInyecciones: OrdenInyeccion[];
  onOrdenesInyecciones: (v: OrdenInyeccion[]) => void;
  disabled?: boolean;
  /** Propaga contexto (?cuentaId=…&episodioId=…) a las tarjetas de acción — item 15. */
  cuentaId?: string;
  episodioId?: string | null;
}

/** Construye un catálogo {panel: [test, …]} a partir de trpc.lis.test.listByArea (item 12). */
function useCatalogoArea(area: LabCatalogArea) {
  const q = trpc.lis.test.listByArea.useQuery({ area });
  const catalog = React.useMemo<Record<string, string[]>>(() => {
    const panels = q.data ?? [];
    return Object.fromEntries(panels.map((p) => [p.nombre, p.tests.map((t) => t.nombre)]));
  }, [q.data]);
  return { catalog, loading: q.isLoading };
}

export function MiscelaneosConsulta({
  terapiaRespiratoria,
  onTerapia,
  ordenesExamenes,
  onOrdenesExamenes,
  ordenesInyecciones,
  onOrdenesInyecciones,
  disabled,
  cuentaId,
  episodioId,
}: MiscelaneosProps) {
  const [inyModalOpen, setInyModalOpen] = React.useState(false);
  const [inyDraft, setInyDraft] = React.useState("");
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);

  // Construye la query string de contexto propagado a los módulos destino.
  const ctxQuery = React.useMemo(() => {
    const params = new URLSearchParams();
    if (cuentaId) params.set("cuentaId", cuentaId);
    if (episodioId) params.set("episodioId", episodioId);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [cuentaId, episodioId]);

  const catalogoLab = useCatalogoArea("LABORATORIO");
  const catalogoRad = useCatalogoArea("RADIOLOGIA");
  const catalogoCardio = useCatalogoArea("CARDIOLOGIA");

  function setTerapia<K extends keyof TerapiaRespiratoria>(k: K, v: TerapiaRespiratoria[K]) {
    const base: TerapiaRespiratoria = terapiaRespiratoria ?? {
      gasometria: { tipo: "BASAL" },
    };
    onTerapia({ ...base, [k]: v });
  }

  function setGaso<K extends keyof TerapiaRespiratoria["gasometria"]>(
    k: K,
    v: TerapiaRespiratoria["gasometria"][K],
  ) {
    const base: TerapiaRespiratoria = terapiaRespiratoria ?? {
      gasometria: { tipo: "BASAL" },
    };
    onTerapia({ ...base, gasometria: { ...base.gasometria, [k]: v } });
  }

  const gaso = terapiaRespiratoria?.gasometria ?? { tipo: "BASAL" as const };
  const isO2 = gaso.tipo === "O2";

  function addInyeccion() {
    const texto = toUpper(inyDraft.trim());
    if (!texto) return;
    onOrdenesInyecciones([...ordenesInyecciones, { texto }]);
    setInyDraft("");
    setInyModalOpen(false);
  }

  const labOrders = ordenesExamenes.filter((o) => o.seccion in catalogoLab.catalog);
  const radOrders = ordenesExamenes.filter((o) => o.seccion in catalogoRad.catalog);
  const cardOrders = ordenesExamenes.filter((o) => o.seccion in catalogoCardio.catalog);

  // Bug fix (item 13b): NO reordenar el array global al actualizar una sola
  // sección. Se reconstruye conservando la posición original de cada ítem
  // existente (edición de cantidad in-place, eliminación in-place) y los
  // ítems nuevos se anexan al final del array GLOBAL, no al final del
  // subconjunto local del catálogo tocado.
  function updateOrders(catalog: Record<string, string[]>, next: OrdenExamen[]) {
    const secs = new Set(Object.keys(catalog));
    const key = (o: OrdenExamen) => `${o.seccion} ${o.examen}`;
    const nextByKey = new Map(next.map((o) => [key(o), o]));
    const seen = new Set<string>();
    const merged: OrdenExamen[] = [];
    for (const o of ordenesExamenes) {
      if (secs.has(o.seccion)) {
        const updated = nextByKey.get(key(o));
        if (updated) {
          merged.push(updated);
          seen.add(key(o));
        }
        // si no está en `next`, fue eliminado — se omite in-place.
      } else {
        merged.push(o);
      }
    }
    for (const o of next) {
      if (!seen.has(key(o))) merged.push(o);
    }
    onOrdenesExamenes(merged);
  }

  // Definimos las tarjetas de acción (no crean datos, navegan a otros módulos)
  const ACTION_CARDS = [
    {
      route: "/ece/orden-ingreso/nuevo",
      name: "Orden de Ingreso hospitalario",
      desc: "Abre la orden de ingreso",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-[18px] w-[18px]"
        >
          <path d="M3 21h18M6 21V8l6-4 6 4v13" />
          <path d="M12 9v6M9 12h6" />
        </svg>
      ),
    },
    {
      route: "/ece/rri/nueva",
      name: "Orden de interconsulta médica",
      desc: "Solicita interconsulta",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-[18px] w-[18px]"
        >
          <path d="M17 8h2a2 2 0 0 1 2 2v9l-3-2H9a2 2 0 0 1-2-2v-1" />
          <path opacity=".5" d="M3 4h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2L6 16V6a2 2 0 0 1 2-2z" />
        </svg>
      ),
    },
    {
      // /ece/remision/nueva del mockup no existe — precedente CC-0006: RRI
      // (Referencia/Retorno/Interconsulta) ya cubre "referencia" como tipo.
      route: "/ece/rri/nueva",
      name: "Hoja de Remisión",
      desc: "Genera remisión del paciente",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-[18px] w-[18px]"
        >
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <path d="m9 14 2 2 4-4" />
        </svg>
      ),
    },
    {
      route: "/ece/certificado-incapacidad/nuevo",
      name: "Incapacidad médica",
      desc: "Emite certificado de incapacidad",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-[18px] w-[18px]"
        >
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M12 8v6M9 11h6" />
        </svg>
      ),
    },
    {
      // /ece/constancia/nueva del mockup no existe — precedente CC-0006: se
      // reusa el módulo genérico de documento asociado.
      route: "/ece/documento-asociado/nuevo",
      name: "Constancia médica",
      desc: "Emite constancia de atención",
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-[18px] w-[18px]"
        >
          <path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M8 9h8M8 13h6" />
          <circle cx="16.5" cy="17.5" r="2.5" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Prescripción médica — antes de laboratorio */}
      <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => window.open(`/ece/indicaciones/nueva${ctxQuery}`, "_blank")}
          className="flex items-center gap-3 rounded-md border border-border bg-background px-3.5 py-3 text-left transition-colors hover:border-ring hover:bg-accent"
        >
          <span className="bg-primary/10 grid h-9 w-9 flex-none place-items-center rounded-lg text-primary">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-[18px] w-[18px]"
            >
              <path d="M5 3h6l4 4v3M5 3v18h7" />
              <path d="M14 14h7M17.5 10.5 21 14l-3.5 3.5" />
            </svg>
          </span>
          <span>
            <span className="block text-sm font-bold">Prescripción médica</span>
            <span className="block text-xs text-muted-foreground">
              Abre el recetario / indicaciones
            </span>
          </span>
        </button>
      </div>

      {/* Laboratorio clínico */}
      <details className="overflow-hidden rounded-md border border-border" open>
        <summary className="flex cursor-pointer items-center gap-2.5 bg-surface-2 px-4 py-3 text-sm font-bold">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-[17px] w-[17px]"
          >
            <path d="M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3" />
            <path d="M8 3h8M8 13h8" />
          </svg>
          Laboratorio clínico
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="ml-auto h-4 w-4 transition-transform"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </summary>
        <div className="p-4">
          <OrdenExamenesBlock
            catalog={catalogoLab.catalog}
            catalogKey="lab"
            loading={catalogoLab.loading}
            value={labOrders}
            onChange={(v) => updateOrders(catalogoLab.catalog, v)}
            onToast={setToastMsg}
          />
        </div>
      </details>

      {/* Exámenes de gabinete — nivel anidado con borde izquierdo (mockup .level) */}
      <details className="overflow-hidden rounded-md border border-border">
        <summary className="flex cursor-pointer items-center gap-2.5 bg-surface-2 px-4 py-3 text-sm font-bold">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-[17px] w-[17px]"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          Exámenes de gabinete
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="ml-auto h-4 w-4"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </summary>
        <div className="p-4">
          <div className="ml-1 space-y-4 border-l-2 border-border pl-3.5">
            <div>
              <p className="mb-3 flex items-center gap-2 text-xs font-bold text-accent-foreground">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-4 w-4"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 3v18M3 12h18" />
                </svg>
                Radiología e imágenes
              </p>
              <OrdenExamenesBlock
                catalog={catalogoRad.catalog}
                catalogKey="radiologia"
                loading={catalogoRad.loading}
                value={radOrders}
                onChange={(v) => updateOrders(catalogoRad.catalog, v)}
                onToast={setToastMsg}
              />
            </div>
            <div>
              <p className="mb-3 flex items-center gap-2 text-xs font-bold text-accent-foreground">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-4 w-4"
                >
                  <path d="M3 12h4l2 6 4-12 2 6h6" />
                </svg>
                Estudios de cardiología
              </p>
              <OrdenExamenesBlock
                catalog={catalogoCardio.catalog}
                catalogKey="cardiologia"
                loading={catalogoCardio.loading}
                value={cardOrders}
                onChange={(v) => updateOrders(catalogoCardio.catalog, v)}
                onToast={setToastMsg}
              />
            </div>
          </div>
        </div>
      </details>

      {/* Terapia Respiratoria */}
      <details className="overflow-hidden rounded-md border border-border">
        <summary className="flex cursor-pointer items-center gap-2.5 bg-surface-2 px-4 py-3 text-sm font-bold">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-[17px] w-[17px]"
          >
            <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z" />
          </svg>
          Terapia Respiratoria
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="ml-auto h-4 w-4"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </summary>
        <div className="space-y-3 p-4">
          {/* Gasometría arterial */}
          <div className="rounded-md border border-border p-3">
            <p className="mb-2 border-b border-border pb-1 text-sm font-bold">
              Gasometría arterial
            </p>
            <div className="flex flex-wrap gap-2">
              <label
                className={[
                  "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                  gaso.tipo === "BASAL"
                    ? "bg-primary/8 border-primary font-semibold text-primary"
                    : "border-input text-muted-foreground",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="gaso"
                  value="BASAL"
                  checked={gaso.tipo === "BASAL"}
                  onChange={() => setGaso("tipo", "BASAL")}
                  className="accent-primary"
                />
                Basal
              </label>
              <label
                className={[
                  "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                  gaso.tipo === "O2"
                    ? "bg-primary/8 border-primary font-semibold text-primary"
                    : "border-input text-muted-foreground",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="gaso"
                  value="O2"
                  checked={gaso.tipo === "O2"}
                  onChange={() => setGaso("tipo", "O2")}
                  className="accent-primary"
                />
                Con O₂ suplementario
              </label>
            </div>
            {isO2 && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold">FiO₂</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      placeholder="FiO₂"
                      value={gaso.fio2 ?? ""}
                      onChange={(e) => setGaso("fio2", parseFloat(e.target.value) || undefined)}
                    />
                    <span className="rounded-md bg-muted px-2 py-1.5 text-xs font-bold text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Flujo</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      placeholder="Flujo"
                      value={gaso.flujo ?? ""}
                      onChange={(e) => setGaso("flujo", parseFloat(e.target.value) || undefined)}
                    />
                    <span className="rounded-md bg-muted px-2 py-1.5 text-xs font-bold text-muted-foreground">
                      L/min
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Nebulizaciones */}
          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-bold">Nebulizaciones</p>
            <Textarea
              rows={3}
              placeholder="Instrucciones de nebulización (medicamento, dosis, frecuencia, duración)…"
              value={terapiaRespiratoria?.nebulizaciones ?? ""}
              onChange={(e) => setTerapia("nebulizaciones", toUpper(e.target.value))}
              className="uppercase placeholder:normal-case"
            />
          </div>
          {/* Vibroterapia */}
          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-bold">Vibroterapia</p>
            <Textarea
              rows={2}
              placeholder="Instrucciones de vibroterapia…"
              value={terapiaRespiratoria?.vibroterapia ?? ""}
              onChange={(e) => setTerapia("vibroterapia", toUpper(e.target.value))}
              className="uppercase placeholder:normal-case"
            />
          </div>
          {/* Palmo percusión */}
          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-bold">Palmo percusión</p>
            <Textarea
              rows={2}
              placeholder="Instrucciones de palmo percusión / drenaje postural…"
              value={terapiaRespiratoria?.palmopercusion ?? ""}
              onChange={(e) => setTerapia("palmopercusion", toUpper(e.target.value))}
              className="uppercase placeholder:normal-case"
            />
          </div>
        </div>
      </details>

      {/* Orden de Inyecciones */}
      <details className="overflow-hidden rounded-md border border-border">
        <summary className="flex cursor-pointer items-center gap-2.5 bg-surface-2 px-4 py-3 text-sm font-bold">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-[17px] w-[17px]"
          >
            <path d="m18 2 4 4M17 7l3-3M9.5 14.5 4 20l-2 2M14 6l4 4-8.5 8.5L5 19l-1-4z" />
          </svg>
          Orden de Inyecciones
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="ml-auto h-4 w-4"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </summary>
        <div className="p-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setInyModalOpen(true)}
            disabled={disabled}
            className="mb-3"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="mr-1.5 h-3.5 w-3.5"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Agregar orden de inyección
          </Button>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide">
                    Orden de inyección
                  </th>
                  <th className="px-3 py-2" style={{ width: 50 }} />
                </tr>
              </thead>
              <tbody>
                {ordenesInyecciones.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-3 text-center text-xs text-muted-foreground">
                      Sin órdenes agregadas.
                    </td>
                  </tr>
                ) : (
                  ordenesInyecciones.map((o, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 uppercase">{o.texto}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            onOrdenesInyecciones(ordenesInyecciones.filter((_, j) => j !== i))
                          }
                          aria-label={`Eliminar inyección ${i + 1}`}
                          className="hover:text-destructive/70 text-destructive"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            className="h-3.5 w-3.5"
                          >
                            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      {/* Tarjetas de acción */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ACTION_CARDS.map((ac) => (
          <button
            key={ac.name}
            type="button"
            disabled={disabled}
            onClick={() => window.open(`${ac.route}${ctxQuery}`, "_blank")}
            className="flex items-center gap-3 rounded-md border border-border bg-background px-3.5 py-3 text-left transition-colors hover:border-ring hover:bg-accent"
          >
            <span className="bg-primary/10 grid h-9 w-9 flex-none place-items-center rounded-lg text-primary">
              {ac.icon}
            </span>
            <span>
              <span className="block text-sm font-bold">{ac.name}</span>
              <span className="block text-xs text-muted-foreground">{ac.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Modal inyección */}
      <Dialog open={inyModalOpen} onOpenChange={(o) => !o && setInyModalOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Orden de inyección</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={3}
            value={inyDraft}
            onChange={(e) => setInyDraft(e.target.value.toUpperCase())}
            placeholder="Descripción de la inyección…"
            autoFocus
            className="uppercase placeholder:normal-case"
          />
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setInyModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={addInyeccion} disabled={!inyDraft.trim()}>
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast — feedback de la factory de órdenes de exámenes (item 13c) */}
      {toastMsg ? (
        <Toast open={Boolean(toastMsg)} onOpenChange={(o) => !o && setToastMsg(null)}>
          <ToastTitle>{toastMsg}</ToastTitle>
        </Toast>
      ) : null}
    </div>
  );
}
