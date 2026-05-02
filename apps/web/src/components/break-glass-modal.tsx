"use client";

/**
 * US-2.7 — BreakGlassModal.
 *
 * Dialog que captura justificación + acknowledgement de notificación al
 * jefe de servicio. Al confirmar, llama al Server Action `activateBreakGlass`.
 *
 * UX clave:
 *   - Aviso visible y rojo: "este acceso queda registrado e inmutable".
 *   - Textarea con counter min 20 chars; submit deshabilitado mientras no se cumpla.
 *   - Checkbox obligatorio "He notificado al jefe de servicio".
 *   - Estado loading durante el Server Action.
 *
 * Componentes Radix vienen del design system @his/ui (Dialog, Button).
 * Para checkbox/textarea nativos se usa HTML estándar con clases tailwind
 * porque el design system todavía no los expone (Sprint 1).
 */
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { activateBreakGlass } from "@/app/actions/break-glass";

// Espejo de las constantes en `packages/contracts/src/schemas/break-glass.ts`.
// Replicadas localmente porque la barrel del paquete contracts está congelada
// en Sprint 1.
const MIN_JUSTIFICATION_LEN = 20;
const MAX_JUSTIFICATION_LEN = 1000;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientLabel?: string;
  /** Callback opcional al activarse correctamente (para refetch / toast / redirect). */
  onActivated?: (info: { activatedAt: string; expiresAt: string }) => void;
}

export function BreakGlassModal({
  open,
  onOpenChange,
  patientId,
  patientLabel,
  onActivated,
}: Props) {
  const [justification, setJustification] = React.useState("");
  const [chiefNotifiedAck, setChiefNotifiedAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset al abrir/cerrar.
  React.useEffect(() => {
    if (!open) {
      setJustification("");
      setChiefNotifiedAck(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const len = justification.trim().length;
  const justOk = len >= MIN_JUSTIFICATION_LEN && len <= MAX_JUSTIFICATION_LEN;
  const canSubmit = justOk && chiefNotifiedAck && !busy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await activateBreakGlass({
        patientId,
        justification: justification.trim(),
        chiefNotifiedAck,
      });
      onActivated?.({ activatedAt: res.activatedAt, expiresAt: res.expiresAt });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle aria-hidden className="h-5 w-5" />
            Acceso de emergencia (Break-Glass)
          </DialogTitle>
          <DialogDescription>
            {patientLabel
              ? `Está a punto de abrir el expediente de ${patientLabel} sin permiso normal.`
              : "Está a punto de abrir el expediente de un paciente sin permiso normal."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <strong className="font-semibold">Atención:</strong> este acceso queda
            registrado e inmutable. Solo proceda si la situación lo requiere
            clínicamente. El jefe de servicio será notificado.
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="bg-justification"
              className="text-sm font-medium leading-none"
            >
              Justificación clínica
              <span aria-hidden className="ml-1 text-destructive">
                *
              </span>
            </label>
            <textarea
              id="bg-justification"
              required
              minLength={MIN_JUSTIFICATION_LEN}
              maxLength={MAX_JUSTIFICATION_LEN}
              rows={4}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Describa la emergencia y por qué requiere acceso ahora."
              className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              aria-describedby="bg-justification-help"
            />
            <p
              id="bg-justification-help"
              className={`text-xs ${justOk ? "text-muted-foreground" : "text-destructive"}`}
            >
              {len}/{MAX_JUSTIFICATION_LEN} — mínimo {MIN_JUSTIFICATION_LEN} caracteres.
            </p>
          </div>

          <div className="flex items-start gap-2">
            <input
              id="bg-chief-ack"
              type="checkbox"
              checked={chiefNotifiedAck}
              onChange={(e) => setChiefNotifiedAck(e.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
            <label htmlFor="bg-chief-ack" className="text-sm leading-snug">
              He notificado al jefe de servicio sobre este acceso de emergencia.
            </label>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={!canSubmit}>
              {busy ? "Activando…" : "Activar break-glass"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
