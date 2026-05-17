"use client";

/**
 * PinConfirmModal — firma electrónica de acciones clínicas.
 *
 * Responsabilidad: capturar PIN numérico del usuario, llamar a
 * `trpc.firma.confirm` y notificar al padre con el `firmaId` resultante.
 *
 * Políticas de seguridad gestionadas aquí (en colaboración con el servidor):
 *   - Lockout: muestra intentos restantes y bloqueo temporal.
 *   - Cache 15 min: si el servidor responde `cached: true`, cierra inmediato
 *     sin requerir interacción adicional.
 *   - ESC: pide confirmación antes de cerrar (para evitar cierres accidentales
 *     en el medio de una acción clínica).
 *
 * A11y: focus trap + ARIA manejados por Radix Dialog.
 * El input PIN recibe focus automático al abrir el modal.
 */

import * as React from "react";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";
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
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface PinConfirmModalProps {
  open: boolean;
  onClose: () => void;
  /** Recurso sobre el que aplica la firma (ej. "Prescription/abc123"). */
  resource: string;
  /** Acción que se está firmando (ej. "dispensar", "transferir"). */
  action: string;
  /** Llamado al obtener firmaId exitoso. */
  onConfirmed: (firmaId: string) => void;
}

// Forma del error TRPC extendido que el router firma.confirm puede emitir.
// El servidor codifica datos de lockout en el campo `data` del TRPCError.
interface FirmaErrorData {
  attemptsRemaining?: number;
  lockedUntil?: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Estado UI
// ---------------------------------------------------------------------------

type UiState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string; attemptsRemaining?: number }
  | { kind: "locked"; lockedUntil: Date };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLockoutMessage(until: Date): string {
  const diffMs = until.getTime() - Date.now();
  if (diffMs <= 0) return "Cuenta bloqueada temporalmente. Intente de nuevo.";
  const mins = Math.ceil(diffMs / 60_000);
  return `Cuenta bloqueada por ${mins} min. Intente nuevamente más tarde.`;
}

function parseFirmaError(err: unknown): {
  message: string;
  attemptsRemaining?: number;
  lockedUntil?: Date;
} {
  // TRPCClientError expone `.data` con el shape que el router serializa.
  const data = (err as { data?: FirmaErrorData })?.data;
  const message =
    (err as { message?: string })?.message ?? "Error al verificar firma.";

  if (data?.lockedUntil) {
    return { message, lockedUntil: new Date(data.lockedUntil) };
  }
  return { message, attemptsRemaining: data?.attemptsRemaining };
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function PinConfirmModal({
  open,
  onClose,
  resource,
  action,
  onConfirmed,
}: PinConfirmModalProps) {
  const [pin, setPin] = React.useState("");
  const [uiState, setUiState] = React.useState<UiState>({ kind: "idle" });
  const pinInputRef = React.useRef<HTMLInputElement>(null);

  // Cuenta regresiva de lockout para re-habilitar el form automáticamente.
  const [lockoutTick, setLockoutTick] = React.useState(0);

  // Resetea todo al abrir/cerrar.
  React.useEffect(() => {
    if (!open) {
      setPin("");
      setUiState({ kind: "idle" });
    }
  }, [open]);

  // Focus automático en el input al abrir.
  React.useEffect(() => {
    if (!open) return;
    // Pequeño delay para que la animación de Radix no interfiera.
    const t = setTimeout(() => pinInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Refresca la UI cada segundo mientras haya lockout activo.
  React.useEffect(() => {
    if (uiState.kind !== "locked") return;
    const interval = setInterval(() => {
      const remaining = uiState.lockedUntil.getTime() - Date.now();
      if (remaining <= 0) {
        setUiState({ kind: "idle" });
      } else {
        setLockoutTick((n) => n + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [uiState, lockoutTick]);

  // Llamada al router. El router firma.confirm aún está pendiente de
  // implementación — tipamos contra AppRouter vía trpc.firma.confirm.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const confirmMutation = (trpc as any).firma?.confirm?.useMutation({
    onSuccess(data: { firmaId: string; cached: boolean }) {
      if (data.cached) {
        // La firma estaba en cache — cierra sin mostrar feedback extra.
        onConfirmed(data.firmaId);
        onClose();
        return;
      }
      onConfirmed(data.firmaId);
      onClose();
    },
    onError(err: unknown) {
      const parsed = parseFirmaError(err);
      if (parsed.lockedUntil) {
        setUiState({ kind: "locked", lockedUntil: parsed.lockedUntil });
      } else {
        setUiState({
          kind: "error",
          message: parsed.message,
          attemptsRemaining: parsed.attemptsRemaining,
        });
      }
      setPin("");
      pinInputRef.current?.focus();
    },
  });

  const isLocked = uiState.kind === "locked";
  const isSubmitting =
    uiState.kind === "submitting" || confirmMutation?.isPending === true;
  const canSubmit = pin.length >= 6 && !isSubmitting && !isLocked;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setUiState({ kind: "submitting" });
    confirmMutation?.mutate({
      pin,
      contextResource: resource,
      contextAction: action,
    });
  };

  // ESC / overlay click: pide confirmación antes de cerrar.
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSubmitting) return; // no cierres mientras procesa
    if (!nextOpen) {
      const confirmed = window.confirm(
        "¿Cancelar la firma de esta acción? Los cambios no se guardarán.",
      );
      if (confirmed) onClose();
    }
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Solo dígitos, máximo 12 caracteres (política PIN_MAX en contracts).
    const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
    setPin(digits);
    // Limpia el error de intento previo al empezar a escribir de nuevo.
    if (uiState.kind === "error") setUiState({ kind: "idle" });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        // Evita que el click en overlay cierre sin confirmación;
        // onOpenChange ya lo maneja.
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          handleOpenChange(false);
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a3c6e]">
            <ShieldCheck aria-hidden className="h-5 w-5 text-[#1a3c6e]" />
            Firma electrónica
          </DialogTitle>
          <DialogDescription>
            Confirme su identidad para{" "}
            <span className="font-medium text-foreground">{action}</span>
            {resource ? (
              <>
                {" "}
                en{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {resource}
                </span>
              </>
            ) : null}
            .
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* PIN input */}
          <div className="space-y-1.5">
            <label
              htmlFor="firma-pin"
              className="text-sm font-medium leading-none"
            >
              PIN de firma
              <span aria-hidden className="ml-1 text-destructive">
                *
              </span>
            </label>
            <Input
              id="firma-pin"
              ref={pinInputRef}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={handlePinChange}
              disabled={isSubmitting || isLocked}
              placeholder="••••••"
              aria-describedby={
                uiState.kind === "error" || isLocked
                  ? "firma-pin-feedback"
                  : undefined
              }
              aria-invalid={uiState.kind === "error" || isLocked}
              className="tracking-widest text-center text-lg"
            />
          </div>

          {/* Feedback de error / lockout */}
          {uiState.kind === "error" && (
            <div
              id="firma-pin-feedback"
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <p className="font-medium">{uiState.message}</p>
              {uiState.attemptsRemaining !== undefined && (
                <p className="mt-0.5 text-xs">
                  Intentos restantes:{" "}
                  <span className="font-semibold">{uiState.attemptsRemaining}</span>
                </p>
              )}
            </div>
          )}

          {isLocked && uiState.kind === "locked" && (
            <div
              id="firma-pin-feedback"
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{formatLockoutMessage(uiState.lockedUntil)}</p>
            </div>
          )}

          {/* Indicador visual de contexto de acción */}
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <KeyRound aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span>
              La firma queda registrada en el historial de auditoría y es
              irrevocable.
            </span>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-[#1a3c6e] hover:bg-[#15305a] text-white"
            >
              {isSubmitting ? "Verificando…" : "Firmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
