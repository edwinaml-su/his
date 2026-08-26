"use client";

/** CC-0026 Ola 2 — categoría "Procedimientos" (ESP-MOCKUP-0026 §proc). */
import * as React from "react";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Textarea } from "@his/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";

const PRIORIDADES = ["Programado", "Urgente", "STAT"];

export interface ModalProcedimientoHandle {
  compose: () => { descripcion: string; detalle: Record<string, unknown> } | null;
}

export const ModalProcedimiento = React.forwardRef<
  ModalProcedimientoHandle,
  Record<never, never>
>(function ModalProcedimiento(_props, ref) {
  const [procedimiento, setProcedimiento] = React.useState("");
  const [prioridad, setPrioridad] = React.useState(PRIORIDADES[0]!);
  const [consentimiento, setConsentimiento] = React.useState<"No" | "Sí">("No");
  const [obs, setObs] = React.useState("");

  React.useImperativeHandle(ref, () => ({
    compose: () => {
      if (!procedimiento.trim()) return null;
      const parts = [procedimiento.trim(), prioridad, `Consentimiento: ${consentimiento}`];
      if (obs.trim()) parts.push(`Obs: ${obs.trim()}`);
      return {
        descripcion: parts.join(" · "),
        detalle: {
          procedimiento: procedimiento.trim(),
          prioridad,
          requiereConsentimiento: consentimiento === "Sí",
          observaciones: obs.trim() || undefined,
        },
      };
    },
  }));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="proc-nombre">Procedimiento</Label>
        <Input
          id="proc-nombre"
          value={procedimiento}
          onChange={(e) => setProcedimiento(e.target.value)}
          placeholder="Buscar: colocación de sonda, sutura, drenaje, biopsia…"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="proc-prio">Prioridad</Label>
          <Select value={prioridad} onValueChange={setPrioridad}>
            <SelectTrigger id="proc-prio">
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
        <div className="space-y-1">
          <Label htmlFor="proc-cons">Requiere consentimiento</Label>
          <Select value={consentimiento} onValueChange={(v) => setConsentimiento(v as "No" | "Sí")}>
            <SelectTrigger id="proc-cons">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="No">No</SelectItem>
              <SelectItem value="Sí">Sí</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="proc-obs">Descripción / observaciones</Label>
        <Textarea
          id="proc-obs"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Sitio, técnica, insumos requeridos…"
        />
      </div>
    </div>
  );
});
