"use client";

/**
 * CC-0026 Ola 2 — barra de tipo de indicación + firma (ESP-MOCKUP-0026
 * §Estructura). `Inicial` solo disponible hasta la primera firma del
 * episodio; `Subsecuente` con subtipos `Indicación diaria | Indicación
 * rápida`. El chip countdown de 32h es INFORMATIVO — el server (`firmar()`,
 * SQL 210) es quien rechaza la mutación si se incumple el plazo o el tipo;
 * este control de cliente nunca es la barrera real (regla literal del
 * mockup, ver comentario en el router).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { cn } from "@his/ui/lib/utils";

export type TipoFirma = "INICIAL" | "SUBSECUENTE";
export type SubtipoFirma = "Indicación diaria" | "Indicación rápida";

const MAX_HORAS_SUBSECUENTE = 32;

function fmtFecha(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function IndicacionBar({
  hasPrevious,
  ultimaFirmaMs,
  tipo,
  onChangeTipo,
  subtipo,
  onChangeSubtipo,
  totalRenglones,
  disabled,
  pending,
  onFirmar,
}: {
  hasPrevious: boolean;
  ultimaFirmaMs: number | null;
  tipo: TipoFirma;
  onChangeTipo: (t: TipoFirma) => void;
  subtipo: SubtipoFirma;
  onChangeSubtipo: (s: SubtipoFirma) => void;
  totalRenglones: number;
  disabled: boolean;
  pending: boolean;
  onFirmar: () => void;
}) {
  const [, forceTick] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(forceTick, 30_000);
    return () => clearInterval(id);
  }, []);

  const deadline = ultimaFirmaMs ? ultimaFirmaMs + MAX_HORAS_SUBSECUENTE * 3600 * 1000 : null;
  const diff = deadline ? deadline - Date.now() : null;
  const vencida = diff !== null && diff <= 0;
  const proximaAVencer = diff !== null && diff > 0 && diff < 6 * 3600 * 1000;

  const chipLabel = !deadline
    ? `Subsecuente: requerida como máximo ${MAX_HORAS_SUBSECUENTE} h después de cada indicación`
    : vencida
      ? `⚠ SUBSECUENTE VENCIDA — debió indicarse antes de ${fmtFecha(deadline)} (máx. ${MAX_HORAS_SUBSECUENTE} h)`
      : `Próxima subsecuente antes de ${fmtFecha(deadline)} — quedan ${Math.floor(diff! / 3600000)} h ${Math.floor((diff! % 3600000) / 60000)} m`;

  const chipClass = !deadline
    ? "bg-indigo-50 text-indigo-800 border-indigo-200"
    : vencida
      ? "bg-red-50 text-red-800 border-red-200"
      : proximaAVencer
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-emerald-50 text-emerald-800 border-emerald-200";

  const firmarLabel = tipo === "INICIAL" ? "indicación inicial" : "indicación rápida";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <span
        className="cursor-help font-semibold"
        title="Regla de backend: el tipo de indicación y el plazo máximo de 32h entre indicaciones firmadas se validan en el servidor (fecha_firma en BD, SQL 210). La interfaz solo informa y guía."
      >
        Tipo de indicación
      </span>
      <Select value={tipo} onValueChange={(v) => onChangeTipo(v as TipoFirma)}>
        <SelectTrigger className="h-9 w-auto min-w-[9rem]" aria-label="Tipo de indicación">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!hasPrevious ? <SelectItem value="INICIAL">Inicial</SelectItem> : null}
          <SelectItem value="SUBSECUENTE">Subsecuente</SelectItem>
        </SelectContent>
      </Select>

      {tipo === "SUBSECUENTE" ? (
        <Select value={subtipo} onValueChange={(v) => onChangeSubtipo(v as SubtipoFirma)}>
          <SelectTrigger className="h-9 w-auto min-w-[10rem]" aria-label="Subtipo de indicación subsecuente">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Indicación diaria">Indicación diaria</SelectItem>
            <SelectItem value="Indicación rápida">Indicación rápida</SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      <span
        role="status"
        className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", chipClass)}
      >
        {chipLabel}
      </span>

      <Button className="ml-auto" disabled={disabled || pending} onClick={onFirmar} data-testid="btn-firmar-indicacion">
        {pending
          ? "Firmando…"
          : tipo === "SUBSECUENTE" && subtipo === "Indicación diaria"
            ? "✍ Firmar indicación diaria"
            : `✍ Firmar ${firmarLabel} (${totalRenglones} renglones)`}
      </Button>
    </div>
  );
}
