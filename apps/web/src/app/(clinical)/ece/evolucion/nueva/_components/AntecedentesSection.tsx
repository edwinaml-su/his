"use client";

/**
 * CC-0006 §10.3 — Antecedentes como sub-bloque de Objetivo.
 *
 * Tres estados: (1) colapsado (default), (2) resumen de solo lectura (chevron),
 * (3) edición (botón «Modificar Antecedentes» → confirmación §10.3.1 → editor).
 * NO entra en el gating de firma (píldora Opcional).
 *
 * Reutiliza AntecedenteSubseccion de la Historia Clínica CC-0007 (adecuar, no
 * duplicar). Los 5 antecedentes clínicos se editan y persisten en el snapshot de
 * esta evolución (draft.antecedentes → data.antecedentes). La identidad (nombre
 * de pila / LGBTIQ+) pertenece al registro de pacientes: se muestra de solo
 * lectura, no se edita aquí (su persistencia vive en ese módulo).
 */

import * as React from "react";
import type { AntecedentesEstructurados } from "@his/contracts";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";
import { SubBloque } from "./SubBloque";
import { ModificarAntecedentesModal } from "./modals/ModificarAntecedentesModal";
import {
  AntecedenteSubseccion,
  type SubseccionState,
} from "../../../historia-clinica/nueva/_components/antecedente-subseccion";
import { PILA_LILA, SELLO_VERDE } from "../_lib/avante-palette";

// ─── Config §10.3.2 ──────────────────────────────────────────────────────────

type SubKey = keyof AntecedentesEstructurados;
type SubContract = AntecedentesEstructurados[SubKey];

interface SubConfig {
  key: SubKey;
  titulo: string;
  estadoNegativo: "NINGUNO" | "NO_APLICA";
  labelNegativo: string;
}

const PATOLOGICOS: readonly SubConfig[] = [
  { key: "alergias", titulo: "Alergias", estadoNegativo: "NINGUNO", labelNegativo: "Ninguna" },
  { key: "personales", titulo: "Personales", estadoNegativo: "NINGUNO", labelNegativo: "Ninguno" },
  { key: "familiares", titulo: "Familiares", estadoNegativo: "NINGUNO", labelNegativo: "Ninguno" },
];

const NO_PATOLOGICOS: readonly SubConfig[] = [
  { key: "ocupacion", titulo: "Ocupación", estadoNegativo: "NO_APLICA", labelNegativo: "No aplica" },
  { key: "habitos", titulo: "Hábitos", estadoNegativo: "NO_APLICA", labelNegativo: "No aplica" },
];

const TODOS: readonly SubConfig[] = [...PATOLOGICOS, ...NO_PATOLOGICOS];

function subVacia(): SubContract {
  return { estado: "TIENE", items: [] };
}

/** Antecedentes en blanco cuando el paciente no tiene snapshot previo de HC. */
const ANTECEDENTES_DEFAULT: AntecedentesEstructurados = {
  alergias: subVacia(),
  personales: subVacia(),
  familiares: subVacia(),
  ocupacion: subVacia(),
  habitos: subVacia(),
};

// ─── Adaptadores contract ↔ SubseccionState ──────────────────────────────────

function toSubState(s: SubContract): SubseccionState {
  return { estado: s.estado, items: s.items ?? [], auditoria: s.auditoria ?? null };
}

function toContract(s: SubseccionState): SubContract {
  const base: SubContract = { estado: s.estado, items: s.items };
  return s.auditoria ? { ...base, auditoria: s.auditoria } : base;
}

// ─── Resumen (solo lectura) ──────────────────────────────────────────────────

const CHIP = "rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium uppercase";

function ResumenAntecedente({ cfg, sub }: { cfg: SubConfig; sub: SubContract }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-xs font-semibold text-foreground">{cfg.titulo}:</span>
      {sub.estado === "TIENE" ? (
        sub.items && sub.items.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {sub.items.map((it) => (
              <span key={it} className={CHIP}>
                {it}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )
      ) : (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold"
            style={{ color: SELLO_VERDE.text }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="h-3.5 w-3.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M8.5 12.5 11 15l4.5-5" />
            </svg>
            {cfg.labelNegativo}
          </span>
          {sub.auditoria && (
            <span className="text-[11px] text-muted-foreground">
              · registrado por <b className="font-semibold">{sub.auditoria.registradoPor}</b> el{" "}
              {sub.auditoria.registradoEn}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function IdentidadResumen({
  preferredName,
  esLgbtiq,
}: {
  preferredName: string | null;
  esLgbtiq: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-foreground">Nombre de pila:</span>
        {preferredName ? (
          <span
            className="rounded-md border px-2 py-0.5 text-xs font-semibold uppercase"
            style={{ color: PILA_LILA.text, backgroundColor: PILA_LILA.bg, borderColor: PILA_LILA.border }}
          >
            {preferredName}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-semibold text-foreground">Comunidad LGBTIQ+:</span>
        <span className="text-xs text-muted-foreground">{esLgbtiq ? "Sí" : "No"}</span>
      </div>
    </div>
  );
}

function GrupoLegend({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

// ─── Componente ──────────────────────────────────────────────────────────────

type Vista = "collapsed" | "summary" | "edit";

export function AntecedentesSection() {
  const { draft, dispatch, paciente } = useEvolucionDraft();
  const [vista, setVista] = React.useState<Vista>("collapsed");
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const ant = draft.antecedentes ?? ANTECEDENTES_DEFAULT;
  const usuarioActual = paciente?.usuarioActual?.nombre ?? "USUARIO ACTUAL";

  function actualizarSub(key: SubKey, next: SubseccionState) {
    const base = draft.antecedentes ?? ANTECEDENTES_DEFAULT;
    dispatch({
      type: "SET_ANTECEDENTES",
      antecedentes: { ...base, [key]: toContract(next) },
    });
  }

  // ── Encabezado (acción a la derecha del título teal) ──
  const accion =
    vista === "edit" ? (
      <button
        type="button"
        onClick={() => setVista("collapsed")}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        Contraer antecedentes
      </button>
    ) : (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
          Modificar Antecedentes
        </button>
        <button
          type="button"
          aria-label={vista === "summary" ? "Contraer antecedentes" : "Ver antecedentes"}
          aria-expanded={vista === "summary"}
          onClick={() => setVista((v) => (v === "summary" ? "collapsed" : "summary"))}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`h-4 w-4 transition-transform ${vista === "summary" ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
    );

  return (
    <SubBloque titulo="Antecedentes" pill="opcional" accion={accion}>
      {vista === "summary" && (
        <div className="space-y-4 rounded-md border border-border bg-muted/20 p-3">
          <div className="space-y-2">
            <GrupoLegend>Patológicos</GrupoLegend>
            {PATOLOGICOS.map((cfg) => (
              <ResumenAntecedente key={cfg.key} cfg={cfg} sub={ant[cfg.key]} />
            ))}
          </div>
          <div className="space-y-2">
            <GrupoLegend>No patológicos</GrupoLegend>
            {NO_PATOLOGICOS.map((cfg) => (
              <ResumenAntecedente key={cfg.key} cfg={cfg} sub={ant[cfg.key]} />
            ))}
          </div>
          <div className="space-y-2">
            <GrupoLegend>Identidad</GrupoLegend>
            <IdentidadResumen
              preferredName={paciente?.preferredName ?? null}
              esLgbtiq={paciente?.esLgbtiq ?? false}
            />
          </div>
        </div>
      )}

      {vista === "edit" && (
        <div className="space-y-5">
          <fieldset className="space-y-1 rounded-md border border-border p-3">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Patológicos
            </legend>
            {PATOLOGICOS.map((cfg) => (
              <AntecedenteSubseccion
                key={cfg.key}
                titulo={cfg.titulo}
                estadoNegativo={cfg.estadoNegativo}
                labelNegativo={cfg.labelNegativo}
                value={toSubState(ant[cfg.key])}
                onChange={(v) => actualizarSub(cfg.key, v)}
                usuarioActual={usuarioActual}
              />
            ))}
          </fieldset>
          <fieldset className="space-y-1 rounded-md border border-border p-3">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              No patológicos
            </legend>
            {NO_PATOLOGICOS.map((cfg) => (
              <AntecedenteSubseccion
                key={cfg.key}
                titulo={cfg.titulo}
                estadoNegativo={cfg.estadoNegativo}
                labelNegativo={cfg.labelNegativo}
                value={toSubState(ant[cfg.key])}
                onChange={(v) => actualizarSub(cfg.key, v)}
                usuarioActual={usuarioActual}
              />
            ))}
          </fieldset>
          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Identidad
            </legend>
            <IdentidadResumen
              preferredName={paciente?.preferredName ?? null}
              esLgbtiq={paciente?.esLgbtiq ?? false}
            />
            <p className="text-[11px] text-muted-foreground">
              La identidad del paciente se gestiona en el registro de pacientes.
            </p>
          </fieldset>
        </div>
      )}

      <ModificarAntecedentesModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          setVista("edit");
        }}
      />
    </SubBloque>
  );
}
