"use client";

/**
 * Formulario nativo de Lesión de Causa Externa (REQ-ECE-LCE-001).
 *
 * Captura epidemiológica MINSAL ligada al episodio. Se presenta aislado en un
 * modal (estilo iframe) desde la historia clínica. Estados: borrador → firmado.
 * Al firmar se exige ≥1 mecanismo de la lesión.
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import { Checkbox } from "@his/ui/components/checkbox";
import type { LceDatos } from "@his/contracts";
import {
  TIPO_EVENTO,
  MECANISMO,
  MEC_EXPLOSION,
  MEC_FUEGO,
  MEC_INTOXICACION,
  MEC_MORDEDURA,
  INTENCIONALIDAD,
  LUGAR,
  ACTIVIDAD,
  TRANSPORTE_VICTIMA,
  CONTRAPARTE,
  USUARIO_VIA,
  TIPO_ACCIDENTE,
  VIOLENCIA_RELACION,
  VIOLENCIA_CONTEXTO,
  VIOLENCIA_AUTOINFLIGIDA,
  SEVERIDAD,
  DESTINO,
  glasgowCategoria,
  type LceOpcion,
} from "./catalogos";
import {
  REGIONES,
  VIEWBOX,
  regionPath,
  type VistaCuerpo,
  type SitioCorporal,
} from "./body-map";

// ─── Estado del formulario ──────────────────────────────────────────────────

export interface LceFormState {
  eventoFechaHora: string;
  discapacidad: "" | "si" | "no";
  tipoEvento: string[];
  tipoEventoOtro: string;
  lugarDepartamento: string;
  lugarMunicipio: string;
  lugarDireccion: string;
  mecanismo: string[];
  mecanismoOtro: string;
  mecExplosion: string[];
  mecFuego: string[];
  mecIntoxicacion: string[];
  mecIntoxicacionOtro: string;
  mecMordedura: string[];
  mecMordeduraOtro: string;
  intencionalidad: string[];
  intencionalidadOtro: string;
  lugar: string[];
  lugarOtro: string;
  actividad: string[];
  actividadOtro: string;
  transporteVictima: string[];
  transporteVictimaOtro: string;
  contraparte: string[];
  contraparteOtro: string;
  usuarioVia: string[];
  tipoAccidente: string[];
  tipoAccidenteOtro: string;
  violenciaRelacion: string[];
  violenciaRelacionOtro: string;
  violenciaContexto: string[];
  violenciaContextoOtro: string;
  violenciaAutoinfligida: string[];
  violenciaAutoinfligidaOtro: string;
  severidad: string[];
  glasgowTotal: string;
  mapaCorporalSitios: SitioCorporal[];
  diagnosticoNaturaleza: string;
  sitioAnatomico: string;
  destino: string[];
}

export const LCE_INITIAL: LceFormState = {
  eventoFechaHora: "",
  discapacidad: "",
  tipoEvento: [], tipoEventoOtro: "",
  lugarDepartamento: "", lugarMunicipio: "", lugarDireccion: "",
  mecanismo: [], mecanismoOtro: "",
  mecExplosion: [], mecFuego: [],
  mecIntoxicacion: [], mecIntoxicacionOtro: "",
  mecMordedura: [], mecMordeduraOtro: "",
  intencionalidad: [], intencionalidadOtro: "",
  lugar: [], lugarOtro: "",
  actividad: [], actividadOtro: "",
  transporteVictima: [], transporteVictimaOtro: "",
  contraparte: [], contraparteOtro: "",
  usuarioVia: [],
  tipoAccidente: [], tipoAccidenteOtro: "",
  violenciaRelacion: [], violenciaRelacionOtro: "",
  violenciaContexto: [], violenciaContextoOtro: "",
  violenciaAutoinfligida: [], violenciaAutoinfligidaOtro: "",
  severidad: [],
  glasgowTotal: "",
  mapaCorporalSitios: [],
  diagnosticoNaturaleza: "", sitioAnatomico: "",
  destino: [],
};

function isoToLocal(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function datosToState(d: LceDatos | null | undefined): LceFormState {
  if (!d) return LCE_INITIAL;
  return {
    eventoFechaHora: isoToLocal(d.eventoFechaHora),
    discapacidad: d.discapacidad == null ? "" : d.discapacidad ? "si" : "no",
    tipoEvento: d.tipoEvento ?? [], tipoEventoOtro: d.tipoEventoOtro ?? "",
    lugarDepartamento: d.lugarDepartamento ?? "",
    lugarMunicipio: d.lugarMunicipio ?? "",
    lugarDireccion: d.lugarDireccion ?? "",
    mecanismo: d.mecanismo ?? [], mecanismoOtro: d.mecanismoOtro ?? "",
    mecExplosion: d.mecExplosion ?? [], mecFuego: d.mecFuego ?? [],
    mecIntoxicacion: d.mecIntoxicacion ?? [], mecIntoxicacionOtro: d.mecIntoxicacionOtro ?? "",
    mecMordedura: d.mecMordedura ?? [], mecMordeduraOtro: d.mecMordeduraOtro ?? "",
    intencionalidad: d.intencionalidad ?? [], intencionalidadOtro: d.intencionalidadOtro ?? "",
    lugar: d.lugar ?? [], lugarOtro: d.lugarOtro ?? "",
    actividad: d.actividad ?? [], actividadOtro: d.actividadOtro ?? "",
    transporteVictima: d.transporteVictima ?? [], transporteVictimaOtro: d.transporteVictimaOtro ?? "",
    contraparte: d.contraparte ?? [], contraparteOtro: d.contraparteOtro ?? "",
    usuarioVia: d.usuarioVia ?? [],
    tipoAccidente: d.tipoAccidente ?? [], tipoAccidenteOtro: d.tipoAccidenteOtro ?? "",
    violenciaRelacion: d.violenciaRelacion ?? [], violenciaRelacionOtro: d.violenciaRelacionOtro ?? "",
    violenciaContexto: d.violenciaContexto ?? [], violenciaContextoOtro: d.violenciaContextoOtro ?? "",
    violenciaAutoinfligida: d.violenciaAutoinfligida ?? [], violenciaAutoinfligidaOtro: d.violenciaAutoinfligidaOtro ?? "",
    severidad: d.severidad ?? [],
    glasgowTotal: d.glasgowTotal == null ? "" : String(d.glasgowTotal),
    mapaCorporalSitios: d.mapaCorporalSitios ?? [],
    diagnosticoNaturaleza: d.diagnosticoNaturaleza ?? "",
    sitioAnatomico: d.sitioAnatomico ?? "",
    destino: d.destino ?? [],
  };
}

export function stateToDatos(s: LceFormState): LceDatos {
  const otro = (v: string) => (v.trim() ? v.trim() : undefined);
  const g = s.glasgowTotal.trim() ? parseInt(s.glasgowTotal, 10) : null;
  return {
    eventoFechaHora: s.eventoFechaHora ? new Date(s.eventoFechaHora).toISOString() : undefined,
    discapacidad: s.discapacidad === "" ? null : s.discapacidad === "si",
    tipoEvento: s.tipoEvento, tipoEventoOtro: otro(s.tipoEventoOtro),
    lugarDepartamento: otro(s.lugarDepartamento),
    lugarMunicipio: otro(s.lugarMunicipio),
    lugarDireccion: otro(s.lugarDireccion),
    mecanismo: s.mecanismo, mecanismoOtro: otro(s.mecanismoOtro),
    mecExplosion: s.mecExplosion, mecFuego: s.mecFuego,
    mecIntoxicacion: s.mecIntoxicacion, mecIntoxicacionOtro: otro(s.mecIntoxicacionOtro),
    mecMordedura: s.mecMordedura, mecMordeduraOtro: otro(s.mecMordeduraOtro),
    intencionalidad: s.intencionalidad, intencionalidadOtro: otro(s.intencionalidadOtro),
    lugar: s.lugar, lugarOtro: otro(s.lugarOtro),
    actividad: s.actividad, actividadOtro: otro(s.actividadOtro),
    transporteVictima: s.transporteVictima, transporteVictimaOtro: otro(s.transporteVictimaOtro),
    contraparte: s.contraparte, contraparteOtro: otro(s.contraparteOtro),
    usuarioVia: s.usuarioVia,
    tipoAccidente: s.tipoAccidente, tipoAccidenteOtro: otro(s.tipoAccidenteOtro),
    violenciaRelacion: s.violenciaRelacion, violenciaRelacionOtro: otro(s.violenciaRelacionOtro),
    violenciaContexto: s.violenciaContexto, violenciaContextoOtro: otro(s.violenciaContextoOtro),
    violenciaAutoinfligida: s.violenciaAutoinfligida, violenciaAutoinfligidaOtro: otro(s.violenciaAutoinfligidaOtro),
    severidad: s.severidad,
    glasgowTotal: g,
    glasgowCategoria: glasgowCategoria(g),
    mapaCorporalSitios: s.mapaCorporalSitios,
    diagnosticoNaturaleza: otro(s.diagnosticoNaturaleza),
    sitioAnatomico: otro(s.sitioAnatomico),
    destino: s.destino,
  };
}

/** ¿El estado actual tiene ≥1 mecanismo de lesión? (paridad con servidor). */
export function tieneMecanismo(s: LceFormState): boolean {
  return (
    s.mecanismo.length > 0 ||
    s.mecExplosion.length > 0 ||
    s.mecFuego.length > 0 ||
    s.mecIntoxicacion.length > 0 ||
    s.mecMordedura.length > 0
  );
}

// ─── Sub-componentes ────────────────────────────────────────────────────────

function GrupoOpciones({
  legend,
  opciones,
  seleccion,
  onToggle,
  otroValor,
  onOtroChange,
  disabled,
  cols = 2,
}: {
  legend: string;
  opciones: readonly LceOpcion[];
  seleccion: string[];
  onToggle: (value: string) => void;
  otroValor?: string;
  onOtroChange?: (v: string) => void;
  disabled?: boolean;
  cols?: 1 | 2 | 3;
}) {
  const otroSel = opciones.some((o) => o.otro && seleccion.includes(o.value));
  const gridCls = cols === 1 ? "grid-cols-1" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">{legend}</legend>
      <div className={`grid grid-cols-1 gap-x-4 gap-y-1.5 ${gridCls}`}>
        {opciones.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={seleccion.includes(o.value)}
              onCheckedChange={() => onToggle(o.value)}
              disabled={disabled}
            />
            <span>
              <span className="text-xs text-muted-foreground">{o.num})</span> {o.value}
            </span>
          </label>
        ))}
      </div>
      {otroSel && onOtroChange && (
        <Textarea
          className="mt-2 min-h-[44px]"
          placeholder="Especifique…"
          value={otroValor ?? ""}
          onChange={(e) => onOtroChange(e.target.value)}
          disabled={disabled}
        />
      )}
    </fieldset>
  );
}

function MapaCorporal({
  sitios,
  onToggle,
  disabled,
}: {
  sitios: SitioCorporal[];
  onToggle: (s: SitioCorporal) => void;
  disabled?: boolean;
}) {
  const [vista, setVista] = React.useState<VistaCuerpo>("front");
  const selectedKeys = new Set(sitios.map((s) => s.key));

  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">
        Mapa corporal de lesiones
      </legend>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-col items-center">
          <div className="mb-2 inline-flex overflow-hidden rounded-md border border-input text-xs font-semibold">
            {(["front", "back"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                className={`px-3 py-1 transition-colors ${
                  vista === v ? "bg-primary text-primary-foreground" : "bg-surface-1 hover:bg-surface-2"
                }`}
              >
                {v === "front" ? "Anterior" : "Posterior"}
              </button>
            ))}
          </div>
          <svg viewBox={VIEWBOX} className="h-[340px] w-auto" role="img" aria-label="Mapa corporal">
            {REGIONES.map((r) => {
              const key = `${vista}:${r.id}`;
              const label = vista === "front" ? r.front : r.back;
              const sel = selectedKeys.has(key);
              return (
                <path
                  key={r.id}
                  d={regionPath(r)}
                  onClick={() => !disabled && onToggle({ key, label })}
                  className={disabled ? "" : "cursor-pointer"}
                  fill={sel ? "#dc2626" : "#e2e8f0"}
                  fillOpacity={sel ? 0.85 : 1}
                  stroke="#475569"
                  strokeWidth={1}
                >
                  <title>{label}</title>
                </path>
              );
            })}
          </svg>
        </div>
        <div className="flex-1">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            Sitios marcados ({sitios.length})
          </p>
          {sitios.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Toque las regiones del esquema para marcar las lesiones.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sitios.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => !disabled && onToggle(s)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs"
                >
                  {s.label}
                  {!disabled && <span aria-hidden className="text-muted-foreground">×</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </fieldset>
  );
}

// ─── Identificación (solo lectura, desde expediente) ────────────────────────

export interface LcePacienteInfo {
  nombre?: string | null;
  apellidos?: string | null;
  documento?: string | null;
  edad?: string | null;
  sexo?: string | null;
}

// ─── Formulario ─────────────────────────────────────────────────────────────

interface LesionCausaExternaFormProps {
  initial: LceDatos | null;
  readonly?: boolean;
  paciente?: LcePacienteInfo | null;
  medicoNombre?: string | null;
  saving?: boolean;
  onGuardarBorrador: (datos: LceDatos) => void;
  onFirmar: (datos: LceDatos) => void;
  onCancelar: () => void;
}

export function LesionCausaExternaForm({
  initial,
  readonly = false,
  paciente,
  medicoNombre,
  saving = false,
  onGuardarBorrador,
  onFirmar,
  onCancelar,
}: LesionCausaExternaFormProps) {
  const [s, setS] = React.useState<LceFormState>(() => datosToState(initial));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setS(datosToState(initial));
  }, [initial]);

  function setField<K extends keyof LceFormState>(k: K, v: LceFormState[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  function toggle(k: keyof LceFormState, value: string) {
    setS((prev) => {
      const arr = prev[k] as string[];
      const next = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
      return { ...prev, [k]: next };
    });
  }

  function toggleSitio(sitio: SitioCorporal) {
    setS((prev) => {
      const exists = prev.mapaCorporalSitios.some((x) => x.key === sitio.key);
      return {
        ...prev,
        mapaCorporalSitios: exists
          ? prev.mapaCorporalSitios.filter((x) => x.key !== sitio.key)
          : [...prev.mapaCorporalSitios, sitio],
      };
    });
  }

  const gTotal = s.glasgowTotal.trim() ? parseInt(s.glasgowTotal, 10) : null;
  const gCat = glasgowCategoria(gTotal);

  function handleGuardar() {
    setError(null);
    onGuardarBorrador(stateToDatos(s));
  }

  function handleFirmar() {
    if (!tieneMecanismo(s)) {
      setError("Debe registrar al menos un mecanismo de la lesión antes de firmar.");
      return;
    }
    setError(null);
    onFirmar(stateToDatos(s));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* I — Identificación (readonly) */}
      {paciente && (
        <fieldset className="rounded-md border border-border bg-surface-1 p-3">
          <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">
            I. Identificación
          </legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <Dato label="Nombre" value={`${paciente.nombre ?? ""} ${paciente.apellidos ?? ""}`.trim()} />
            <Dato label="Documento" value={paciente.documento} />
            <Dato label="Edad" value={paciente.edad} />
            <Dato label="Sexo" value={paciente.sexo} />
          </div>
        </fieldset>
      )}

      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {/* II — Datos generales */}
        <fieldset className="rounded-md border border-border p-3">
          <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">
            II. Datos generales del evento
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="lce-fecha" className="mb-1 block text-xs">Fecha y hora del evento</Label>
              <Input
                id="lce-fecha"
                type="datetime-local"
                value={s.eventoFechaHora}
                onChange={(e) => setField("eventoFechaHora", e.target.value)}
                disabled={readonly}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">¿Persona con discapacidad?</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                value={s.discapacidad}
                onChange={(e) => setField("discapacidad", e.target.value as LceFormState["discapacidad"])}
                disabled={readonly}
              >
                <option value="">No especificado</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
        </fieldset>

        <GrupoOpciones
          legend="Tipo de evento"
          opciones={TIPO_EVENTO}
          seleccion={s.tipoEvento}
          onToggle={(v) => toggle("tipoEvento", v)}
          otroValor={s.tipoEventoOtro}
          onOtroChange={(v) => setField("tipoEventoOtro", v)}
          disabled={readonly}
        />

        {/* Lugar de ocurrencia */}
        <fieldset className="rounded-md border border-border p-3">
          <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">
            Lugar de ocurrencia
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label className="mb-1 block text-xs">Departamento</Label>
              <Input value={s.lugarDepartamento} onChange={(e) => setField("lugarDepartamento", e.target.value)} disabled={readonly} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Municipio</Label>
              <Input value={s.lugarMunicipio} onChange={(e) => setField("lugarMunicipio", e.target.value)} disabled={readonly} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Dirección</Label>
              <Input value={s.lugarDireccion} onChange={(e) => setField("lugarDireccion", e.target.value)} disabled={readonly} />
            </div>
          </div>
        </fieldset>

        <GrupoOpciones
          legend="Mecanismo de la lesión"
          opciones={MECANISMO}
          seleccion={s.mecanismo}
          onToggle={(v) => toggle("mecanismo", v)}
          otroValor={s.mecanismoOtro}
          onOtroChange={(v) => setField("mecanismoOtro", v)}
          disabled={readonly}
        />
        <GrupoOpciones legend="Mecanismo — Explosión" opciones={MEC_EXPLOSION} seleccion={s.mecExplosion} onToggle={(v) => toggle("mecExplosion", v)} disabled={readonly} />
        <GrupoOpciones legend="Mecanismo — Fuego / quemadura" opciones={MEC_FUEGO} seleccion={s.mecFuego} onToggle={(v) => toggle("mecFuego", v)} disabled={readonly} cols={3} />
        <GrupoOpciones
          legend="Mecanismo — Intoxicación / envenenamiento"
          opciones={MEC_INTOXICACION}
          seleccion={s.mecIntoxicacion}
          onToggle={(v) => toggle("mecIntoxicacion", v)}
          otroValor={s.mecIntoxicacionOtro}
          onOtroChange={(v) => setField("mecIntoxicacionOtro", v)}
          disabled={readonly}
        />
        <GrupoOpciones
          legend="Mecanismo — Mordedura"
          opciones={MEC_MORDEDURA}
          seleccion={s.mecMordedura}
          onToggle={(v) => toggle("mecMordedura", v)}
          otroValor={s.mecMordeduraOtro}
          onOtroChange={(v) => setField("mecMordeduraOtro", v)}
          disabled={readonly}
        />
        <GrupoOpciones
          legend="Intencionalidad"
          opciones={INTENCIONALIDAD}
          seleccion={s.intencionalidad}
          onToggle={(v) => toggle("intencionalidad", v)}
          otroValor={s.intencionalidadOtro}
          onOtroChange={(v) => setField("intencionalidadOtro", v)}
          disabled={readonly}
        />
        <GrupoOpciones
          legend="Lugar / contexto"
          opciones={LUGAR}
          seleccion={s.lugar}
          onToggle={(v) => toggle("lugar", v)}
          otroValor={s.lugarOtro}
          onOtroChange={(v) => setField("lugarOtro", v)}
          disabled={readonly}
        />
        <GrupoOpciones
          legend="Actividad al momento del evento"
          opciones={ACTIVIDAD}
          seleccion={s.actividad}
          onToggle={(v) => toggle("actividad", v)}
          otroValor={s.actividadOtro}
          onOtroChange={(v) => setField("actividadOtro", v)}
          disabled={readonly}
        />

        <h3 className="border-b border-border pb-1 pt-2 text-sm font-bold text-muted-foreground">
          III. Datos específicos
        </h3>
        <GrupoOpciones
          legend="Medio de transporte de la víctima"
          opciones={TRANSPORTE_VICTIMA}
          seleccion={s.transporteVictima}
          onToggle={(v) => toggle("transporteVictima", v)}
          otroValor={s.transporteVictimaOtro}
          onOtroChange={(v) => setField("transporteVictimaOtro", v)}
          disabled={readonly}
        />
        <GrupoOpciones
          legend="Contraparte"
          opciones={CONTRAPARTE}
          seleccion={s.contraparte}
          onToggle={(v) => toggle("contraparte", v)}
          otroValor={s.contraparteOtro}
          onOtroChange={(v) => setField("contraparteOtro", v)}
          disabled={readonly}
        />
        <GrupoOpciones legend="Usuario de la vía" opciones={USUARIO_VIA} seleccion={s.usuarioVia} onToggle={(v) => toggle("usuarioVia", v)} disabled={readonly} />
        <GrupoOpciones
          legend="Tipo de accidente"
          opciones={TIPO_ACCIDENTE}
          seleccion={s.tipoAccidente}
          onToggle={(v) => toggle("tipoAccidente", v)}
          otroValor={s.tipoAccidenteOtro}
          onOtroChange={(v) => setField("tipoAccidenteOtro", v)}
          disabled={readonly}
        />
        <GrupoOpciones
          legend="Violencia — Relación con el agresor"
          opciones={VIOLENCIA_RELACION}
          seleccion={s.violenciaRelacion}
          onToggle={(v) => toggle("violenciaRelacion", v)}
          otroValor={s.violenciaRelacionOtro}
          onOtroChange={(v) => setField("violenciaRelacionOtro", v)}
          disabled={readonly}
        />
        <GrupoOpciones
          legend="Violencia — Contexto"
          opciones={VIOLENCIA_CONTEXTO}
          seleccion={s.violenciaContexto}
          onToggle={(v) => toggle("violenciaContexto", v)}
          otroValor={s.violenciaContextoOtro}
          onOtroChange={(v) => setField("violenciaContextoOtro", v)}
          disabled={readonly}
        />
        <GrupoOpciones
          legend="Violencia autoinfligida — Factores"
          opciones={VIOLENCIA_AUTOINFLIGIDA}
          seleccion={s.violenciaAutoinfligida}
          onToggle={(v) => toggle("violenciaAutoinfligida", v)}
          otroValor={s.violenciaAutoinfligidaOtro}
          onOtroChange={(v) => setField("violenciaAutoinfligidaOtro", v)}
          disabled={readonly}
        />

        <h3 className="border-b border-border pb-1 pt-2 text-sm font-bold text-muted-foreground">
          IV. Datos clínicos
        </h3>
        <GrupoOpciones legend="Severidad" opciones={SEVERIDAD} seleccion={s.severidad} onToggle={(v) => toggle("severidad", v)} disabled={readonly} cols={3} />

        {/* Glasgow */}
        <fieldset className="rounded-md border border-border p-3">
          <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">
            Escala de Glasgow
          </legend>
          <div className="flex items-center gap-3">
            <div className="w-32">
              <Label htmlFor="lce-gcs" className="mb-1 block text-xs">Puntaje total (3–15)</Label>
              <Input
                id="lce-gcs"
                type="number"
                min={3}
                max={15}
                inputMode="numeric"
                value={s.glasgowTotal}
                onChange={(e) => setField("glasgowTotal", e.target.value)}
                disabled={readonly}
              />
            </div>
            <div className="mt-5 flex min-h-[38px] flex-1 items-center rounded-md border border-border bg-surface-2 px-3 text-sm">
              {gCat ? (
                <span style={{ fontWeight: 700, color: gCat === "Leve" ? "#16a34a" : gCat === "Moderado" ? "#ea580c" : "#dc2626" }}>
                  {gCat}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Ingrese el puntaje para clasificar.</span>
              )}
            </div>
          </div>
        </fieldset>

        <MapaCorporal sitios={s.mapaCorporalSitios} onToggle={toggleSitio} disabled={readonly} />

        <fieldset className="rounded-md border border-border p-3">
          <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">
            Diagnóstico
          </legend>
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block text-xs">Naturaleza de la lesión</Label>
              <Textarea value={s.diagnosticoNaturaleza} onChange={(e) => setField("diagnosticoNaturaleza", e.target.value)} disabled={readonly} className="min-h-[44px]" />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Sitio anatómico (descripción)</Label>
              <Textarea value={s.sitioAnatomico} onChange={(e) => setField("sitioAnatomico", e.target.value)} disabled={readonly} className="min-h-[44px]" />
            </div>
          </div>
        </fieldset>

        <GrupoOpciones legend="Destino del paciente" opciones={DESTINO} seleccion={s.destino} onToggle={(v) => toggle("destino", v)} disabled={readonly} />

        {/* Firma */}
        <fieldset className="rounded-md border border-border bg-surface-1 p-3">
          <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">Responsable</legend>
          <p className="text-sm">
            <span className="text-muted-foreground">Médico: </span>
            {medicoNombre || "—"}
          </p>
        </fieldset>
      </div>

      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={saving}>
          Cerrar
        </Button>
        {!readonly && (
          <>
            <Button type="button" variant="secondary" onClick={handleGuardar} disabled={saving}>
              Guardar borrador
            </Button>
            <Button type="button" onClick={handleFirmar} disabled={saving || !tieneMecanismo(s)}>
              Firmar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Dato({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="block text-[11px] font-semibold text-muted-foreground">{label}</span>
      <span className="block">{value && value.trim() ? value : "—"}</span>
    </div>
  );
}
