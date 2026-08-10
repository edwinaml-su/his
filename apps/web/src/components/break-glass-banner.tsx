"use client";

/**
 * CC-0017 F3 — Banner persistente "break-glass ACTIVO".
 *
 * Se renderiza en el shell autenticado (AppShell) mientras la cookie
 * `his.break_glass` sea válida y no haya expirado (resuelta server-side en
 * `getTenantContext()` → `tenant.breakGlassSession`). El operador SIEMPRE
 * debe saber que está en modo emergencia — patrón visual análogo a
 * `AllergyAlert` (@his/ui) pero a nivel de sesión, no de paciente.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { clearBreakGlass } from "@/app/actions/break-glass";

export interface BreakGlassBannerSession {
  patientId: string;
  justification: string;
  expiresAt: string;
}

interface Props {
  session: BreakGlassBannerSession | null;
}

/** Formatea el tiempo restante hasta `expiresAt` como "Xm Ys". */
function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "vencido";
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function BreakGlassBanner({ session }: Props) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [remaining, setRemaining] = React.useState(() =>
    session ? formatRemaining(session.expiresAt) : "",
  );

  React.useEffect(() => {
    if (!session) return;
    setRemaining(formatRemaining(session.expiresAt));
    const id = setInterval(() => setRemaining(formatRemaining(session.expiresAt)), 1000);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;

  const handleDeactivate = async () => {
    setBusy(true);
    try {
      await clearBreakGlass();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="alert"
      data-testid="break-glass-banner"
      className="flex flex-wrap items-center gap-2 border-b-2 border-destructive bg-destructive px-3 py-2 text-sm text-destructive-foreground sm:px-4"
    >
      <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
      <span className="font-bold uppercase tracking-wide">Break-glass activo</span>
      <span className="min-w-0 flex-1 truncate">— {session.justification}</span>
      <span className="shrink-0 font-mono text-xs" aria-label="Tiempo restante">
        Vence en {remaining}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0 border-destructive-foreground/40 bg-transparent text-destructive-foreground hover:bg-destructive-foreground/10"
        onClick={handleDeactivate}
        disabled={busy}
      >
        {busy ? "Desactivando…" : "Desactivar"}
      </Button>
    </div>
  );
}
