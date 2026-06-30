"use client";

/**
 * §10.1 — Signos vitales como sub-bloque de Objetivo (CC-0006 avante4).
 *
 * Título teal + píldora Obligatorio; muestra chips-resumen + alertas críticas.
 * La captura/edición vive en VitalesModal. El núcleo (TA, FC, FR, T°, SpO₂) es
 * obligatorio para firmar (ver puedeFirmar en _lib/types).
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";
import {
  computeAlertasVitales,
  glasgowTotal,
  glasgowSeveridad,
  imcFrom,
  imcClasificacion,
} from "../../../../../../lib/evolucion/signos-vitales";
import { tieneSignos } from "../_lib/types";
import { SubBloque } from "./SubBloque";

interface Props {
  onAbrir: () => void;
}

/** Parsea string de signo → number | null (vacío = sin valor). */
function num(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function SignosSection({ onAbrir }: Props) {
  const { draft } = useEvolucionDraft();
  const signos = draft.signos;
  const haySignos = tieneSignos(signos);

  const alertas = haySignos
    ? computeAlertasVitales({
        presionSistolica: num(signos.presionSistolica),
        presionDiastolica: num(signos.presionDiastolica),
        frecuenciaCardiaca: num(signos.frecuenciaCardiaca),
        frecuenciaRespiratoria: num(signos.frecuenciaRespiratoria),
        temperatura: num(signos.temperatura),
        saturacionO2: num(signos.saturacionO2),
        dolorEva: signos.escalaDolor,
        glucometriaMgdl: num(signos.glucometriaMgdl),
        glasgowOcular: num(signos.glasgowOcular),
        glasgowVerbal: num(signos.glasgowVerbal),
        glasgowMotora: num(signos.glasgowMotora),
        diuresisHoraria: num(signos.diuresisHoraria),
        pesoKg: num(signos.pesoKg),
      })
    : [];

  // Cálculos derivados para chips (R1.2/R1.3).
  const gTotal = glasgowTotal(
    num(signos.glasgowOcular),
    num(signos.glasgowVerbal),
    num(signos.glasgowMotora),
  );
  const pesoKgN = num(signos.pesoKg);
  const tallaMN = num(signos.tallaM);
  const imc = pesoKgN != null && tallaMN != null && tallaMN > 0 ? imcFrom(pesoKgN, tallaMN) : null;

  return (
    <SubBloque
      titulo="Signos vitales"
      pill="obligatorio"
      accion={
        haySignos ? (
          <Button type="button" variant="outline" size="sm" onClick={onAbrir}>
            Editar
          </Button>
        ) : null
      }
    >
      {haySignos ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {signos.presionSistolica && signos.presionDiastolica && (
              <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                TA {signos.presionSistolica}/{signos.presionDiastolica} mmHg
              </span>
            )}
            {signos.frecuenciaCardiaca && (
              <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                FC {signos.frecuenciaCardiaca} lpm
              </span>
            )}
            {signos.frecuenciaRespiratoria && (
              <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                FR {signos.frecuenciaRespiratoria} rpm
              </span>
            )}
            {signos.temperatura && (
              <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                T° {signos.temperatura} °C
              </span>
            )}
            {signos.saturacionO2 && (
              <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                SpO₂ {signos.saturacionO2}%
              </span>
            )}
            {signos.fio2 && (
              <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                FiO₂ {signos.fio2}%
              </span>
            )}
            {gTotal != null && (
              <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                Glasgow {gTotal}/15 · {glasgowSeveridad(gTotal)}
              </span>
            )}
            {signos.glucometriaMgdl && (
              <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                Gluc {signos.glucometriaMgdl} mg/dL
              </span>
            )}
            {imc != null && (
              <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                IMC {imc.toFixed(1)} · {imcClasificacion(imc).label}
              </span>
            )}
            {signos.escalaDolor > 0 && (
              <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                Dolor {signos.escalaDolor}/10
              </span>
            )}
          </div>
          {alertas.length > 0 && (
            <div className="flex flex-wrap gap-1" role="alert">
              {alertas.map((a) => (
                <Badge key={a} variant="destructive" className="text-xs">
                  {a}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">Sin registrar.</span>
          <Button
            type="button"
            size="sm"
            onClick={onAbrir}
            className="bg-rose-500 text-white hover:bg-rose-600"
          >
            Registrar signos vitales
          </Button>
        </div>
      )}
    </SubBloque>
  );
}
