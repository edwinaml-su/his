"use client";

/** CC-0026 Ola 2 — categoría "Interconsultas" (ESP-MOCKUP-0026 §inter). */
import * as React from "react";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";

const ESPECIALIDADES = [
  "Cardiología",
  "Neurología",
  "Cirugía General",
  "Ortopedia",
  "Nefrología",
  "Neumología",
  "Endocrinología",
  "Infectología",
  "Psiquiatría",
  "Ginecología",
  "Otra",
];
const PRIORIDADES = ["Rutina", "Urgente", "STAT"];

export interface ModalInterconsultaHandle {
  compose: () => { descripcion: string; detalle: Record<string, unknown> } | null;
}

export const ModalInterconsulta = React.forwardRef<
  ModalInterconsultaHandle,
  Record<never, never>
>(function ModalInterconsulta(_props, ref) {
  const [especialidad, setEspecialidad] = React.useState(ESPECIALIDADES[0]!);
  const [prioridad, setPrioridad] = React.useState(PRIORIDADES[0]!);
  const [motivo, setMotivo] = React.useState("");

  React.useImperativeHandle(ref, () => ({
    compose: () => {
      if (!motivo.trim()) return null;
      return {
        descripcion: `${especialidad} · ${prioridad} · ${motivo.trim()}`,
        detalle: { especialidad, prioridad, motivo: motivo.trim() },
      };
    },
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="inter-esp">Especialidad</Label>
          <Select value={especialidad} onValueChange={setEspecialidad}>
            <SelectTrigger id="inter-esp">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESPECIALIDADES.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="inter-prio">Prioridad</Label>
          <Select value={prioridad} onValueChange={setPrioridad}>
            <SelectTrigger id="inter-prio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORIDADES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="inter-motivo">
          Motivo de la interconsulta <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="inter-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Resumen del caso y pregunta clínica concreta…"
        />
      </div>
    </div>
  );
});
