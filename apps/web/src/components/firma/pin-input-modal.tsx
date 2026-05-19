"use client";

/**
 * PinInputModal — captura PIN y lo entrega al padre sin llamar a firma.confirm.
 *
 * Diferencia con PinConfirmModal: aquí no se invoca ningún endpoint de servidor.
 * El PIN capturado se pasa directamente al callback onSubmit; el padre decide
 * con qué mutation llamarlo (ej. aprobar/rechazar rectificaciones, NTEC Art. 42).
 *
 * Casos de uso: mutations que reciben el PIN inline como campo del input (HG-16).
 */

import * as React from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";

export interface PinInputModalProps {
  open: boolean;
  onClose: () => void;
  /** Descripción de la acción que se firma (ej. "aprobar rectificación"). */
  action: string;
  /** Recurso sobre el que aplica (ej. "Rectificación/abc123"). */
  resource?: string;
  /**
   * Llamado con el PIN capturado cuando el usuario confirma.
   * El padre es responsable de llamar al mutation y gestionar errores.
   */
  onSubmit: (pin: string) => void;
  /** Mensaje de error a mostrar (ej. respuesta UNAUTHORIZED del servidor). */
  errorMessage?: string;
  /** True mientras el padre procesa el mutation. */
  isPending?: boolean;
}

export function PinInputModal({
  open,
  onClose,
  action,
  resource,
  onSubmit,
  errorMessage,
  isPending = false,
}: PinInputModalProps) {
  const [pin, setPin] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Resetea el PIN al abrir/cerrar.
  React.useEffect(() => {
    if (!open) setPin("");
  }, [open]);

  // Focus automático al abrir.
  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const canSubmit = pin.length >= 6 && !isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(pin);
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
    setPin(digits);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return;
    if (!nextOpen) {
      const confirmed = window.confirm(
        "¿Cancelar esta acción? Los cambios no se guardarán.",
      );
      if (confirmed) onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          handleOpenChange(false);
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a3c6e]">
            <ShieldCheck aria-hidden className="h-5 w-5 text-[#1a3c6e]" />
            Confirmar con PIN
          </DialogTitle>
          <DialogDescription>
            Ingrese su PIN para{" "}
            <span className="font-medium text-foreground">{action}</span>
            {resource ? (
              <>
                {" "}— <span className="font-mono text-xs text-muted-foreground">{resource}</span>
              </>
            ) : null}
            .
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label
              htmlFor="pin-input-modal-field"
              className="text-sm font-medium leading-none"
            >
              PIN de firma
              <span aria-hidden className="ml-1 text-destructive">*</span>
            </label>
            <Input
              id="pin-input-modal-field"
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={handlePinChange}
              disabled={isPending}
              placeholder="••••••"
              aria-describedby={errorMessage ? "pin-input-modal-error" : undefined}
              aria-invalid={!!errorMessage}
              className="tracking-widest text-center text-lg"
            />
          </div>

          {errorMessage && (
            <div
              id="pin-input-modal-error"
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {errorMessage}
            </div>
          )}

          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <KeyRound aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span>La acción queda registrada en el historial de auditoría.</span>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-[#1a3c6e] hover:bg-[#15305a] text-white"
            >
              {isPending ? "Procesando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
