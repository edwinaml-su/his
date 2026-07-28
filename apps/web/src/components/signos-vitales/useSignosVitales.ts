"use client";

/**
 * Hook de estado + validación + guardado — módulo transversal de Signos
 * Vitales (CC-0012, mockup avante7).
 *
 * Encapsula: estado controlado (`VitalesFormState`), gating de guardado
 * (núcleo de 7 campos + fórmula obstétrica si femenina + rangos), y el mapeo
 * COMPLETO a `trpc.eceSignosVitales.create` (incluye G·P·P·A·V, pesoLb,
 * tallaFt, fppActivo — los campos que `historia-clinica/nueva` descartaba
 * antes de CC-0012).
 */

import * as React from "react";
import { trpc } from "@/lib/trpc/react";
import {
  esFemenino,
  fppNaegele,
  puedeEmbarazo,
  validarRango,
  type VitalRangeKey,
} from "@his/contracts/validators";
import {
  VITALES_FORM_EMPTY,
  formulaObstetricaCompleta,
  signosNucleoCompletos,
  type VitalesFormState,
} from "./types";

/** Campos de VitalesFormState (string) con rango validable. Excluye `escalaDolor`
 *  (number, ya acotado 0–10 por el slider) y `fechaUltimaRegla`/`fppActivo`. */
const RANGE_FIELDS: readonly VitalRangeKey[] = [
  "presionSistolica",
  "presionDiastolica",
  "frecuenciaCardiaca",
  "frecuenciaRespiratoria",
  "temperatura",
  "saturacionO2",
  "fio2",
  "glucometriaMgdl",
  "pesoKg",
  "pesoLb",
  "tallaM",
  "tallaFt",
  "perimetroCintura",
  "balanceHidrico",
  "diuresisHoraria",
];

function parseOpt(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function dateOnlyISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface UseSignosVitalesOptions {
  /** Sexo biológico del paciente ('F' habilita gineco-obstétrico). */
  sexo?: string | null;
  /** Edad en años (habilita el interruptor FPP si además está en edad fértil). */
  edad?: number | null;
  /** Callback al guardar exitosamente (p.ej. cerrar modal, refrescar lista). */
  onSaved?: (resultado: { id: string; episodioId: string | null; cuentaId: string | null }) => void;
}

export interface GuardarArgs {
  /** Al menos uno de episodioId/cuentaId es requerido (contrato eceSignosVitalesCreateSchema). */
  episodioId?: string;
  cuentaId?: string;
}

export function useSignosVitales({ sexo = null, edad = null, onSaved }: UseSignosVitalesOptions = {}) {
  const [value, setValue] = React.useState<VitalesFormState>(VITALES_FORM_EMPTY);
  const [showErrors, setShowErrors] = React.useState(false);

  const createM = trpc.eceSignosVitales.create.useMutation();

  const nucleoIncompleto = !signosNucleoCompletos(value);
  const ginecoIncompleto = esFemenino(sexo) && !formulaObstetricaCompleta(value);
  const hayFueraDeRango = RANGE_FIELDS.some(
    (f) => validarRango(f, value[f as keyof VitalesFormState] as string) !== null,
  );
  const bloqueado = nucleoIncompleto || ginecoIncompleto || hayFueraDeRango;

  const mensajeError = nucleoIncompleto
    ? "Complete los signos vitales obligatorios (presión arterial y cardiorrespiratorios)."
    : ginecoIncompleto
      ? "Complete la fórmula obstétrica (G · P · P · A · V, obligatoria para paciente femenina)."
      : hayFueraDeRango
        ? "Corrija los valores fuera de rango."
        : null;

  function reset() {
    setValue(VITALES_FORM_EMPTY);
    setShowErrors(false);
  }

  /** Mapea VitalesFormState → payload completo de eceSignosVitales.create. */
  function buildPayload(args: GuardarArgs) {
    const tallaMNum = parseOpt(value.tallaM);
    const fppActivoAplica = puedeEmbarazo(sexo, edad) && value.fppActivo;
    const fppCalculada =
      fppActivoAplica && value.fechaUltimaRegla ? fppNaegele(value.fechaUltimaRegla) : null;

    return {
      episodioId: args.episodioId,
      cuentaId: args.cuentaId,
      presionSistolica: parseOpt(value.presionSistolica),
      presionDiastolica: parseOpt(value.presionDiastolica),
      frecuenciaCardiaca: parseOpt(value.frecuenciaCardiaca),
      frecuenciaRespiratoria: parseOpt(value.frecuenciaRespiratoria),
      temperatura: parseOpt(value.temperatura),
      saturacionO2: parseOpt(value.saturacionO2),
      fio2: parseOpt(value.fio2),
      glasgowOcular: parseOpt(value.glasgowOcular),
      glasgowVerbal: parseOpt(value.glasgowVerbal),
      glasgowMotor: parseOpt(value.glasgowMotora),
      glucometriaMgdl: parseOpt(value.glucometriaMgdl),
      pesoKg: parseOpt(value.pesoKg),
      pesoLb: parseOpt(value.pesoLb),
      tallaCm: tallaMNum != null ? Math.round(tallaMNum * 100 * 100) / 100 : undefined,
      tallaFt: parseOpt(value.tallaFt),
      perimetroCintura: parseOpt(value.perimetroCintura),
      balanceHidrico: parseOpt(value.balanceHidrico),
      diuresis: parseOpt(value.diuresisHoraria),
      fur: value.fechaUltimaRegla || undefined,
      fpp: fppCalculada ? dateOnlyISO(fppCalculada) : undefined,
      fppActivo: puedeEmbarazo(sexo, edad) ? value.fppActivo : undefined,
      goGestas: parseOpt(value.gestaG),
      goPartosTermino: parseOpt(value.partoTermino),
      goPartosPretermino: parseOpt(value.partoPretermino),
      goAbortos: parseOpt(value.abortos),
      goVivos: parseOpt(value.vivos),
      escalaDolor: value.escalaDolor,
    };
  }

  /**
   * Solo valida (núcleo + gineco-obstétrico + rangos), sin llamar a tRPC.
   * Para consumidores que difieren la persistencia real (p.ej. HC: el modal
   * hace commit local del draft; la mutación corre al guardar el documento).
   * Devuelve `true` si pasó la validación (showErrors queda en false).
   */
  function validar(): boolean {
    if (bloqueado) {
      setShowErrors(true);
      return false;
    }
    return true;
  }

  /**
   * Valida y guarda. Devuelve el resultado del create, o `null` si la
   * validación bloqueó el guardado (showErrors queda en true).
   */
  async function guardar(args: GuardarArgs) {
    if (bloqueado) {
      setShowErrors(true);
      return null;
    }
    const payload = buildPayload(args);
    const resultado = await createM.mutateAsync(payload);
    onSaved?.(resultado);
    return resultado;
  }

  return {
    value,
    setValue,
    showErrors,
    setShowErrors,
    bloqueado,
    mensajeError,
    validar,
    guardar,
    guardando: createM.isPending,
    reset,
  };
}
