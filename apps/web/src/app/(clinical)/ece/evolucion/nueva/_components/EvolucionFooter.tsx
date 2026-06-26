"use client";

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";
import { camposFaltantes } from "../_lib/types";

interface Props {
  onCancelar: () => void;
  onFirmar: () => void;
  isSigning: boolean;
}

export function EvolucionFooter({ onCancelar, onFirmar, isSigning }: Props) {
  const { canSign, status, episodeId, draft, savedAt } = useEvolucionDraft();
  const faltantes = camposFaltantes(draft);

  const statusText: string = (() => {
    if (!episodeId) return "Sin episodio: no se puede autoguardar";
    if (status === "idle") return "";
    if (status === "guardando") return "Guardando…";
    if (status === "guardado") {
      // R4.4: marca de tiempo del último guardado (guard si el hook no la provee).
      const hora = savedAt
        ? savedAt.toLocaleTimeString("es-SV", { hour: "2-digit", minute: "2-digit" })
        : null;
      return hora ? `Guardado ${hora}` : "Guardado";
    }
    if (typeof status === "object") return `Error: ${status.error}`;
    return "";
  })();

  const statusClass =
    typeof status === "object"
      ? "text-destructive"
      : status === "guardando"
        ? "text-muted-foreground"
        : !episodeId
          ? "text-amber-600 dark:text-amber-400"
          : "text-green-700 dark:text-green-400";

  const firmarTooltip = canSign
    ? undefined
    : `Faltan campos obligatorios: ${faltantes.join(", ")}`;

  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t bg-background px-6 py-3 shadow-[0_-4px_20px_rgba(15,23,42,.05)]">
      <Button type="button" variant="ghost" onClick={onCancelar} disabled={isSigning}>
        Cancelar
      </Button>

      <div className="flex-1" />

      {statusText && (
        <p
          className={`text-xs font-medium ${statusClass}`}
          aria-live="polite"
          aria-atomic="true"
          data-testid="autosave-status"
        >
          {statusText}
        </p>
      )}

      {!canSign && faltantes.length > 0 && (
        <p
          className="text-xs font-medium text-amber-600 dark:text-amber-400"
          data-testid="firmar-faltantes"
        >
          Faltan: {faltantes.join(", ")}
        </p>
      )}

      <Button
        type="button"
        onClick={onFirmar}
        disabled={!canSign || isSigning}
        title={firmarTooltip}
        data-testid="btn-firmar"
      >
        {isSigning ? "Firmando…" : "Firmar"}
      </Button>
    </div>
  );
}
