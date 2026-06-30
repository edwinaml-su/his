"use client";

/**
 * CC-0006 §11.2 — Misceláneos de consulta (modelo híbrido).
 *
 * Persiste INLINE solo lo que no tiene módulo legacy equivalente:
 *   - Terapia respiratoria (gasometría Basal/O₂ + nebulizaciones/vibroterapia/
 *     palmopercusión).
 *   - Órdenes de inyección.
 * Todo lo demás (recetario, laboratorio, gabinete, ingreso, interconsulta,
 * remisión, incapacidad, constancia) se delega a su módulo legacy mediante
 * action-cards que navegan a la ruta correspondiente.
 *
 * El estado vive en `draft.misc` (persistido por useEvolucionDraft). Esta
 * sección es UI: lee `draft.misc` y despacha `SET_MISC`.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import type { EvolucionMiscelaneos } from "@his/contracts";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";

type TerapiaResp = NonNullable<EvolucionMiscelaneos["terapiaRespiratoria"]>;
type GasoTipo = TerapiaResp["gasometria"]["tipo"]; // "BASAL" | "O2"

const TEXTAREA_CLS =
  "flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

// ─── Estado local del formulario de terapia respiratoria ─────────────────────

interface TerapiaForm {
  tipo: GasoTipo;
  fio2: string;
  flujo: string;
  nebulizaciones: string;
  vibroterapia: string;
  palmopercusion: string;
}

function seedForm(m: EvolucionMiscelaneos): TerapiaForm {
  const tr = m.terapiaRespiratoria;
  return {
    tipo: tr?.gasometria.tipo ?? "BASAL",
    fio2: tr?.gasometria.fio2 != null ? String(tr.gasometria.fio2) : "",
    flujo: tr?.gasometria.flujo != null ? String(tr.gasometria.flujo) : "",
    nebulizaciones: tr?.nebulizaciones ?? "",
    vibroterapia: tr?.vibroterapia ?? "",
    palmopercusion: tr?.palmopercusion ?? "",
  };
}

function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Construye la terapia respiratoria desde el formulario. Devuelve `undefined`
 * cuando no hay contenido real (Basal sin parámetros ni instrucciones) para no
 * marcar el borrador como modificado por un bloque intacto (ver `tieneMisc`).
 * Los parámetros de O₂ (FiO₂/flujo) solo aplican con O₂ suplementario.
 */
function buildTerapia(f: TerapiaForm): TerapiaResp | undefined {
  const o2 = f.tipo === "O2";
  const fio2 = o2 ? numOrUndef(f.fio2) : undefined;
  const flujo = o2 ? numOrUndef(f.flujo) : undefined;
  const nebu = f.nebulizaciones.trim();
  const vibro = f.vibroterapia.trim();
  const palmo = f.palmopercusion.trim();
  const hayContenido = o2 || nebu !== "" || vibro !== "" || palmo !== "";
  if (!hayContenido) return undefined;
  return {
    gasometria: {
      tipo: f.tipo,
      ...(fio2 !== undefined ? { fio2 } : {}),
      ...(flujo !== undefined ? { flujo } : {}),
    },
    ...(nebu !== "" ? { nebulizaciones: nebu } : {}),
    ...(vibro !== "" ? { vibroterapia: vibro } : {}),
    ...(palmo !== "" ? { palmopercusion: palmo } : {}),
  };
}

// ─── Action-cards (delegación a módulos legacy) ──────────────────────────────

interface ActionDef {
  route: string;
  titulo: string;
  sub: string;
  icon: React.ReactNode;
}

const SVG = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-[18px] w-[18px]">
    {d}
  </svg>
);

/** §11.2 — solicitudes de estudios / prescripción (cabecera de misceláneos). */
const ACTIONS_ESTUDIOS: readonly ActionDef[] = [
  {
    route: "/ece/indicaciones/nueva",
    titulo: "Prescripción médica",
    sub: "Abre el recetario / indicaciones",
    icon: SVG(<><path d="M5 3h6l4 4v3M5 3v18h7" /><path d="M14 14h7M17.5 10.5 21 14l-3.5 3.5" /></>),
  },
  {
    route: "/ece/estudios/nueva",
    titulo: "Laboratorio clínico",
    sub: "Solicita exámenes de laboratorio",
    icon: SVG(<><path d="M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3" /><path d="M8 3h8M8 13h8" /></>),
  },
  {
    route: "/ece/estudios/nueva",
    titulo: "Exámenes de gabinete",
    sub: "Radiología, imágenes y cardiología",
    icon: SVG(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>),
  },
];

/** §11.2 — documentos / órdenes que abren su módulo legacy. */
const ACTIONS_DOCUMENTOS: readonly ActionDef[] = [
  {
    route: "/ece/orden-ingreso/nuevo",
    titulo: "Orden de Ingreso hospitalario",
    sub: "Abre la orden de ingreso",
    icon: SVG(<><path d="M3 21h18M6 21V8l6-4 6 4v13" /><path d="M12 9v6M9 12h6" /></>),
  },
  {
    route: "/ece/rri/nueva",
    titulo: "Orden de interconsulta médica",
    sub: "Solicita interconsulta",
    icon: SVG(<><path d="M17 8h2a2 2 0 0 1 2 2v9l-3-2H9a2 2 0 0 1-2-2v-1" /><path d="M3 4h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2L6 16V6a2 2 0 0 1 2-2z" /></>),
  },
  {
    route: "/ece/rri/nueva",
    titulo: "Hoja de Remisión",
    sub: "Genera remisión del paciente",
    icon: SVG(<><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="m9 14 2 2 4-4" /></>),
  },
  {
    route: "/ece/certificado-incapacidad/nuevo",
    titulo: "Incapacidad médica",
    sub: "Emite certificado de incapacidad",
    icon: SVG(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M12 8v6M9 11h6" /></>),
  },
  {
    route: "/ece/documento-asociado/nuevo",
    titulo: "Constancia médica",
    sub: "Emite constancia de atención",
    icon: SVG(<><path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M8 9h8M8 13h6" /><circle cx="16.5" cy="17.5" r="2.5" /></>),
  },
];

function ActionCard({ route, titulo, sub, icon }: ActionDef) {
  return (
    <a
      href={route}
      className="flex items-center gap-3 rounded-[10px] border border-border bg-background px-3.5 py-3 text-left transition-colors hover:border-[#3b82f6] hover:bg-[#eff6ff] dark:hover:bg-[#0f1f3a]"
    >
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-[rgba(13,148,136,0.12)] text-[#0d9488]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold text-foreground">{titulo}</span>
        <span className="block text-[11px] text-muted-foreground">{sub}</span>
      </span>
    </a>
  );
}

function ActionsGrid({ items }: { items: readonly ActionDef[] }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {items.map((a) => (
        <ActionCard key={a.titulo} {...a} />
      ))}
    </div>
  );
}

// ─── Grupo colapsable (details) ──────────────────────────────────────────────

function Grupo({
  titulo,
  icon,
  defaultOpen,
  children,
}: {
  titulo: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group/misc overflow-hidden rounded-[10px] border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 bg-muted/40 px-4 py-3 text-[13.5px] font-bold text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center text-[#0d9488]">{icon}</span>
        {titulo}
        <svg
          className="ml-auto h-4 w-4 shrink-0 transition-transform group-open/misc:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </summary>
      <div className="p-4">{children}</div>
    </details>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export function MiscelaneosSection() {
  const { draft, dispatch } = useEvolucionDraft();
  const misc = draft.misc;

  const [form, setForm] = React.useState<TerapiaForm>(() => seedForm(misc));
  const [inyOpen, setInyOpen] = React.useState(false);
  const [inyTexto, setInyTexto] = React.useState("");
  const [inyErr, setInyErr] = React.useState(false);

  function patchTerapia(p: Partial<TerapiaForm>) {
    const next = { ...form, ...p };
    setForm(next);
    dispatch({ type: "SET_MISC", misc: { ...misc, terapiaRespiratoria: buildTerapia(next) } });
  }

  function abrirIny() {
    setInyTexto("");
    setInyErr(false);
    setInyOpen(true);
  }

  function agregarIny() {
    const t = inyTexto.trim();
    if (!t) {
      setInyErr(true);
      return;
    }
    dispatch({
      type: "SET_MISC",
      misc: { ...misc, inyecciones: [...misc.inyecciones, { texto: t }] },
    });
    setInyOpen(false);
    setInyTexto("");
  }

  function eliminarIny(i: number) {
    dispatch({
      type: "SET_MISC",
      misc: { ...misc, inyecciones: misc.inyecciones.filter((_, idx) => idx !== i) },
    });
  }

  const o2 = form.tipo === "O2";

  return (
    <div className="space-y-3.5 text-[13px]">
      {/* Prescripción + estudios */}
      <ActionsGrid items={ACTIONS_ESTUDIOS} />

      {/* Terapia respiratoria (inline, persistida) */}
      <Grupo
        defaultOpen
        titulo="Terapia respiratoria"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-full w-full">
            <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z" />
          </svg>
        }
      >
        <div className="space-y-3">
          {/* Gasometría */}
          <div className="rounded-[10px] border border-border p-3.5">
            <div className="mb-2.5 border-b border-border pb-1.5 text-[13px] font-bold text-foreground">
              Gasometría arterial
            </div>
            <div className="flex flex-wrap gap-2">
              {(["BASAL", "O2"] as const).map((t) => {
                const sel = form.tipo === t;
                const label = t === "BASAL" ? "Basal" : "Con O₂ suplementario";
                return (
                  <label
                    key={t}
                    className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-full border px-3.5 py-[7px] text-[12.5px] ${
                      sel
                        ? "border-[#0d9488] bg-[rgba(13,148,136,0.08)] font-semibold text-[#0d9488]"
                        : "border-border text-foreground"
                    }`}
                  >
                    <input
                      type="radio"
                      name="misc-gaso-arterial"
                      value={t}
                      checked={sel}
                      onChange={() => patchTerapia({ tipo: t })}
                      className="accent-[#0d9488]"
                    />
                    {label}
                  </label>
                );
              })}
            </div>
            {o2 && (
              <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <Label htmlFor="misc-fio2" className="mb-1 block text-xs">
                    FiO₂
                  </Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="misc-fio2"
                      inputMode="numeric"
                      value={form.fio2}
                      onChange={(e) => patchTerapia({ fio2: e.target.value })}
                      placeholder="FiO₂"
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px]"
                    />
                    <span className="rounded-md bg-muted/40 px-2.5 py-1.5 text-[12.5px] font-bold text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>
                <div>
                  <Label htmlFor="misc-flujo" className="mb-1 block text-xs">
                    Flujo
                  </Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="misc-flujo"
                      inputMode="decimal"
                      value={form.flujo}
                      onChange={(e) => patchTerapia({ flujo: e.target.value })}
                      placeholder="Flujo"
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px]"
                    />
                    <span className="rounded-md bg-muted/40 px-2.5 py-1.5 text-[12.5px] font-bold text-muted-foreground">
                      L/min
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Nebulizaciones / vibroterapia / palmopercusión */}
          <div className="rounded-[10px] border border-border p-3.5">
            <Label htmlFor="misc-nebu" className="mb-2 block text-[13px] font-bold text-foreground">
              Nebulizaciones
            </Label>
            <textarea
              id="misc-nebu"
              rows={3}
              value={form.nebulizaciones}
              onChange={(e) => patchTerapia({ nebulizaciones: e.target.value })}
              placeholder="Instrucciones de nebulización (medicamento, dosis, frecuencia, duración)…"
              className={TEXTAREA_CLS}
            />
          </div>
          <div className="rounded-[10px] border border-border p-3.5">
            <Label htmlFor="misc-vibro" className="mb-2 block text-[13px] font-bold text-foreground">
              Vibroterapia
            </Label>
            <textarea
              id="misc-vibro"
              rows={2}
              value={form.vibroterapia}
              onChange={(e) => patchTerapia({ vibroterapia: e.target.value })}
              placeholder="Instrucciones de vibroterapia…"
              className={TEXTAREA_CLS}
            />
          </div>
          <div className="rounded-[10px] border border-border p-3.5">
            <Label htmlFor="misc-palmo" className="mb-2 block text-[13px] font-bold text-foreground">
              Palmo percusión
            </Label>
            <textarea
              id="misc-palmo"
              rows={2}
              value={form.palmopercusion}
              onChange={(e) => patchTerapia({ palmopercusion: e.target.value })}
              placeholder="Instrucciones de palmo percusión / drenaje postural…"
              className={TEXTAREA_CLS}
            />
          </div>
        </div>
      </Grupo>

      {/* Órdenes de inyección (inline, persistidas) */}
      <Grupo
        titulo="Orden de inyecciones"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-full w-full">
            <path d="m18 2 4 4M17 7l3-3M9.5 14.5 4 20l-2 2M14 6l4 4-8.5 8.5L5 19l-1-4z" />
          </svg>
        }
      >
        <Button type="button" variant="outline" size="sm" className="mb-3" onClick={abrirIny}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Agregar orden de inyección
        </Button>
        <div className="overflow-hidden rounded-[10px] border border-border">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="border-b border-border bg-muted/40 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Orden de inyección
                </th>
                <th className="w-[60px] border-b border-border bg-muted/40" />
              </tr>
            </thead>
            <tbody>
              {misc.inyecciones.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 py-3.5 text-center text-xs text-muted-foreground">
                    Sin órdenes agregadas.
                  </td>
                </tr>
              ) : (
                misc.inyecciones.map((iny, i) => (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 align-middle text-foreground">{iny.texto}</td>
                    <td className="px-3 py-2 text-right align-middle">
                      <button
                        type="button"
                        onClick={() => eliminarIny(i)}
                        title="Eliminar"
                        aria-label="Eliminar orden de inyección"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Grupo>

      {/* Documentos / órdenes legacy */}
      <ActionsGrid items={ACTIONS_DOCUMENTOS} />

      {/* Modal: agregar orden de inyección */}
      <Dialog open={inyOpen} onOpenChange={(v) => { if (!v) setInyOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Orden de inyección</DialogTitle>
            <DialogDescription>
              Escriba la orden de inyección (medicamento, dosis, vía y frecuencia).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="misc-iny-texto">Orden de inyección</Label>
            <textarea
              id="misc-iny-texto"
              rows={3}
              value={inyTexto}
              onChange={(e) => { setInyTexto(e.target.value); setInyErr(false); }}
              placeholder="Describa la orden de inyección…"
              aria-invalid={inyErr || undefined}
              aria-describedby={inyErr ? "misc-iny-err" : undefined}
              className={`${TEXTAREA_CLS} ${inyErr ? "border-destructive focus-visible:ring-destructive" : ""}`}
            />
            {inyErr && (
              <p id="misc-iny-err" role="alert" className="text-xs text-destructive">
                Escriba la orden antes de agregar.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInyOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={agregarIny}>
              Agregar inyección
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
