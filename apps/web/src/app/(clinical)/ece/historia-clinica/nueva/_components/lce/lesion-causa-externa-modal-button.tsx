"use client";

/**
 * Botón + modal de Lesión de Causa Externa (REQ-ECE-LCE-001).
 *
 * Presenta el formulario LCE aislado (estilo iframe) sobre la historia clínica.
 * Carga el registro existente del episodio, persiste borradores y firma vía tRPC
 * (`eceLesionCausaExterna`). El formulario LCE vive en su propia tabla
 * epidemiológica; NO se embebe en el documento HC.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";
import {
  LesionCausaExternaForm,
  type LcePacienteInfo,
} from "./lesion-causa-externa-form";
import type { LceDatos } from "@his/contracts";

interface LesionCausaExternaModalButtonProps {
  episodioId: string;
  pacienteId?: string | null;
  paciente?: LcePacienteInfo | null;
  medicoNombre?: string | null;
  disabled?: boolean;
}

/** Reensambla la fila plana persistida (Date/null) al shape de `LceDatos`. */
function rowToDatos(r: unknown): LceDatos | null {
  if (!r || typeof r !== "object") return null;
  const row = r as Record<string, unknown>;
  const fecha = row.eventoFechaHora;
  return {
    ...row,
    eventoFechaHora: fecha ? new Date(fecha as string).toISOString() : undefined,
  } as unknown as LceDatos;
}

export function LesionCausaExternaModalButton({
  episodioId,
  pacienteId,
  paciente,
  medicoNombre,
  disabled,
}: LesionCausaExternaModalButtonProps) {
  const [open, setOpen] = React.useState(false);
  const utils = trpc.useUtils();

  const registroQ = trpc.eceLesionCausaExterna.getByEpisodio.useQuery(
    { episodioId },
    { enabled: open && !!episodioId },
  );
  const registro = registroQ.data ?? null;
  const firmado = (registro as { estadoRegistro?: string } | null)?.estadoRegistro === "firmado";

  const upsertM = trpc.eceLesionCausaExterna.upsert.useMutation();
  const firmarM = trpc.eceLesionCausaExterna.firmar.useMutation();

  async function handleGuardar(datos: LceDatos) {
    try {
      await upsertM.mutateAsync({ episodioId, pacienteId: pacienteId ?? undefined, datos });
      await utils.eceLesionCausaExterna.getByEpisodio.invalidate({ episodioId });
      setOpen(false);
    } catch {
      /* error expuesto vía upsertM.error */
    }
  }

  async function handleFirmar(datos: LceDatos) {
    try {
      const res = await upsertM.mutateAsync({ episodioId, pacienteId: pacienteId ?? undefined, datos });
      await firmarM.mutateAsync({ id: res.id });
      await utils.eceLesionCausaExterna.getByEpisodio.invalidate({ episodioId });
      setOpen(false);
    } catch {
      /* error expuesto vía upsertM.error / firmarM.error */
    }
  }

  const saving = upsertM.isPending || firmarM.isPending || registroQ.isLoading;
  const error = upsertM.error?.message ?? firmarM.error?.message ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-sm text-muted-foreground">
          {firmado
            ? "Formulario de lesión de causa externa firmado."
            : registro
              ? "Borrador de lesión de causa externa guardado."
              : "Formulario epidemiológico de lesión de causa externa (opcional)."}
        </span>
        <Button
          type="button"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={disabled || !episodioId}
          className="bg-success text-success-foreground hover:bg-success/90"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mr-1.5 h-4 w-4">
            <path d="M11 2v4M11 18v4M2 11h4M18 11h4M5.6 5.6l2.8 2.8M16.6 16.6l2.8 2.8M5.6 18.4l2.8-2.8M16.6 7.4l2.8-2.8" />
          </svg>
          {firmado ? "Ver lesión de causa externa" : registro ? "Editar lesión de causa externa" : "Lesión de causa externa"}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && !saving && setOpen(false)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Lesión de causa externa</DialogTitle>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>
          )}
          <LesionCausaExternaForm
            initial={rowToDatos(registro)}
            readonly={firmado}
            paciente={paciente}
            medicoNombre={medicoNombre}
            saving={saving}
            onGuardarBorrador={handleGuardar}
            onFirmar={handleFirmar}
            onCancelar={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
