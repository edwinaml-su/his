"use client";

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
import { useEvolucionDraft } from "../../_hooks/useEvolucionDraft";
import { SignosVitalesCapture } from "../SignosVitalesCapture";
import {
  signosNucleoCompletos,
  formulaObstetricaCompleta,
  type SignosState,
} from "../../_lib/types";
import {
  validarRango,
  esFemenino,
  type VitalRangeKey,
} from "../../../../../../../lib/evolucion/signos-vitales";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Campos de SignosState (string) con rango validable. Excluye `dolorEva`
 * (es `escalaDolor: number`, ya acotado 0–10 por el slider).
 */
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

export function VitalesModal({ open, onClose }: Props) {
  const { draft, dispatch, pacienteSexo, pacienteEdad } = useEvolucionDraft();
  const [buffer, setBuffer] = React.useState<SignosState>(draft.signos);
  const [showErrors, setShowErrors] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // R1: FiO₂ por defecto 21 % (aire ambiente) si aún no se ha capturado.
    setBuffer({
      ...draft.signos,
      fio2: draft.signos.fio2.trim() === "" ? "21" : draft.signos.fio2,
    });
    setShowErrors(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // R4.1 / §10.4: bloquea el guardado si falta el núcleo, la fórmula obstétrica
  // (obligatoria para pacientes femeninas) o hay un valor fuera de rango.
  const nucleoIncompleto = !signosNucleoCompletos(buffer);
  const ginecoIncompleto = esFemenino(pacienteSexo) && !formulaObstetricaCompleta(buffer);
  const hayFueraDeRango = RANGE_FIELDS.some(
    (f) => validarRango(f, buffer[f as keyof SignosState] as string) !== null,
  );
  const bloqueado = nucleoIncompleto || ginecoIncompleto || hayFueraDeRango;

  function handleGuardar() {
    if (bloqueado) {
      setShowErrors(true);
      return;
    }
    dispatch({ type: "SET_SIGNOS", signos: buffer });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Signos vitales</DialogTitle>
          <DialogDescription>
            Registre los signos tomados en esta evaluación. Los campos del núcleo
            (presión arterial y oxigenación) son obligatorios.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <SignosVitalesCapture
            idPrefix="vitales-modal"
            value={buffer}
            onChange={setBuffer}
            sexo={pacienteSexo}
            edad={pacienteEdad}
            showErrors={showErrors}
          />
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          {showErrors && bloqueado && (
            <p role="alert" className="mr-auto text-sm text-destructive">
              {nucleoIncompleto
                ? "Complete los signos vitales obligatorios."
                : ginecoIncompleto
                  ? "Complete la fórmula obstétrica (G · P · P · A · V)."
                  : "Corrija los valores fuera de rango."}
            </p>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleGuardar} aria-disabled={bloqueado}>
            Guardar signos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
