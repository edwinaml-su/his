"use client";

/**
 * US-2.7 — BreakGlassButton.
 *
 * Botón con icono AlertTriangle (Lucide) que abre el BreakGlassModal.
 * Solo se muestra cuando el usuario NO tiene permiso normal sobre el
 * paciente. La decisión la toma el llamador y se pasa vía prop
 * `hasNormalAccess` — así el componente queda agnóstico de cómo se
 * resuelve el permiso (RBAC del rol vs. encounter activo, etc.).
 *
 * Uso típico desde una page server-side:
 *   <BreakGlassButton
 *     patientId={p.id}
 *     patientLabel={p.fullName}
 *     hasNormalAccess={canRead}
 *   />
 */
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { BreakGlassModal } from "./break-glass-modal";

interface Props {
  patientId: string;
  patientLabel?: string;
  /** Si true (acceso normal), el botón NO se renderiza. */
  hasNormalAccess: boolean;
  className?: string;
  onActivated?: (info: { activatedAt: string; expiresAt: string }) => void;
}

export function BreakGlassButton({
  patientId,
  patientLabel,
  hasNormalAccess,
  className,
  onActivated,
}: Props) {
  const [open, setOpen] = React.useState(false);

  // Regla DoD: visible solo si NO tiene permiso normal.
  if (hasNormalAccess) return null;

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
        className={className}
        aria-label={`Activar acceso de emergencia para ${patientLabel ?? "paciente"}`}
      >
        <AlertTriangle aria-hidden className="h-4 w-4" />
        Break-Glass
      </Button>
      <BreakGlassModal
        open={open}
        onOpenChange={setOpen}
        patientId={patientId}
        patientLabel={patientLabel}
        onActivated={onActivated}
      />
    </>
  );
}
