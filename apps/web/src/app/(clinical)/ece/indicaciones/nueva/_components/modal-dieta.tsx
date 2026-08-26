"use client";

/** CC-0026 Ola 2 — categoría "Dieta" (ESP-MOCKUP-0026 §dieta). */
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

const TIPOS_DIETA = [
  "Normal",
  "Blanda",
  "Líquida",
  "Hiposódica",
  "Hipoglúcida (diabético)",
  "Hipograsa",
  "Hiperproteica",
  "NPO (nada por vía oral)",
  "Enteral por SNG",
  "Parenteral",
];
const VIAS_DIETA = ["Oral", "Sonda nasogástrica", "Gastrostomía", "Parenteral"];

export interface ModalDietaHandle {
  compose: () => { descripcion: string; detalle: Record<string, unknown> } | null;
}

export const ModalDieta = React.forwardRef<ModalDietaHandle, Record<never, never>>(
  function ModalDieta(_props, ref) {
    const [tipo, setTipo] = React.useState(TIPOS_DIETA[0]!);
    const [via, setVia] = React.useState(VIAS_DIETA[0]!);
    const [consistencia, setConsistencia] = React.useState("");
    const [restricciones, setRestricciones] = React.useState("");
    const [obs, setObs] = React.useState("");

    React.useImperativeHandle(ref, () => ({
      compose: () => {
        const parts = [tipo, via];
        if (consistencia.trim()) parts.push(consistencia.trim());
        if (restricciones.trim()) parts.push(restricciones.trim());
        if (obs.trim()) parts.push(`Obs: ${obs.trim()}`);
        return {
          descripcion: parts.join(" · "),
          detalle: {
            tipo,
            via,
            consistenciaFrecuencia: consistencia.trim() || undefined,
            restricciones: restricciones.trim() || undefined,
            observaciones: obs.trim() || undefined,
          },
        };
      },
    }));

    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="dieta-tipo">Tipo de dieta</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger id="dieta-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DIETA.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="dieta-via">Vía</Label>
            <Select value={via} onValueChange={setVia}>
              <SelectTrigger id="dieta-via">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIAS_DIETA.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="dieta-consist">Consistencia / frecuencia</Label>
            <Input
              id="dieta-consist"
              value={consistencia}
              onChange={(e) => setConsistencia(e.target.value)}
              placeholder="Ej. fraccionada c/3h, 5 tiempos…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dieta-restr">Restricciones</Label>
            <Input
              id="dieta-restr"
              value={restricciones}
              onChange={(e) => setRestricciones(e.target.value)}
              placeholder="Ej. sin sal, sin azúcar, sin lácteos…"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="dieta-obs">Observaciones</Label>
          <Textarea
            id="dieta-obs"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Indicaciones adicionales para nutrición…"
          />
        </div>
      </div>
    );
  },
);
