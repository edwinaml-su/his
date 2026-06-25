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
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { useEvolucionDraft } from "../../_hooks/useEvolucionDraft";
import { computeAlertasVitales } from "../../../../../../../lib/evolucion/signos-vitales";
import { tieneSignos } from "../../_lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Llamado cuando el usuario quiere modificar signos vitales desde aquí. */
  onModVitals: (objTmp: string) => void;
}

export function ObjetivoModal({ open, onClose, onModVitals }: Props) {
  const { draft, dispatch } = useEvolucionDraft();
  const [texto, setTexto] = React.useState("");
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) setTexto(draft.objetivo);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const signos = draft.signos;
  const haySignos = tieneSignos(signos);

  const alertas = computeAlertasVitales({
    presionSistolica: signos.presionSistolica !== "" ? Number(signos.presionSistolica) : null,
    presionDiastolica: signos.presionDiastolica !== "" ? Number(signos.presionDiastolica) : null,
    frecuenciaCardiaca: signos.frecuenciaCardiaca !== "" ? Number(signos.frecuenciaCardiaca) : null,
    frecuenciaRespiratoria: signos.frecuenciaRespiratoria !== "" ? Number(signos.frecuenciaRespiratoria) : null,
    temperatura: signos.temperatura !== "" ? Number(signos.temperatura) : null,
    saturacionO2: signos.saturacionO2 !== "" ? Number(signos.saturacionO2) : null,
    dolorEva: signos.escalaDolor,
  });

  function handleGuardar() {
    dispatch({ type: "SET_OBJETIVO", texto: texto.trim() });
    onClose();
  }

  function handleModVitals() {
    onModVitals(texto);
  }

  // Chips de vitales para mostrar resumen en el modal
  const chips: string[] = [];
  if (signos.presionSistolica && signos.presionDiastolica) {
    chips.push(`TA ${signos.presionSistolica}/${signos.presionDiastolica} mmHg`);
  }
  if (signos.frecuenciaCardiaca) chips.push(`FC ${signos.frecuenciaCardiaca} lpm`);
  if (signos.frecuenciaRespiratoria) chips.push(`FR ${signos.frecuenciaRespiratoria} rpm`);
  if (signos.temperatura) chips.push(`T° ${signos.temperatura} °C`);
  if (signos.saturacionO2) chips.push(`SpO₂ ${signos.saturacionO2}%`);
  if (signos.escalaDolor > 0) chips.push(`Dolor ${signos.escalaDolor}/10`);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Objetivo (O)</DialogTitle>
          <DialogDescription>
            Hallazgos al examen físico, resultados recientes.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-3">
          {/* Franja de signos vitales */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            {haySignos ? (
              <>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {chips.map((c) => (
                    <span
                      key={c}
                      className="text-xs font-medium bg-background border border-border rounded-md px-2 py-1"
                    >
                      {c}
                    </span>
                  ))}
                  {alertas.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 w-full">
                      {alertas.map((a) => (
                        <Badge key={a} variant="destructive" className="text-xs">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleModVitals}
                  className="shrink-0"
                >
                  Modificar signos vitales
                </Button>
              </>
            ) : (
              <>
                <span className="text-sm text-muted-foreground flex-1">
                  Signos vitales sin registrar.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleModVitals}
                  className="shrink-0"
                >
                  Registrar signos vitales
                </Button>
              </>
            )}
          </div>

          {/* Textarea objetivo */}
          <div className="space-y-1.5">
            <Label htmlFor="modal-objetivo-texto">Objetivo</Label>
            <textarea
              id="modal-objetivo-texto"
              ref={taRef}
              rows={7}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Redactar objetivo…"
              className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleGuardar}>
            Guardar objetivo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
